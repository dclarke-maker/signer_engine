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
import threading
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
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


def _fetch_then_extract(fetch_one, row, out_dir, write_json, prefer_gpu, pool):
    """Download on this thread, extract in a process, return the outcome.

    The two halves want different concurrency: a byte range over HTTP is waiting
    on the network and belongs on a thread, while MediaPipe is pure CPU and
    belongs in a process.
    """
    try:
        video_bytes = fetch_one(row)
    except Exception as error:  # noqa: BLE001
        return row.uid, None, f"{type(error).__name__}: {error}"
    future = pool.submit(
        _process_payload,
        (row.uid, video_bytes, out_dir, row.text, row.source, write_json, prefer_gpu),
    )
    return future.result()


def _process_payload(args) -> tuple[str, dict[str, Any] | None, str | None]:
    """Extract one clip in a worker. Returns (uid, report, error)."""
    uid, video_bytes, out_dir, text, source, write_json, prefer_gpu = args
    try:
        result = process_clip(
            uid, video_bytes, Path(out_dir),
            text=text, source=source, write_json=write_json, prefer_gpu=prefer_gpu,
        )
    except Exception as error:  # noqa: BLE001
        return uid, None, f"{type(error).__name__}: {error}"
    return uid, result.report, None


def run_batch(
    rows: Sequence[Row],
    fetch: Callable[[Row], bytes],
    out_dir: Path,
    manifest: Manifest,
    *,
    json_uids: Sequence[str] = (),
    prefer_gpu: bool = False,
    retry_failed: bool = False,
    progress_every: int = 0,
    workers: int = 0,
    fetch_factory: Callable[[], Callable[[Row], bytes]] | None = None,
    fetch_workers: int = 8,
) -> list[dict[str, Any]]:
    """Process what is not already done, recording each outcome as it lands.

    Fetching stays in the parent and extraction goes to workers. That split is
    forced rather than chosen: `fetch` closes over an open archive reading over
    HTTP, which is neither picklable nor safe to share between processes, while
    MediaPipe is pure CPU and is the part worth parallelising.

    `workers` defaults to the cores available, minus one. The default lives here
    rather than in the notebook on purpose: a notebook's cell source is fixed
    when Colab opens it and is *not* updated by the setup cell's git pull, so a
    caller written before this argument existed would otherwise keep running
    single-process no matter how many times the repo was pulled. That is exactly
    what happened - the parallel code sat unused in the repo for a whole run.
    Pass `workers=1` to force everything inline, which is what the smoke test
    wants: a correctness pass whose timings are not confounded by pool overhead.

    Fetching is then the next ceiling, and it is not CPU work - it is a byte
    range over HTTP, so it wants threads rather than processes. Parallelising
    extraction alone took this from 3.3 to 9.4 clips a minute, when 47 workers
    should have given far more; the missing time was one serial download after
    another. `fetch_factory` supplies a fetcher per thread, because a single
    archive reader holds one position and one cache and cannot be shared.
    Without it, fetching stays serial and `fetch` is used as-is.
    """
    if workers <= 0:
        workers = max(1, (os.cpu_count() or 2) - 1)

    pending = set(manifest.pending([row.uid for row in rows], retry_failed=retry_failed))
    todo = [r for r in rows if r.uid in pending]
    wanted_json = set(json_uids)
    reports: list[dict[str, Any]] = []
    started = time.perf_counter()
    seen = 0

    def payload_for(row: Row):
        return (
            row.uid, fetch(row), str(out_dir), row.text, row.source,
            row.uid in wanted_json, prefer_gpu,
        )

    def record(uid: str, report: dict[str, Any] | None, error: str | None, source: str) -> None:
        nonlocal seen
        if error is not None:
            # Reason, not just the fact. "Why did 4% fail" has to be answerable
            # before anyone commits to processing the corpus.
            manifest.record_failed(uid, error, {"source": source})
        else:
            manifest.record_done(uid, str(Path(out_dir) / f"{uid}.npz"), report or {})
            reports.append(report or {})
        seen += 1
        # A corpus run is hours long; silence is indistinguishable from a hang.
        if progress_every and seen % progress_every == 0:
            rate = seen / max(time.perf_counter() - started, 1e-9)
            print(
                f"  {seen}/{len(todo)} clips, {rate * 60:.1f}/min, "
                f"~{(len(todo) - seen) / rate / 3600:.1f}h left",
                flush=True,
            )

    if workers <= 1 or not todo:
        for row in todo:
            try:
                uid, report, error = _process_payload(payload_for(row))
            except Exception as fetch_error:  # noqa: BLE001 - the fetch itself
                uid, report, error = row.uid, None, f"{type(fetch_error).__name__}: {fetch_error}"
            record(uid, report, error, row.source)
        return reports

    # Bounded in flight, so fetching never runs far ahead of extraction and the
    # whole corpus is not held in memory as video bytes.
    sources = {row.uid: row.source for row in todo}
    local = threading.local()

    def thread_fetch(row: Row) -> bytes:
        """One archive reader per thread; they hold a position and a cache."""
        if fetch_factory is None:
            return fetch(row)
        reader = getattr(local, "reader", None)
        if reader is None:
            reader = local.reader = fetch_factory()
        return reader(row)

    queue = iter(todo)
    queue_lock = threading.Lock()

    def next_row() -> Row | None:
        with queue_lock:
            return next(queue, None)

    fetch_pool = ThreadPoolExecutor(max_workers=max(1, fetch_workers))
    try:
        with ProcessPoolExecutor(max_workers=workers) as pool:
            in_flight: dict[Any, str] = {}

            def submit_next() -> bool:
                row = next_row()
                if row is None:
                    return False
                # Fetch on a thread, then hand the bytes to a process.
                in_flight[fetch_pool.submit(_fetch_then_extract, thread_fetch, row,
                                            str(out_dir), row.uid in wanted_json,
                                            prefer_gpu, pool)] = row.uid
                return True

            for _ in range(max(workers, fetch_workers) * 2):
                if not submit_next():
                    break

            while in_flight:
                for future in as_completed(list(in_flight), timeout=None):
                    in_flight.pop(future, None)
                    uid, report, error = future.result()
                    record(uid, report, error, sources.get(uid, ""))
                    submit_next()
                    break
    finally:
        fetch_pool.shutdown(wait=False)

    return reports


def _worker(args) -> tuple[float, float]:
    """Frames processed and this process's own peak RSS.

    Memory is reported from inside the worker because the parent cannot see it:
    ru_maxrss is a high-water mark that never falls, so a parent-side reading is
    cumulative across the whole session and reports the same figure for every
    worker count - which is exactly what the first two runs produced.
    """
    uid, path, out_dir, prefer_gpu = args
    sequence, _ = extract_clip(Path(path), uid=uid, prefer_gpu=prefer_gpu)
    scale = 1024 * 1024 if os.uname().sysname == "Darwin" else 1024
    own = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / scale
    return float(sequence.frame_count), float(own)


def benchmark_workers(
    clip_paths: Sequence[tuple[str, str]],
    out_dir: Path,
    *,
    counts: Sequence[int] | None = None,
    prefer_gpu: bool = False,
) -> list[dict[str, Any]]:
    """Aggregate throughput and peak memory at each worker count.

    More workers are not automatically faster - on a two-core runtime throughput
    was flat, because MediaPipe already multi-threads inside one process. On 48
    cores it scaled near-linearly. So the counts tried are derived from the
    machine rather than fixed, and capped at the core count.
    """
    if counts is None:
        cpus = os.cpu_count() or 2
        counts = [c for c in (1, 2, 4, 8, 16, 24) if c <= cpus] or [1]
    out: list[dict[str, Any]] = []
    for count in counts:
        started = time.perf_counter()
        before = peak_rss_mb()
        payload = [(uid, path, str(out_dir), prefer_gpu) for uid, path in clip_paths]

        if count == 1:
            results = [_worker(item) for item in payload]
        else:
            with ProcessPoolExecutor(max_workers=count) as pool:
                results = list(pool.map(_worker, payload))

        frames = [f for f, _ in results]
        worker_rss = [m for _, m in results]
        elapsed = time.perf_counter() - started
        out.append(
            {
                "workers": count,
                "clips": len(payload),
                "frames": int(sum(frames)),
                "seconds": elapsed,
                "frames_per_second": sum(frames) / elapsed if elapsed else 0.0,
                # Measured inside the workers. `peak_worker_rss_mb` is one
                # process; `concurrent_rss_mb` is the worst case with `count` of
                # them alive at once, which is the figure that decides whether a
                # worker count fits in the runtime's memory.
                "peak_worker_rss_mb": max(worker_rss) if worker_rss else 0.0,
                "concurrent_rss_mb": (max(worker_rss) if worker_rss else 0.0) * count,
                "session_rss_mb": peak_rss_mb(),
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
