"""What produced a validation report.

Costs almost nothing to record and is the difference between a methodology
section that can be reproduced and one that has to be taken on trust. Every
number in a report is conditional on the versions, the machine and the exact
model weights that produced it, so they travel together.
"""

from __future__ import annotations

import hashlib
import platform
import subprocess
import sys
from pathlib import Path
from typing import Any


def _version(module: str) -> str | None:
    try:
        import importlib

        return getattr(importlib.import_module(module), "__version__", "unknown")
    except Exception:  # noqa: BLE001 - absence is itself worth recording
        return None


def _git_commit(repo: Path) -> str | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return out.stdout.strip() or None
    except Exception:  # noqa: BLE001
        return None


def file_sha256(path: Path) -> str | None:
    """Pins the model weights and the release CSV to exact bytes."""
    try:
        digest = hashlib.sha256()
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except Exception:  # noqa: BLE001
        return None


def _accelerator() -> dict[str, Any]:
    info: dict[str, Any] = {"cpu": platform.processor() or platform.machine()}
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if out.returncode == 0 and out.stdout.strip():
            info["gpu"] = out.stdout.strip().splitlines()[0]
    except Exception:  # noqa: BLE001 - no GPU is a normal, recordable state
        pass
    try:
        import os

        info["cpu_count"] = os.cpu_count()
    except Exception:  # noqa: BLE001
        pass
    return info


def collect(
    *,
    repo: Path,
    model_path: Path | None = None,
    csv_path: Path | None = None,
    dataset_revision: str | None = None,
    worker_count: int | None = None,
    delegate: str | None = None,
) -> dict[str, Any]:
    """The provenance block embedded in every validation report."""
    return {
        "git_commit": _git_commit(repo),
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "packages": {
            name: _version(name)
            for name in ("mediapipe", "numpy", "cv2", "requests")
        },
        "model": {
            "path": str(model_path) if model_path else None,
            "sha256": file_sha256(model_path) if model_path else None,
        },
        "dataset": {
            "name": "iSign",
            "revision": dataset_revision,
            "csv_sha256": file_sha256(csv_path) if csv_path else None,
            "licence": "CC-BY-NC-SA-4.0",
        },
        "machine": _accelerator(),
        "run": {"worker_count": worker_count, "delegate": delegate},
    }
