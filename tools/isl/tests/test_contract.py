"""The landmark contract, tested where it is testable without a device.

These fixtures deliberately use MediaPipe's real conventions rather than
whatever reads naturally on the page. An earlier NSL fixture placed the signer's
left shoulder at the smaller x, which looks right written down and inverts the
horizontal axis relative to every real capture - it hid a rule that scored
twenty-four times its threshold on every frame ever recorded. Fixtures that do
not match reality do not test anything.
"""

from __future__ import annotations

import numpy as np
import pytest

from tools.isl.contract import (
    FACE_MESH_COUNT,
    FACE_VISIBILITY,
    FACE_WITH_IRIS_COUNT,
    HAND_LANDMARK_COUNT,
    POSE_LANDMARK_COUNT,
    STREAM_ORDER,
    ContractError,
    LandmarkSequence,
    restore_face_visibility,
    round_coordinates,
    sequence_from_npz,
    to_npz_arrays,
    to_payload_json,
    truncate_face_to_canonical,
    validate,
)


def make_sequence(frames: int = 4, *, face_points: int = FACE_WITH_IRIS_COUNT,
                  missing_right_hand: bool = False) -> LandmarkSequence:
    rng = np.random.default_rng(20260824)

    def stream(points: int) -> np.ndarray:
        return rng.random((frames, points, 4)).astype(np.float32)

    face = stream(face_points)
    face[..., 3] = FACE_VISIBILITY  # what MediaPipe leaves and Kotlin writes

    present = np.ones((frames, len(STREAM_ORDER)), dtype=bool)
    right = stream(HAND_LANDMARK_COUNT)
    if missing_right_hand:
        present[:, STREAM_ORDER.index("rightHand")] = False
        right[:] = 0.0

    return LandmarkSequence(
        face=face,
        pose=stream(POSE_LANDMARK_COUNT),
        left_hand=stream(HAND_LANDMARK_COUNT),
        right_hand=right,
        present=present,
        t_ms=np.arange(frames, dtype=np.float32) * 40.0,  # 25 fps, iSign's rate
        aspect=np.full(frames, 16 / 9, dtype=np.float32),
        mirrored=np.zeros(frames, dtype=bool),
        source_fps=25.0,
    )


class TestStreamShape:
    def test_stream_order_is_part_of_the_format(self):
        assert STREAM_ORDER == ("face", "pose", "leftHand", "rightHand")

    def test_a_well_formed_sequence_validates(self):
        validate(make_sequence())

    def test_a_wrong_point_count_is_rejected_not_reshaped(self):
        # Truncating to fit would make the marker rules read the wrong anatomy
        # rather than fail, which is the failure mode the whole contract exists
        # to prevent.
        sequence = make_sequence()
        sequence.pose = sequence.pose[:, :30]
        with pytest.raises(ContractError, match="pose has 30 points"):
            validate(sequence)

    def test_timestamps_must_be_rebased_and_increasing(self):
        sequence = make_sequence()
        sequence.t_ms = sequence.t_ms + 5000.0
        with pytest.raises(ContractError, match="not rebased"):
            validate(sequence)

        sequence = make_sequence()
        sequence.t_ms = np.array([0.0, 40.0, 40.0, 80.0], dtype=np.float32)
        with pytest.raises(ContractError, match="strictly increasing"):
            validate(sequence)

    def test_aspect_must_be_positive(self):
        sequence = make_sequence()
        sequence.aspect = np.zeros_like(sequence.aspect)
        with pytest.raises(ContractError, match="aspect"):
            validate(sequence)


class TestFaceTopology:
    def test_iris_points_are_appended_so_truncation_is_a_slice(self):
        face = make_sequence(face_points=FACE_WITH_IRIS_COUNT).face
        canonical = truncate_face_to_canonical(face)

        assert canonical.shape[1] == FACE_MESH_COUNT
        # The indices the marker rules read must survive untouched.
        assert np.array_equal(canonical, face[:, :FACE_MESH_COUNT])

    def test_a_mesh_without_iris_passes_through(self):
        face = make_sequence(face_points=FACE_MESH_COUNT).face
        assert truncate_face_to_canonical(face).shape[1] == FACE_MESH_COUNT

    def test_every_marker_rule_index_is_inside_the_canonical_mesh(self):
        # server/nmm/baseline.ts reads these; if any were >= 468 the canonical
        # topology would silently drop a landmark a rule depends on.
        for index in (105, 334, 33, 133, 263, 362):
            assert index < FACE_MESH_COUNT

    def test_an_unexpected_face_size_raises(self):
        with pytest.raises(ContractError, match="expected 468 or 478"):
            truncate_face_to_canonical(np.zeros((2, 400, 4), dtype=np.float32))


class TestPrecision:
    def test_rounding_matches_the_nsl_stored_precision(self):
        raw = np.array([[[0.6392536163330078, 0.5770933032035828, -1.7928253412246704, 1.0]]],
                       dtype=np.float32)
        rounded = round_coordinates(raw)

        assert rounded[0, 0, 0] == pytest.approx(0.63925, abs=1e-7)
        # 1e-5 of a 1080px frame is a hundredth of a pixel.
        assert float(np.abs(rounded - raw).max()) < 1e-5

    def test_rounding_is_configurable(self):
        raw = np.array([[[0.123456789, 0.0, 0.0, 1.0]]], dtype=np.float32)
        assert round_coordinates(raw, 3)[0, 0, 0] == pytest.approx(0.123, abs=1e-7)


class TestSerialisation:
    def test_npz_round_trip_preserves_every_value(self):
        original = make_sequence()
        restored = sequence_from_npz(to_npz_arrays(original))

        for name in STREAM_ORDER:
            assert np.array_equal(restored.stream(name), original.stream(name)), name
        assert np.array_equal(restored.present, original.present)
        assert np.array_equal(restored.t_ms, original.t_ms)

    def test_face_visibility_is_reconstructed_exactly_not_approximately(self):
        # The .npz drops this column because MediaPipe never supplies it and NSL
        # stores a constant. If the reconstruction were ever wrong, every face
        # landmark in the corpus would carry an invented confidence.
        original = make_sequence()
        arrays = to_npz_arrays(original)

        assert arrays["face"].shape[-1] == 3, "visibility should not be stored"
        restored = restore_face_visibility(arrays["face"])
        assert np.all(restored[..., 3] == FACE_VISIBILITY)
        assert np.array_equal(restored, original.face)

    def test_missing_streams_serialise_as_null_not_zeros(self):
        sequence = make_sequence(missing_right_hand=True)
        payload = to_payload_json(sequence, session_id="s", prompt_id="p", text="t")

        for frame in payload["frames"]:
            assert frame["rightHand"] is None
            assert frame["leftHand"] is not None

    def test_payload_matches_the_nsl_wire_shape(self):
        payload = to_payload_json(make_sequence(), session_id="uid-1", prompt_id="uid-1",
                                  text="hello")

        assert payload["schemaVersion"] == 1
        assert payload["extractorId"] == "mediapipe-holistic-offline@1"
        assert payload["category"] == "isl-continuous"
        assert payload["frameCount"] == len(payload["frames"])
        assert set(payload["frames"][0]) >= {
            "t", "aspect", "face", "pose", "leftHand", "rightHand"
        }

    def test_achieved_fps_counts_intervals_not_frames(self):
        # 4 frames at 40ms spacing span 3 intervals over 120ms: 25fps, not 33.
        payload = to_payload_json(make_sequence(4), session_id="s", prompt_id="p", text="t")
        assert payload["achievedFps"] == pytest.approx(25.0, abs=1e-6)
