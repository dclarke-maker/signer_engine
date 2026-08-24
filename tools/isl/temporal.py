"""Bringing ISL and NSL onto one frame rate, at model input.

Deliberately not part of the extraction contract. Extraction stays faithful to
source timing and stores per-frame timestamps, so any rate can be produced later
without re-extracting 252 hours of video. This module is what the training loader
calls, on both corpora, with the same target.

iSign runs at roughly 25 fps and the NSL app targets 30 while achieving rather
less. The default target is **20 fps**, below both, so the operation is
predominantly downsampling. That matters: upsampling would fabricate intermediate
frames, and a model trained on invented motion is learning the interpolator.

The target is configurable because 20 is a starting hypothesis, not a finding.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any, Sequence

import numpy as np

from .contract import LandmarkSequence

DEFAULT_TARGET_FPS = 20.0


@dataclass
class ResampleReport:
    source_fps: float
    target_fps: float
    frames_before: int
    frames_after: int
    duration_ms: float
    below_target: bool
    duplicated_frames: int
    spacing_ms: dict[str, float]

    def as_dict(self) -> dict[str, Any]:
        return {**self.__dict__}


def effective_fps(t_ms: Sequence[float] | np.ndarray) -> float:
    """Rate implied by the timestamps.

    n frames span n-1 intervals; dividing by the count overstates the rate, which
    matters most on the short clips iSign is full of.
    """
    t = np.asarray(t_ms, dtype=np.float64)
    if t.size < 2:
        return 0.0
    span = float(t[-1] - t[0])
    return (t.size - 1) / span * 1000.0 if span > 0 else 0.0


def target_timestamps(duration_ms: float, target_fps: float) -> np.ndarray:
    """Evenly spaced sample points across the clip, starting at 0."""
    if duration_ms <= 0 or target_fps <= 0:
        return np.zeros(1, dtype=np.float64)
    count = int(np.floor(duration_ms * target_fps / 1000.0)) + 1
    return np.arange(count, dtype=np.float64) * (1000.0 / target_fps)


def nearest_indices(t_ms: np.ndarray, wanted: np.ndarray) -> np.ndarray:
    """Index of the closest real frame to each wanted timestamp.

    Nearest rather than interpolated, on purpose. Interpolating between a frame
    where a hand was detected and one where it was not would invent a position
    for a hand that was never seen, and `present` would have no honest value.
    Every landmark this returns was actually observed.
    """
    t = np.asarray(t_ms, dtype=np.float64)
    slots = np.searchsorted(t, wanted)
    slots = np.clip(slots, 1, len(t) - 1) if len(t) > 1 else np.zeros_like(slots)
    if len(t) == 1:
        return np.zeros(len(wanted), dtype=int)
    left = t[slots - 1]
    right = t[slots]
    take_left = (wanted - left) <= (right - wanted)
    return np.where(take_left, slots - 1, slots).astype(int)


def resample(
    sequence: LandmarkSequence, target_fps: float = DEFAULT_TARGET_FPS
) -> tuple[LandmarkSequence, ResampleReport]:
    """Put one sequence on the common rate, reporting what it cost."""
    duration = sequence.duration_ms
    wanted = target_timestamps(duration, target_fps)
    picks = nearest_indices(sequence.t_ms, wanted)

    source = effective_fps(sequence.t_ms)
    # A clip slower than the target cannot fill it without repeats. Counting the
    # repeats makes that visible instead of letting it pass as real motion.
    repeats = int(len(picks) - len(np.unique(picks)))

    out = replace(
        sequence,
        face=sequence.face[picks],
        pose=sequence.pose[picks],
        left_hand=sequence.left_hand[picks],
        right_hand=sequence.right_hand[picks],
        present=sequence.present[picks],
        t_ms=wanted.astype(np.float32),
        aspect=sequence.aspect[picks],
        mirrored=sequence.mirrored[picks],
    )

    spacing = np.diff(wanted) if len(wanted) > 1 else np.zeros(1)
    report = ResampleReport(
        source_fps=source,
        target_fps=target_fps,
        frames_before=sequence.frame_count,
        frames_after=int(len(picks)),
        duration_ms=duration,
        below_target=source > 0 and source < target_fps,
        duplicated_frames=repeats,
        spacing_ms={
            "mean": float(spacing.mean()),
            "std": float(spacing.std()),
        },
    )
    return out, report


def motion_preserved(
    original: LandmarkSequence, resampled: LandmarkSequence, stream: str = "rightHand"
) -> dict[str, float]:
    """How much hand motion survives resampling.

    Downsampling loses the fastest movement first, and fingerspelling and rapid
    transitions are exactly where sign languages carry information. Comparing
    per-frame displacement before and after says whether 20 fps is defensible or
    whether it is flattening the signal.
    """

    def speed(seq: LandmarkSequence) -> np.ndarray:
        arr = seq.stream(stream)
        present = seq.present[:, ["face", "pose", "leftHand", "rightHand"].index(stream)]
        if present.sum() < 2:
            return np.zeros(1)
        xy = arr[present][:, :, :2]
        return np.linalg.norm(np.diff(xy, axis=0), axis=-1).mean(axis=-1)

    before = speed(original)
    after = speed(resampled)
    return {
        "mean_step_before": float(before.mean()),
        "mean_step_after": float(after.mean()),
        "peak_step_before": float(before.max()),
        "peak_step_after": float(after.max()),
        # Per-frame steps grow when frames are dropped; the ratio of totals is
        # what says whether the trajectory itself survived.
        "path_length_before": float(before.sum()),
        "path_length_after": float(after.sum()),
        "path_retained": float(after.sum() / before.sum()) if before.sum() else 0.0,
    }
