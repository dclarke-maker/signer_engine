"""Compare the device extractor against the offline one on identical frames.

The claim this exists to test is narrow and important: that a landmark produced
on a phone and a landmark produced in Colab mean the same thing. RQ4 pre-trains
in one runtime and fine-tunes in the other, so a difference here is a difference
the model has to absorb, and it would never announce itself.

Loading the same `.task` file settles the weights. It settles nothing about
image conversion (RGBA bitmap versus an RGB numpy array), rotation, MediaPipe
version, delegate, or handedness.

**No tolerance is asserted until one has been measured.** Two runtimes on two
delegates will not agree bit for bit, and a threshold invented in advance would
either pass everything or fail on arrival. This reports max and mean divergence
per stream; the number that comes back is what a threshold should then be set
from.

Run, after `gradlew connectedAndroidTest` and an `adb pull`:
    python -m tools.isl.cross_runtime android.json --frames tools/isl/fixtures/frames
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np

from .contract import COORDINATE_DECIMALS, STREAM_ORDER
from .extractor import DEFAULT_MODEL, _make_landmarker, _stream_array  # noqa: PLC2701
from .provenance import collect

REPO = Path(__file__).resolve().parents[2]


def python_side(frames_dir: Path, model_path: Path, prefer_gpu: bool) -> dict[str, Any]:
    """Run the offline extractor over the same PNGs the device test used."""
    import cv2
    import mediapipe as mp

    from .contract import EXPECTED_COUNTS, HAND_LANDMARK_COUNT, POSE_LANDMARK_COUNT

    landmarker, delegate = _make_landmarker(model_path, prefer_gpu)
    out: dict[str, Any] = {"runtime": "python", "delegate": delegate, "frames": []}

    names = sorted(p.name for p in frames_dir.glob("*.png"))
    timestamp = 0
    for name in names:
        image_bgr = cv2.imread(str(frames_dir / name))
        # The same rule the instrumented test applies, so both runtimes rotate
        # the same fixtures by the same amount.
        rotation = 90 if "rot90" in name else 0
        if rotation == 90:
            image_bgr = cv2.rotate(image_bgr, cv2.ROTATE_90_CLOCKWISE)

        height, width = image_bgr.shape[:2]
        timestamp += 40
        image = mp.Image(
            image_format=mp.ImageFormat.SRGB,
            data=cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB),
        )
        result = landmarker.detect_for_video(image, timestamp)

        face = result.face_landmarks
        record: dict[str, Any] = {
            "fixture": name,
            "rotationDegrees": rotation,
            "detected": True,
            "aspect": width / height,
            "mirrored": False,
            "timestampMs": timestamp,
            "counts": [
                len(face) if face else 0,
                len(result.pose_landmarks) if result.pose_landmarks else 0,
                len(result.left_hand_landmarks) if result.left_hand_landmarks else 0,
                len(result.right_hand_landmarks) if result.right_hand_landmarks else 0,
            ],
        }
        for key, landmarks, expected in (
            ("face", face, len(face) if face else EXPECTED_COUNTS["face"][-1]),
            ("pose", result.pose_landmarks, POSE_LANDMARK_COUNT),
            ("leftHand", result.left_hand_landmarks, HAND_LANDMARK_COUNT),
            ("rightHand", result.right_hand_landmarks, HAND_LANDMARK_COUNT),
        ):
            arr = _stream_array(landmarks, expected, True) if landmarks else None
            record[key] = [] if arr is None else np.round(arr[:, :3], COORDINATE_DECIMALS).tolist()
        out["frames"].append(record)

    landmarker.close()
    return out


def compare(android: dict[str, Any], python: dict[str, Any]) -> dict[str, Any]:
    """Divergence per stream, plus the categorical things that must simply match."""
    by_name = {f["fixture"]: f for f in python["frames"]}
    per_frame: list[dict[str, Any]] = []
    worst: dict[str, float] = {name: 0.0 for name in STREAM_ORDER}
    means: dict[str, list[float]] = {name: [] for name in STREAM_ORDER}
    mismatches: list[str] = []

    for frame in android["frames"]:
        name = frame["fixture"]
        other = by_name.get(name)
        if other is None:
            mismatches.append(f"{name}: missing from the python run")
            continue

        entry: dict[str, Any] = {"fixture": name}

        # Categorical first. A stream detected on one runtime and not the other,
        # or a different point count, is not a tolerance question.
        if frame.get("detected") != other.get("detected"):
            mismatches.append(f"{name}: detected differs")
        if frame.get("counts") != other.get("counts"):
            mismatches.append(f"{name}: counts {frame.get('counts')} vs {other.get('counts')}")
        if abs(float(frame.get("aspect", 0)) - float(other.get("aspect", 0))) > 1e-4:
            mismatches.append(
                f"{name}: aspect {frame.get('aspect')} vs {other.get('aspect')}"
            )
        if bool(frame.get("mirrored")) != bool(other.get("mirrored")):
            mismatches.append(f"{name}: mirrored differs")

        for stream in STREAM_ORDER:
            a = np.asarray(frame.get(stream) or [], dtype=np.float64)
            b = np.asarray(other.get(stream) or [], dtype=np.float64)
            if a.size == 0 or b.size == 0 or a.shape != b.shape:
                entry[stream] = None
                continue
            diff = np.abs(a - b)
            entry[stream] = {
                "max": float(diff.max()),
                "mean": float(diff.mean()),
                # Normalised coordinates, so this is the error in pixels on a
                # 1080-high frame - the unit anyone can reason about.
                "max_px_at_1080": float(diff.max() * 1080),
            }
            worst[stream] = max(worst[stream], float(diff.max()))
            means[stream].append(float(diff.mean()))
        per_frame.append(entry)

    return {
        "frames_compared": len(per_frame),
        "categorical_mismatches": mismatches,
        "per_stream": {
            stream: {
                "max_abs_diff": worst[stream],
                "mean_abs_diff": float(np.mean(means[stream])) if means[stream] else None,
                "max_px_at_1080": worst[stream] * 1080,
            }
            for stream in STREAM_ORDER
        },
        "per_frame": per_frame,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("android_json", type=Path, help="pulled from the device")
    parser.add_argument("--frames", type=Path, default=Path("tools/isl/fixtures/frames"))
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--gpu", action="store_true")
    parser.add_argument("--out", type=Path, default=Path("tools/isl/fixtures/cross-runtime.json"))
    args = parser.parse_args()

    android = json.loads(args.android_json.read_text())
    python = python_side(args.frames, args.model, args.gpu)
    report = {
        "provenance": collect(repo=REPO, model_path=args.model, delegate=python["delegate"]),
        "android_device": android.get("device"),
        "comparison": compare(android, python),
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, default=str))

    summary = report["comparison"]["per_stream"]
    print(f"compared {report['comparison']['frames_compared']} frames")
    for stream, stats in summary.items():
        if stats["mean_abs_diff"] is None:
            print(f"  {stream:10s} not detected in both runtimes")
            continue
        print(
            f"  {stream:10s} max {stats['max_abs_diff']:.6f} "
            f"({stats['max_px_at_1080']:.2f}px at 1080)  mean {stats['mean_abs_diff']:.6f}"
        )
    for problem in report["comparison"]["categorical_mismatches"]:
        print(f"  MISMATCH {problem}")
    print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
