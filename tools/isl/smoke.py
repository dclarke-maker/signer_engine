"""Batch processing, worker benchmarking and the projections that size the corpus.

The notebook is a thin driver over this module; the logic lives here so it can be
read, tested and changed without editing JSON.

Nothing here decides how much of iSign to process. That decision is deferred
until the smoke test has produced real throughput and real per-clip sizes,
because the estimates going in - 252 hours, ~200 hours of compute, 100-200 GB -
are arithmetic from a paper, not measurements.
"""

from __future__ import annotations

import json
import os
import resource
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Sequence

import numpy as np

from .contract import to_npz_arrays, to_payload_json
from .extractor import extract_clip
from .manifest import Manifest
from .triage import Row

#: Corpus sizes to project onto. "full" is filled in from the triage count.
TIERS = (5_000, 10_000, 15_000, 30_000)


@dataclass
class ClipResult:
    uid: str
    npz_path: str
    npz_bytes: int
    report: dict[str, Any]


def peak_rss_mb() -> float:
    """Peak resident memory of this process and everything it has forked.

    ru_maxrss is a **high-water mark that never falls**, so this is cumulative
    across the whole session, not a reading for one run. `benchmark_workers`
    reports the increase it observes rather than this raw value - taking the
    number directly made every worker count report an identical figure, which
    is exactly what the first real run produced.
    """
    scale = 1024 * 1024 if os.uname().sysname == "Darwin" else 1024
    own = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    kids = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    return max(own, kids) / scale


def process_clip(
    uid: str,
    video_bytes: bytes,
    out_dir: Path,
    *,
    text: str = "",
    source: str = "",
    write_json: bool = False,
    prefer_gpu: bool = False,
) -> ClipResult:
    """One clip: bytes in, an .npz on Drive and a measurement out.

    The video is written to a scratch file because decoders want a path, and
    removed straight after. Nothing important is ever left on Colab's local disk.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp.write(video_bytes)
        tmp_path = Path(tmp.name)

    try:
        sequence, report = extract_clip(tmp_path, uid=uid, prefer_gpu=prefer_gpu)
    finally:
        tmp_path.unlink(missing_ok=True)

    npz_path = out_dir / f"{uid}.npz"
    # Compressed float32. Not float16: quantising here would change the landmark
    # values rather than their serialisation.
    np.savez_compressed(npz_path, **to_npz_arrays(sequence))

    if write_json:
        payload = to_payload_json(sequence, session_id=uid, prompt_id=uid, text=text)
        payload["dataset"] = {
            "name": "iSign",
            "version": "v1.1",
            "source": source,
            "licence": "CC-BY-NC-SA-4.0",
        }
        (out_dir / f"{uid}.json").write_text(json.dumps(payload, separators=(",", ":")))

    detail = report.as_dict()
    detail["npz_bytes"] = npz_path.stat().st_size
    detail["source"] = source
    return ClipResult(
        uid=uid, npz_path=str(npz_path), npz_bytes=detail["npz_bytes"], report=detail
    )


def run_batch(
    rows: Sequence[Row],
    fetch: Callable[[Row], bytes],
    out_dir: Path,
    manifest: Manifest,
    *,
    json_uids: Sequence[str] = (),
    prefer_gpu: bool = False,
    retry_failed: bool = False,
) -> list[dict[str, Any]]:
    """Process what is not already done, recording each outcome as it lands.

    Sequential on purpose: this is the correctness pass. Throughput is measured
    separately by `benchmark_workers`, so a slow first run does not confound the
    numbers the corpus decision rests on.
    """
    pending = set(manifest.pending([row.uid for row in rows], retry_failed=retry_failed))
    reports: list[dict[str, Any]] = []

    for row in rows:
        if row.uid not in pending:
            continue
        try:
            result = process_clip(
                row.uid,
                fetch(row),
                out_dir,
                text=row.text,
                source=row.source,
                write_json=row.uid in set(json_uids),
                prefer_gpu=prefer_gpu,
            )
        except Exception as error:  # noqa: BLE001
            # Reason, not just the fact. "Why did 4% fail" has to be answerable
            # before anyone commits to processing the corpus.
            manifest.record_failed(
                row.uid, f"{type(error).__name__}: {error}", {"source": row.source}
            )
            continue
        manifest.record_done(result.uid, result.npz_path, result.report)
        reports.append(result.report)

    return reports


def _worker(args) -> float:
    """Frames processed, for the throughput benchmark only."""
    uid, path, out_dir, prefer_gpu = args
    sequence, _ = extract_clip(Path(path), uid=uid, prefer_gpu=prefer_gpu)
    return float(sequence.frame_count)


def benchmark_workers(
    clip_paths: Sequence[tuple[str, str]],
    out_dir: Path,
    *,
    counts: Sequence[int] = (1, 2, 4),
    prefer_gpu: bool = False,
) -> list[dict[str, Any]]:
    """Aggregate throughput and peak memory at each worker count.

    More workers are not automatically faster. The chosen count is justified
    from these numbers rather than assumed, because the difference between two
    and four decides whether the corpus takes days or weeks.
    """
    out: list[dict[str, Any]] = []
    for count in counts:
        started = time.perf_counter()
        before = peak_rss_mb()
        # Children are reaped between runs, so the child high-water mark is the
        # closest thing to a per-run reading available from rusage.
        child_before = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
        payload = [(uid, path, str(out_dir), prefer_gpu) for uid, path in clip_paths]

        if count == 1:
            frames = [_worker(item) for item in payload]
        else:
            with ProcessPoolExecutor(max_workers=count) as pool:
                frames = list(pool.map(_worker, payload))

        elapsed = time.perf_counter() - started
        out.append(
            {
                "workers": count,
                "clips": len(payload),
                "frames": int(sum(frames)),
                "seconds": elapsed,
                "frames_per_second": sum(frames) / elapsed if elapsed else 0.0,
                "peak_rss_mb": peak_rss_mb(),
                # What this run added on top of the session high-water mark.
                # The absolute figure is cumulative and identical across runs.
                "peak_rss_delta_mb": max(0.0, peak_rss_mb() - before),
                "child_peak_rss_mb": (
                    resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
                    / (1024 * 1024 if os.uname().sysname == "Darwin" else 1024)
                ),
                "child_peak_delta_mb": max(
                    0.0,
                    (resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss - child_before)
                    / (1024 * 1024 if os.uname().sysname == "Darwin" else 1024),
                ),
                "cpu_count": os.cpu_count(),
            }
        )
    return out


def projections(
    reports: Sequence[dict[str, Any]],
    *,
    usable_continuous: int,
    frames_per_second: float,
    tiers: Sequence[int] = TIERS,
) -> dict[str, Any]:
    """What the smoke test implies for each corpus size.

    Replaces the paper-derived estimates with arithmetic on measured per-clip
    cost. `frames_per_second` comes from the chosen worker count, so the hours
    quoted are the hours that configuration would actually take.
    """
    if not reports:
        return {"error": "no clips processed"}

    frames = np.array([r["frame_count"] for r in reports], dtype=float)
    sizes = np.array([r["npz_bytes"] for r in reports], dtype=float)
    durations = np.array([r["duration_ms"] for r in reports], dtype=float) / 1000.0

    per_clip_frames = float(frames.mean())
    per_clip_bytes = float(sizes.mean())
    per_clip_seconds = per_clip_frames / frames_per_second if frames_per_second else 0.0

    tiers = [*tiers, usable_continuous]
    out = {}
    for tier in tiers:
        label = "full usable continuous" if tier == usable_continuous else f"{tier:,}"
        out[label] = {
            "clips": int(tier),
            "video_hours": tier * float(durations.mean()) / 3600.0,
            "landmark_gb": tier * per_clip_bytes / (1024**3),
            "processing_hours": tier * per_clip_seconds / 3600.0,
        }
    return {
        "per_clip": {
            "mean_frames": per_clip_frames,
            "mean_npz_bytes": per_clip_bytes,
            "mean_duration_s": float(durations.mean()),
            "mean_seconds_to_process": per_clip_seconds,
        },
        "at_frames_per_second": frames_per_second,
        "tiers": out,
    }


def fps_distribution(reports: Sequence[dict[str, Any]]) -> dict[str, Any]:
    """Source frame rates, and how many clips fall below the model input rate.

    A clip slower than the common rate cannot fill it without repeating frames,
    and repeats read as motion that was never recorded.
    """
    from .temporal import DEFAULT_TARGET_FPS

    values = np.array([r["source_fps"] for r in reports if r.get("source_fps")], dtype=float)
    if values.size == 0:
        return {"clips": 0}
    return {
        "clips": int(values.size),
        "min": float(values.min()),
        "max": float(values.max()),
        "mean": float(values.mean()),
        "unique": sorted({round(v, 2) for v in values.tolist()}),
        "below_target": int((values < DEFAULT_TARGET_FPS).sum()),
        "target": DEFAULT_TARGET_FPS,
    }
