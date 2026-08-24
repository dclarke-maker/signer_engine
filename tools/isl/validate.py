"""Checks that turn the contract from prose into something enforced.

Two things are being proved here, and they are different:

1. That a processed ISL clip *satisfies* the NSL contract - counts, ordering,
   nulls, timestamps, aspect.
2. That the `.npz` and the JSON say the *same thing*, so the compact storage form
   has not quietly become a second representation.

The third proof - that the Python extractor and the Kotlin one agree on the same
frames - cannot live here because it needs a device. It is in
`cross_runtime.py`.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from .contract import (
    EXPECTED_COUNTS,
    FACE_MESH_COUNT,
    FACE_VISIBILITY,
    STREAM_ORDER,
    LandmarkSequence,
    truncate_face_to_canonical,
    validate as validate_contract,
)


@dataclass
class Finding:
    check: str
    ok: bool
    detail: Any = None


@dataclass
class ValidationReport:
    uid: str
    findings: list[Finding] = field(default_factory=list)

    def add(self, check: str, ok: bool, detail: Any = None) -> None:
        self.findings.append(Finding(check=check, ok=ok, detail=detail))

    @property
    def ok(self) -> bool:
        return all(f.ok for f in self.findings)

    def as_dict(self) -> dict[str, Any]:
        return {
            "uid": self.uid,
            "ok": self.ok,
            "findings": [f.__dict__ for f in self.findings],
        }


def check_sequence(sequence: LandmarkSequence, uid: str) -> ValidationReport:
    """Structural conformance to the NSL contract."""
    report = ValidationReport(uid=uid)

    try:
        validate_contract(sequence)
        report.add("contract", True)
    except Exception as error:  # noqa: BLE001
        report.add("contract", False, str(error))

    for name in STREAM_ORDER:
        arr = sequence.stream(name)
        report.add(
            f"count:{name}",
            arr.shape[1] in EXPECTED_COUNTS[name],
            {"points": int(arr.shape[1]), "expected": EXPECTED_COUNTS[name]},
        )

    # Frames must be in source order and start at zero.
    report.add(
        "timestamps:monotonic",
        bool(np.all(np.diff(sequence.t_ms) > 0)) if sequence.frame_count > 1 else True,
    )
    report.add("timestamps:rebased", float(sequence.t_ms[0]) == 0.0)

    # An absent stream must be marked absent, not filled with zeros that read as
    # coordinates at the origin.
    zero_rows = {}
    for i, name in enumerate(STREAM_ORDER):
        arr = sequence.stream(name)
        absent = ~sequence.present[:, i]
        if absent.any():
            zero_rows[name] = bool(np.all(arr[absent] == 0))
    report.add("absent-streams-are-not-coordinates", all(zero_rows.values()) if zero_rows else True,
               zero_rows)

    report.add("aspect:positive", bool(np.all(sequence.aspect > 0)),
               {"unique": np.unique(sequence.aspect).tolist()[:4]})

    # The canonical model-input topology must be reachable and lossless for the
    # indices the marker rules read.
    try:
        canonical = truncate_face_to_canonical(sequence.face)
        same = np.array_equal(canonical, sequence.face[:, :FACE_MESH_COUNT])
        report.add("face:truncates-to-468", canonical.shape[1] == FACE_MESH_COUNT and same)
    except Exception as error:  # noqa: BLE001
        report.add("face:truncates-to-468", False, str(error))

    return report


def compare_npz_json(sequence: LandmarkSequence, payload: dict[str, Any]) -> dict[str, Any]:
    """Prove the two stored forms carry the same numbers.

    Face visibility is the one column the `.npz` omits, because MediaPipe never
    supplies it and NSL stores a constant. The reconstruction is checked here
    rather than assumed - if it were ever wrong, every face landmark would carry
    a confidence that had been invented.
    """
    frames = payload["frames"]
    diffs: dict[str, list[float]] = {name: [] for name in STREAM_ORDER}
    mismatched_presence: list[int] = []
    face_visibility_exact = True

    key = {"face": "face", "pose": "pose", "leftHand": "leftHand", "rightHand": "rightHand"}
    for i, frame in enumerate(frames):
        for column, name in enumerate(STREAM_ORDER):
            present_npz = bool(sequence.present[i, column])
            present_json = frame[key[name]] is not None
            if present_npz != present_json:
                mismatched_presence.append(i)
                continue
            if not present_npz:
                continue
            points = frame[key[name]]
            arr = sequence.stream(name)[i]
            got = np.array(
                [[p["x"], p["y"], p["z"]] for p in points], dtype=np.float32
            )
            diffs[name].append(float(np.abs(got - arr[:, :3]).max()))
            if name == "face":
                vis = [p.get("visibility") for p in points]
                if any(v is not None and float(v) != FACE_VISIBILITY for v in vis):
                    face_visibility_exact = False

    summary = {}
    for name, values in diffs.items():
        if values:
            summary[name] = {
                "max_abs_diff": max(values),
                "mean_abs_diff": float(np.mean(values)),
            }
    return {
        "streams": summary,
        "presence_mismatches": mismatched_presence,
        "face_visibility_reconstruction_exact": face_visibility_exact,
        "frames_compared": len(frames),
    }


def rounding_cost(raw: np.ndarray, rounded: np.ndarray) -> dict[str, float]:
    """What the canonical 5-decimal precision actually costs, in pixels."""
    diff = np.abs(raw.astype(np.float64) - rounded.astype(np.float64))
    return {
        "max_abs_diff": float(diff.max()),
        "mean_abs_diff": float(diff.mean()),
        # A normalised coordinate times frame height is the pixel error.
        "max_pixels_at_1080": float(diff.max() * 1080),
    }


def write_report(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False, default=str)
