"""Cut deterministic fixture frames for the cross-runtime equivalence check.

The frames are **generated locally and never committed**. Two reasons, both
binding: an iSign clip is CC-BY-NC-SA, so putting one in the repository would be
redistribution under ShareAlike; and the frames show a person, whose likeness is
not ours to publish. `.gitignore` keeps the output directory out.

Anything with a person signing in it works - an iSign clip you already hold, or
any openly-licensed video. The comparison is between two runtimes on the *same*
pixels, so the content only has to contain a detectable human.

Each source frame is written twice:

  frame_000_upright.png   as it appears
  frame_000_rot90.png     turned a quarter turn

The rotated variant is not decoration. Rotation and post-rotation aspect are the
handling that failed on NSL - MediaPipe locates a pose first and crops the face
and hands out of it, so a sideways frame yields a pose and then nothing else, at
"97% body coverage". Upright-only fixtures would leave that path untested in
exactly the place it has already broken once.

Run:
    python -m tools.isl.make_frames path/to/clip.mp4 --count 8
"""

from __future__ import annotations

import argparse
from pathlib import Path

DEFAULT_OUT = Path("tools/isl/fixtures/frames")


def main() -> None:
    import cv2

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--count", type=int, default=8)
    args = parser.parse_args()

    capture = cv2.VideoCapture(str(args.video))
    if not capture.isOpened():
        raise SystemExit(f"could not open {args.video}")

    total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    if total <= 0:
        raise SystemExit(f"{args.video} reports no frames")

    # Spread across the clip rather than taking the opening frames, which on
    # broadcast footage are often a title card or a still.
    step = max(1, total // (args.count + 1))
    wanted = [step * (i + 1) for i in range(args.count)]

    args.out.mkdir(parents=True, exist_ok=True)
    written = 0
    for index, position in enumerate(wanted):
        capture.set(cv2.CAP_PROP_POS_FRAMES, position)
        ok, frame = capture.read()
        if not ok:
            continue
        cv2.imwrite(str(args.out / f"frame_{index:03d}_upright.png"), frame)
        # Counter-clockwise here, so applying the plugin's 90-degree clockwise
        # rotation puts it back exactly. The round trip is the thing under test.
        cv2.imwrite(
            str(args.out / f"frame_{index:03d}_rot90.png"),
            cv2.rotate(frame, cv2.ROTATE_90_COUNTERCLOCKWISE),
        )
        written += 2

    capture.release()
    print(f"wrote {written} frames to {args.out}")
    print("These are not committed - see the module docstring.")


if __name__ == "__main__":
    main()
