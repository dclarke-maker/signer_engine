"""Emit an ISL verification payload for the TypeScript contract test.

The point of this fixture is that it is produced by the *ISL* code path -
`contract.to_payload_json` - and then consumed by the *NSL* server code. If the
two ever diverge, `tests/isl-contract.test.ts` fails rather than a model quietly
pre-training in the wrong coordinate space.

Landmarks are synthetic but anatomically arranged, in MediaPipe's real sign
convention: the signer's left shoulder sits at the larger x, because that is what
an unmirrored frame actually produces. A fixture that reads naturally on the page
and inverts the axis is worse than no fixture at all.

Run: python -m tools.isl.make_fixture tests/fixtures/isl-verification.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

from .contract import (
    FACE_WITH_IRIS_COUNT,
    HAND_LANDMARK_COUNT,
    POSE_LANDMARK_COUNT,
    STREAM_ORDER,
    FACE_VISIBILITY,
    LandmarkSequence,
    round_coordinates,
    to_payload_json,
)

# 16:9 landscape - iSign is broadcast and studio footage, where NSL capture is
# portrait. The aspect travels per frame precisely so both can share a space.
ASPECT = 16 / 9
FRAMES = 40
FPS = 25.0


def _pose(frame: int) -> np.ndarray:
    """Anatomically plausible upper body, in MediaPipe's coordinate convention."""
    sway = 0.004 * np.sin(frame / 5.0)
    out = np.zeros((POSE_LANDMARK_COUNT, 4), dtype=np.float32)
    out[:, 3] = 0.99

    # Left at the larger x. This is the convention that matters.
    points = {
        0: (0.50 + sway, 0.34, -0.30),   # nose
        7: (0.56 + sway, 0.33, -0.10),   # left ear
        8: (0.44 + sway, 0.33, -0.10),   # right ear
        11: (0.62, 0.52, -0.05),          # left shoulder
        12: (0.38, 0.52, -0.05),          # right shoulder
        23: (0.59, 0.86, 0.02),           # left hip
        24: (0.41, 0.86, 0.02),           # right hip
    }
    for index, (x, y, z) in points.items():
        out[index] = (x, y, z, 0.99)

    # Everything else is filler but must still be inside the frame; the rules
    # only index the landmarks above. Smooth rather than random, because real
    # landmarks are strongly correlated frame to frame and noise would make the
    # fixture both unrealistic and incompressible.
    idx = np.arange(POSE_LANDMARK_COUNT)
    for index in idx:
        if int(index) not in points:
            out[index, :3] = (
                0.50 + 0.10 * np.sin(index * 0.7 + frame * 0.05),
                0.50 + 0.10 * np.cos(index * 0.5 + frame * 0.05),
                -0.05,
            )
    return out


def _face(frame: int) -> np.ndarray:
    """A mesh whose marker indices sit where the rules expect them."""
    idx = np.arange(FACE_WITH_IRIS_COUNT, dtype=np.float32)
    out = np.zeros((FACE_WITH_IRIS_COUNT, 4), dtype=np.float32)
    # A smooth mesh-like sheet: correlated the way a real face mesh is, and
    # therefore compressible the way a real capture is.
    out[:, 0] = 0.50 + 0.05 * np.sin(idx * 0.11 + frame * 0.03)
    out[:, 1] = 0.33 + 0.05 * np.cos(idx * 0.09 + frame * 0.03)
    out[:, 2] = -0.02
    out[:, 3] = FACE_VISIBILITY  # MediaPipe supplies none; NSL stores 1.0

    # Sized to clear baseline-v1's eyebrow_raise threshold, which asks for the
    # brow-to-eye gap to change by 0.12 of shoulder width - about 55px on a
    # 1080-high frame here. That is a very large movement for an eyebrow, and
    # the number is chosen to exceed the *configured* threshold rather than to
    # be anatomically typical. See docs/isl-rq4-experiment.md: the thresholds
    # come from the proposal and have never been calibrated against real
    # signing, which is the NDFN workshop's job.
    # After frame 30, deliberately. computeSignerBaseline takes its neutral
    # from the first 30 frames, so a raise inside that window is averaged into
    # the very baseline it is then measured against and largely cancels itself.
    brow_lift = 0.075 if frame >= 32 else 0.0  # a question-marking raise
    for index, (x, y) in {
        33: (0.545, 0.330),   # one eye, outer and inner
        133: (0.525, 0.330),
        263: (0.455, 0.330),  # the other eye
        362: (0.475, 0.330),
        105: (0.540, 0.310 - brow_lift),  # brows, one per side
        334: (0.460, 0.310 - brow_lift),
    }.items():
        out[index, :3] = (x, y, -0.02)
    return out


def build() -> LandmarkSequence:
    faces = np.stack([_face(i) for i in range(FRAMES)])
    poses = np.stack([_pose(i) for i in range(FRAMES)])
    f = np.arange(FRAMES, dtype=np.float32)[:, None]
    h = np.arange(HAND_LANDMARK_COUNT, dtype=np.float32)[None, :]
    hands = np.zeros((FRAMES, HAND_LANDMARK_COUNT, 4), dtype=np.float32)
    hands[..., 0] = 0.45 + 0.06 * np.sin(h * 0.3 + f * 0.12)
    hands[..., 1] = 0.55 + 0.06 * np.cos(h * 0.25 + f * 0.12)
    hands[..., 2] = -0.03
    hands[..., 3] = 0.9

    present = np.ones((FRAMES, len(STREAM_ORDER)), dtype=bool)
    # A stretch with no left hand, so the null path is exercised by the fixture
    # rather than only by unit tests.
    present[10:16, STREAM_ORDER.index("leftHand")] = False
    left = hands.copy()
    left[10:16] = 0.0

    return LandmarkSequence(
        face=round_coordinates(faces),
        pose=round_coordinates(poses),
        left_hand=round_coordinates(left),
        right_hand=round_coordinates(hands),
        present=present,
        t_ms=(np.arange(FRAMES) * (1000.0 / FPS)).astype(np.float32),
        aspect=np.full(FRAMES, ASPECT, dtype=np.float32),
        mirrored=np.zeros(FRAMES, dtype=bool),
        source_fps=FPS,
    )


def main() -> None:
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "tests/fixtures/isl-verification.json")
    payload = to_payload_json(
        build(),
        session_id="isign-v1.1-verification-0001",
        prompt_id="ISH-000123-004",
        text="the meeting will start at ten",
    )
    payload["dataset"] = {
        "name": "iSign",
        "version": "v1.1",
        "source": "ISH News",
        "licence": "CC-BY-NC-SA-4.0",
        "note": "synthetic landmarks in the iSign shape; not derived from the corpus",
    }
    target.parent.mkdir(parents=True, exist_ok=True)
    with open(target, "w", encoding="utf8") as handle:
        json.dump(payload, handle, separators=(",", ":"))
    print(f"wrote {target} ({target.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
