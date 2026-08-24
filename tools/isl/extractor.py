"""Offline ISL extraction into the NSL landmark space.

Mirrors `native/holistic/android/HolisticFrameProcessorPlugin.kt`. Where the two
disagree, the Kotlin plugin and `lib/extractors/holistic-buffer.ts` are right.

mediapipe and cv2 are imported lazily so that `contract.py`, the tests and the
manifest tooling stay usable in an environment without them.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from .contract import (
    EXPECTED_COUNTS,
    FACE_VISIBILITY,
    HAND_LANDMARK_COUNT,
    POSE_LANDMARK_COUNT,
    STREAM_ORDER,
    ContractError,
    LandmarkSequence,
    round_coordinates,
)

#: The committed asset, not "a" holistic model. Weights that differ produce
#: landmarks that differ and nothing downstream would notice.
DEFAULT_MODEL = Path(__file__).resolve().parents[2] / "native/holistic/models/holistic_landmarker.task"


def model_sha256(path: Path = DEFAULT_MODEL) -> str:
    """Recorded in every validation report so the weights are pinned."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


@dataclass
class ExtractionReport:
    """Everything the smoke test needs to characterise one clip."""

    uid: str
    source_fps: float
    source_width: int
    source_height: int
    rotation_degrees: int
    upright_width: int
    upright_height: int
    aspect: float
    mirrored: bool
    frame_count: int
    duration_ms: float
    extract_seconds: float
    processing_fps: float
    detection_rate: dict[str, float]
    delegate: str
    timestamp_source: str
    timestamp_spacing_ms: dict[str, float]

    def as_dict(self) -> dict[str, Any]:
        return {**self.__dict__}


def _make_landmarker(model_path: Path, prefer_gpu: bool):
    """GPU first, CPU fallback - the same order the Kotlin plugin tries.

    Returns the landmarker and which delegate actually took, because "ready on
    CPU" changes the throughput estimates materially and must not be guessed.
    """
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    delegates = []
    if prefer_gpu:
        delegates.append(("GPU", mp_python.BaseOptions.Delegate.GPU))
    delegates.append(("CPU", mp_python.BaseOptions.Delegate.CPU))

    last_error: Exception | None = None
    for name, delegate in delegates:
        try:
            options = vision.HolisticLandmarkerOptions(
                base_options=mp_python.BaseOptions(
                    model_asset_path=str(model_path), delegate=delegate
                ),
                running_mode=vision.RunningMode.VIDEO,
                # Not part of this pipeline, and both cost time on every frame.
                output_face_blendshapes=False,
                output_segmentation_mask=False,
            )
            return vision.HolisticLandmarker.create_from_options(options), name
        except Exception as error:  # noqa: BLE001 - report, then try the next
            last_error = error
    raise RuntimeError(f"HolisticLandmarker failed on every delegate: {last_error}")


def _rotation_degrees(capture) -> int:
    """How far the frame must turn to stand upright.

    Read explicitly rather than left to the decoder. OpenCV applies container
    rotation automatically in some builds and not others, and a double rotation
    is worse than none: MediaPipe locates a pose first and crops the face and
    hands out of it, so a sideways frame yields a pose and then nothing else.
    """
    import cv2

    try:
        # Turn auto-rotation off so the rotation is ours to apply, once.
        capture.set(cv2.CAP_PROP_ORIENTATION_AUTO, 0)
        meta = capture.get(cv2.CAP_PROP_ORIENTATION_META)
    except Exception:  # noqa: BLE001 - older OpenCV has neither property
        return 0
    if meta is None or (isinstance(meta, float) and math.isnan(meta)):
        return 0
    return int(meta) % 360


def _upright(frame: np.ndarray, degrees: int) -> np.ndarray:
    import cv2

    if degrees == 90:
        return cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE)
    if degrees == 180:
        return cv2.rotate(frame, cv2.ROTATE_180)
    if degrees == 270:
        return cv2.rotate(frame, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return frame


def _stream_array(landmarks, expected: int, with_visibility: bool) -> np.ndarray | None:
    """One stream for one frame, or None when the model did not detect it.

    A count other than `expected` rejects the frame's stream rather than padding
    or truncating it: the marker rules index landmarks by position, so a short
    array reads the wrong anatomy instead of failing.
    """
    if not landmarks:
        return None
    if len(landmarks) != expected:
        raise ContractError(f"stream has {len(landmarks)} points, expected {expected}")
    width = 4 if with_visibility else 4
    out = np.empty((expected, width), dtype=np.float32)
    for i, point in enumerate(landmarks):
        out[i, 0] = point.x
        out[i, 1] = point.y
        out[i, 2] = point.z
        visibility = getattr(point, "visibility", None)
        out[i, 3] = FACE_VISIBILITY if visibility is None else float(visibility)
    return out


def extract_clip(
    video_path: Path,
    *,
    uid: str,
    model_path: Path = DEFAULT_MODEL,
    prefer_gpu: bool = False,
    mirrored: bool = False,
    decimals: int | None = None,
) -> tuple[LandmarkSequence, ExtractionReport]:
    """Run one ISL clip through the contract.

    `mirrored` is recorded, not inferred: MediaPipe names hands anatomically for
    the person as depicted, so only genuinely flipped pixels need the swap.
    Recorded and broadcast ISL footage is not mirrored, but the value travels
    with the data so a future source that is can be handled without changing
    what "leftHand" means.
    """
    import cv2
    import mediapipe as mp
    import time

    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"could not open {video_path}")

    rotation = _rotation_degrees(capture)
    source_fps = float(capture.get(cv2.CAP_PROP_FPS)) or 0.0
    source_w = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    source_h = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))

    landmarker, delegate = _make_landmarker(model_path, prefer_gpu)

    faces: list[np.ndarray | None] = []
    poses: list[np.ndarray | None] = []
    lefts: list[np.ndarray | None] = []
    rights: list[np.ndarray | None] = []
    stamps: list[float] = []

    timestamp_source = "container"
    upright_w = upright_h = 0
    index = 0
    started = time.perf_counter()

    while True:
        ok, frame = capture.read()
        if not ok:
            break

        # Source timing, faithfully: the contract does not resample. Fall back to
        # the frame index when the container reports nothing usable.
        pos_ms = capture.get(cv2.CAP_PROP_POS_MSEC)
        if not pos_ms or pos_ms <= 0 or (stamps and pos_ms <= stamps[-1]):
            if source_fps <= 0:
                raise RuntimeError(f"{video_path} reports neither timestamps nor fps")
            pos_ms = index * 1000.0 / source_fps
            timestamp_source = "frame-index"

        upright = _upright(frame, rotation)
        upright_h, upright_w = upright.shape[:2]

        image = mp.Image(
            image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(upright, cv2.COLOR_BGR2RGB)
        )
        # detect_for_video requires strictly increasing integer milliseconds.
        result = landmarker.detect_for_video(image, int(round(pos_ms)) + index)

        faces.append(_stream_array(result.face_landmarks, _face_count(result), False))
        poses.append(_stream_array(result.pose_landmarks, POSE_LANDMARK_COUNT, True))
        raw_left = _stream_array(result.left_hand_landmarks, HAND_LANDMARK_COUNT, True)
        raw_right = _stream_array(result.right_hand_landmarks, HAND_LANDMARK_COUNT, True)
        # Swap only when the pixels are actually flipped; see the docstring.
        lefts.append(raw_right if mirrored else raw_left)
        rights.append(raw_left if mirrored else raw_right)

        stamps.append(float(pos_ms))
        index += 1

    capture.release()
    landmarker.close()
    elapsed = time.perf_counter() - started

    if not stamps:
        raise RuntimeError(f"{video_path} produced no frames")

    sequence = _assemble(
        faces, poses, lefts, rights, stamps,
        aspect=upright_w / upright_h,
        mirrored=mirrored,
        source_fps=source_fps,
        decimals=decimals,
    )

    spacing = np.diff(sequence.t_ms) if sequence.frame_count > 1 else np.zeros(1, np.float32)
    report = ExtractionReport(
        uid=uid,
        source_fps=source_fps,
        source_width=source_w,
        source_height=source_h,
        rotation_degrees=rotation,
        upright_width=upright_w,
        upright_height=upright_h,
        aspect=upright_w / upright_h,
        mirrored=mirrored,
        frame_count=sequence.frame_count,
        duration_ms=sequence.duration_ms,
        extract_seconds=elapsed,
        processing_fps=sequence.frame_count / elapsed if elapsed else 0.0,
        detection_rate={
            name: float(sequence.present[:, i].mean())
            for i, name in enumerate(STREAM_ORDER)
        },
        delegate=delegate,
        timestamp_source=timestamp_source,
        timestamp_spacing_ms={
            "mean": float(spacing.mean()),
            "std": float(spacing.std()),
            "min": float(spacing.min()),
            "max": float(spacing.max()),
        },
    )
    return sequence, report


def _face_count(result) -> int:
    """Whatever the model emitted - 478 normally, 468 without iris."""
    landmarks = result.face_landmarks
    return len(landmarks) if landmarks else EXPECTED_COUNTS["face"][-1]


def _assemble(faces, poses, lefts, rights, stamps, *, aspect, mirrored, source_fps,
              decimals) -> LandmarkSequence:
    """Stack per-frame streams, marking absence rather than substituting zeros."""
    n = len(stamps)
    widths = {
        "face": _first_width(faces, EXPECTED_COUNTS["face"][-1]),
        "pose": POSE_LANDMARK_COUNT,
        "leftHand": HAND_LANDMARK_COUNT,
        "rightHand": HAND_LANDMARK_COUNT,
    }
    stacks = {}
    present = np.zeros((n, len(STREAM_ORDER)), dtype=bool)

    for column, (name, frames) in enumerate(
        zip(STREAM_ORDER, (faces, poses, lefts, rights))
    ):
        out = np.zeros((n, widths[name], 4), dtype=np.float32)
        for i, arr in enumerate(frames):
            if arr is None:
                continue
            # A stream can change point count mid-clip only if the model changes
            # behaviour; refuse rather than silently reshaping.
            if arr.shape[0] != widths[name]:
                raise ContractError(
                    f"{name} frame {i} has {arr.shape[0]} points, expected {widths[name]}"
                )
            out[i] = arr
            present[i, column] = True
        stacks[name] = out

    t = np.asarray(stamps, dtype=np.float64)
    t = t - t[0]  # rebase: the first frame of a clip is t=0
    decimals = decimals if decimals is not None else None

    def rounded(arr: np.ndarray) -> np.ndarray:
        return round_coordinates(arr) if decimals is None else round_coordinates(arr, decimals)

    return LandmarkSequence(
        face=rounded(stacks["face"]),
        pose=rounded(stacks["pose"]),
        left_hand=rounded(stacks["leftHand"]),
        right_hand=rounded(stacks["rightHand"]),
        present=present,
        t_ms=t.astype(np.float32),
        aspect=np.full(n, aspect, dtype=np.float32),
        mirrored=np.full(n, mirrored, dtype=bool),
        source_fps=source_fps,
    )


def _first_width(frames, default: int) -> int:
    for arr in frames:
        if arr is not None:
            return int(arr.shape[0])
    return default
