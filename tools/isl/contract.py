"""The NSL landmark contract, in code.

`lib/extractors/holistic-buffer.ts` is the authority for this format and
`docs/isl-preprocessing-contract.md` explains why each rule exists. This module
holds the parts that are pure - counts, ordering, truncation, rounding,
serialisation - so they can be tested without MediaPipe, a GPU or a video file.

Nothing here imports mediapipe or cv2. Keep it that way: it is what the tests
run against.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

# --- Counts and ordering -----------------------------------------------------

#: Order is part of the wire format, not a convenience. See the contract §3.
STREAM_ORDER = ("face", "pose", "leftHand", "rightHand")

POSE_LANDMARK_COUNT = 33
HAND_LANDMARK_COUNT = 21

#: The mesh the marker rules index into, and the canonical model-input topology.
FACE_MESH_COUNT = 468
#: What MediaPipe Tasks actually emits: the mesh plus ten iris points, appended.
FACE_WITH_IRIS_COUNT = 478

FACE_LANDMARK_COUNTS = (FACE_MESH_COUNT, FACE_WITH_IRIS_COUNT)

EXPECTED_COUNTS: dict[str, tuple[int, ...]] = {
    "face": FACE_LANDMARK_COUNTS,
    "pose": (POSE_LANDMARK_COUNT,),
    "leftHand": (HAND_LANDMARK_COUNT,),
    "rightHand": (HAND_LANDMARK_COUNT,),
}

#: Matches COORDINATE_DECIMALS in lib/sequence-payload.ts. 1e-5 of a 1080px
#: frame is a hundredth of a pixel - below what the model resolves.
COORDINATE_DECIMALS = 5

#: Distinguishes an offline ISL extraction from a phone capture
#: ("mediapipe-holistic-native@1"). No exported row is ambiguous about which
#: runtime produced it.
EXTRACTOR_ID = "mediapipe-holistic-offline@1"

#: MediaPipe supplies no visibility for face landmarks; the Kotlin plugin writes
#: orElse(1f), so NSL stores exactly this for every face point. The .npz omits
#: the column and the loader reconstructs this value. Contract §8.
FACE_VISIBILITY = 1.0


class ContractError(ValueError):
    """A sequence that does not satisfy the NSL landmark contract."""


# --- One clip ----------------------------------------------------------------


@dataclass
class LandmarkSequence:
    """One ISL clip in the NSL landmark space.

    Streams are (frames, points, 3 or 4) float32. `present` marks, per frame and
    per stream, whether the model actually detected it - the array rows for an
    absent stream are meaningless and must never be read as coordinates. This is
    the `null` of the NSL format, which stores a missing stream as null rather
    than as zeros so that "out of frame" stays distinguishable from "at the
    origin".
    """

    face: np.ndarray
    pose: np.ndarray
    left_hand: np.ndarray
    right_hand: np.ndarray
    present: np.ndarray  # (frames, 4) bool, in STREAM_ORDER
    t_ms: np.ndarray  # (frames,) float32, rebased so the first frame is 0
    aspect: np.ndarray  # (frames,) float32, width/height after rotation
    mirrored: np.ndarray  # (frames,) bool
    source_fps: float
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def frame_count(self) -> int:
        return int(self.t_ms.shape[0])

    @property
    def duration_ms(self) -> float:
        return float(self.t_ms[-1]) if self.frame_count else 0.0

    def stream(self, name: str) -> np.ndarray:
        return {
            "face": self.face,
            "pose": self.pose,
            "leftHand": self.left_hand,
            "rightHand": self.right_hand,
        }[name]

    def is_present(self, name: str, frame: int) -> bool:
        return bool(self.present[frame, STREAM_ORDER.index(name)])


# --- Rules -------------------------------------------------------------------


def round_coordinates(values: np.ndarray, decimals: int = COORDINATE_DECIMALS) -> np.ndarray:
    """Round to the NSL canonical stored precision.

    Not a compression step. The device rounds before upload, so an unrounded ISL
    sequence would sit at a different precision than every NSL sequence it is
    meant to share a space with.
    """
    return np.round(values.astype(np.float32), decimals).astype(np.float32)


def truncate_face_to_canonical(face: np.ndarray) -> np.ndarray:
    """Reduce a face stream to the fixed 468-point model-input topology.

    MediaPipe appends ten iris points at 468-477 rather than interleaving them,
    so indices 0-467 mean the same thing either way and this is a plain slice.
    A tensor cannot have a variable dimension, and the proposal specifies 468.

    Applied identically to ISL and NSL, in the training loader - never during
    extraction, which stores what the model emitted.
    """
    if face.shape[-2] == FACE_MESH_COUNT:
        return face
    if face.shape[-2] == FACE_WITH_IRIS_COUNT:
        return face[..., :FACE_MESH_COUNT, :]
    raise ContractError(
        f"face stream has {face.shape[-2]} points, expected "
        f"{FACE_MESH_COUNT} or {FACE_WITH_IRIS_COUNT}"
    )


def validate(sequence: LandmarkSequence) -> None:
    """Raise unless the sequence satisfies the contract. Never repairs."""
    n = sequence.frame_count
    if n == 0:
        raise ContractError("sequence has no frames")

    for name in STREAM_ORDER:
        arr = sequence.stream(name)
        if arr.shape[0] != n:
            raise ContractError(f"{name} has {arr.shape[0]} frames, expected {n}")
        if arr.shape[1] not in EXPECTED_COUNTS[name]:
            raise ContractError(
                f"{name} has {arr.shape[1]} points, expected "
                f"{' or '.join(str(c) for c in EXPECTED_COUNTS[name])}"
            )
        if arr.dtype != np.float32:
            raise ContractError(f"{name} is {arr.dtype}, expected float32")

    if sequence.present.shape != (n, len(STREAM_ORDER)):
        raise ContractError(
            f"present is {sequence.present.shape}, expected {(n, len(STREAM_ORDER))}"
        )
    if sequence.t_ms.shape != (n,):
        raise ContractError(f"t_ms is {sequence.t_ms.shape}, expected {(n,)}")
    if n and float(sequence.t_ms[0]) != 0.0:
        raise ContractError(f"t_ms is not rebased: first frame is {sequence.t_ms[0]}")
    if n > 1 and not np.all(np.diff(sequence.t_ms) > 0):
        raise ContractError("t_ms is not strictly increasing")
    if not np.all(sequence.aspect > 0):
        raise ContractError("aspect must be positive on every frame")


# --- Serialisation -----------------------------------------------------------


def to_npz_arrays(sequence: LandmarkSequence) -> dict[str, np.ndarray]:
    """The bulk storage form: compressed float32, face visibility omitted.

    Face visibility is constant 1.0 and carries no information (contract §8);
    `landmarks_from_npz` puts it back. This is the only place the stored ISL
    bytes differ from the stored NSL bytes, and it is a serialisation
    difference, not a value difference.
    """
    return {
        "face": sequence.face[..., :3],
        "pose": sequence.pose,
        "left_hand": sequence.left_hand,
        "right_hand": sequence.right_hand,
        "present": sequence.present,
        "t_ms": sequence.t_ms,
        "aspect": sequence.aspect,
        "mirrored": sequence.mirrored,
        "source_fps": np.float32(sequence.source_fps),
    }


def restore_face_visibility(face_xyz: np.ndarray) -> np.ndarray:
    """Put back the constant the .npz omits, exactly as NSL stores it."""
    filled = np.full((*face_xyz.shape[:-1], 4), FACE_VISIBILITY, dtype=np.float32)
    filled[..., :3] = face_xyz
    return filled


def sequence_from_npz(data: Any, meta: dict[str, Any] | None = None) -> LandmarkSequence:
    """Inverse of `to_npz_arrays`, including the visibility reconstruction."""
    return LandmarkSequence(
        face=restore_face_visibility(np.asarray(data["face"], dtype=np.float32)),
        pose=np.asarray(data["pose"], dtype=np.float32),
        left_hand=np.asarray(data["left_hand"], dtype=np.float32),
        right_hand=np.asarray(data["right_hand"], dtype=np.float32),
        present=np.asarray(data["present"], dtype=bool),
        t_ms=np.asarray(data["t_ms"], dtype=np.float32),
        aspect=np.asarray(data["aspect"], dtype=np.float32),
        mirrored=np.asarray(data["mirrored"], dtype=bool),
        source_fps=float(np.asarray(data["source_fps"])),
        meta=meta or {},
    )


def _points(arr: np.ndarray, frame: int) -> list[dict[str, float]]:
    row = arr[frame]
    if row.shape[-1] == 3:
        return [{"x": float(p[0]), "y": float(p[1]), "z": float(p[2])} for p in row]
    return [
        {"x": float(p[0]), "y": float(p[1]), "z": float(p[2]), "visibility": float(p[3])}
        for p in row
    ]


def to_payload_json(sequence: LandmarkSequence, *, session_id: str, prompt_id: str,
                    text: str) -> dict[str, Any]:
    """The NSL wire shape, `LandmarkSequencePayload` in shared/landmarks.ts.

    Written for a small verification subset so equivalence with the NSL
    representation can be checked numerically and by feeding it through the real
    NSL server code.
    """
    frames = []
    for i in range(sequence.frame_count):
        frames.append(
            {
                "t": float(sequence.t_ms[i]),
                "aspect": float(sequence.aspect[i]),
                # null, not zeros - contract §8.
                "face": _points(sequence.face, i) if sequence.is_present("face", i) else None,
                "pose": _points(sequence.pose, i) if sequence.is_present("pose", i) else None,
                "leftHand": (
                    _points(sequence.left_hand, i)
                    if sequence.is_present("leftHand", i)
                    else None
                ),
                "rightHand": (
                    _points(sequence.right_hand, i)
                    if sequence.is_present("rightHand", i)
                    else None
                ),
            }
        )

    duration_ms = sequence.duration_ms
    # n frames span n-1 intervals; dividing by the count overstates the rate.
    intervals = sequence.frame_count - 1
    achieved = (intervals / duration_ms * 1000.0) if intervals and duration_ms else 0.0

    return {
        "schemaVersion": 1,
        "sessionId": session_id,
        "promptId": prompt_id,
        "category": "isl-continuous",
        "extractorId": EXTRACTOR_ID,
        "targetFps": sequence.source_fps,
        "achievedFps": achieved,
        "frameCount": sequence.frame_count,
        "durationMs": duration_ms,
        "frames": frames,
        "text": text,
    }
