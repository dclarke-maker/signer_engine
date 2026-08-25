"""Generate notebooks/isl_preprocessing.ipynb.

The notebook is written from here rather than by hand so the cell sources stay
reviewable as Python and diffable as text, instead of being embedded in JSON with
escaped newlines.

Run: python -m tools.isl.build_notebook
"""

from __future__ import annotations

import json
from pathlib import Path

TARGET = Path("notebooks/isl_preprocessing.ipynb")

MD_INTRO = """# iSign preprocessing into the NSL landmark space

Prepares Indian Sign Language video for the RQ4 pre-training arm, in the same
landmark space as Nepali Sign Language capture.

**What this notebook does not do:** it does not pre-train anything, and it does
not process the full corpus. It runs a smoke test over ~30 representative clips
and reports what the full run would cost, so the corpus size is chosen from
measurements rather than from estimates.

### Before you run it

1. Accept the iSign terms at <https://huggingface.co/datasets/Exploration-Lab/iSign>.
   The dataset is gated and **CC-BY-NC-SA 4.0** — non-commercial, attribution,
   and derivatives carry the same terms.
2. Add a Hugging Face read token to **Colab Secrets** as `HF_TOKEN`, with
   notebook access enabled. It is never written into this notebook.

Everything after that is Run All.

### What it guarantees

- **Resumable.** Progress lives in a manifest on Drive. A disconnect costs at
  most the clip in flight, and re-running processes zero already-done clips.
- **Nothing important on local disk.** Manifest, outputs and reports are on
  Drive; only the video being decoded touches Colab's filesystem, and it is
  deleted immediately.
- **Batched.** Clips are read out of the split archive by HTTP range, so a
  thirty-clip smoke test does not download the corpus first.

The conventions being reproduced are in `docs/isl-preprocessing-contract.md`.
"""

CELL_SETUP = '''#@title Setup — repo, dependencies, Drive { display-mode: "form" }
REPO_URL = "https://github.com/dclarke-maker/signer_engine.git"  #@param {type:"string"}
REPO_BRANCH = "main"  #@param {type:"string"}
DRIVE_ROOT = "/content/drive/MyDrive/nsl-isl"  #@param {type:"string"}

import os, subprocess, sys
from pathlib import Path

from google.colab import drive
drive.mount("/content/drive")

REPO = Path("/content/signer_engine")
if not REPO.exists():
    subprocess.run(["git", "clone", "--depth", "1", "-b", REPO_BRANCH, REPO_URL, str(REPO)],
                   check=True)
else:
    subprocess.run(["git", "-C", str(REPO), "pull", "--ff-only"], check=False)
sys.path.insert(0, str(REPO))

# Drop any previously imported copies so a git pull actually takes effect.
# Python caches modules in sys.modules, so re-running this cell after a pull
# otherwise keeps executing the old bytecode while tracebacks render the new
# source - which reads as a fix that did not work rather than a stale import.
for _name in [m for m in list(sys.modules) if m == "tools" or m.startswith("tools.")]:
    del sys.modules[_name]

# mediapipe pulls a large wheel; skip when the runtime already has it.
try:
    import mediapipe  # noqa: F401
except ImportError:
    subprocess.run([sys.executable, "-m", "pip", "-q", "install",
                    "-r", str(REPO / "tools/isl/requirements.txt")], check=True)

DRIVE = Path(DRIVE_ROOT)
(DRIVE / "sequences").mkdir(parents=True, exist_ok=True)
(DRIVE / "reports").mkdir(parents=True, exist_ok=True)
print("repo :", REPO)
print("drive:", DRIVE)
'''

CELL_AUTH = '''#@title Authenticate — token from Colab Secrets, or prompted
import getpass
import os

# Colab Secrets when the notebook runs in the Colab web UI. The VS Code Colab
# extension gives a Colab *kernel* without that panel, so fall back to an
# environment variable and then to a hidden prompt. All three keep the token out
# of the notebook file - typing it into a cell would persist it in the .ipynb and
# then into git.
HF_TOKEN = None
try:
    from google.colab import userdata

    HF_TOKEN = userdata.get("HF_TOKEN")
    print("token: Colab Secrets")
except Exception:
    HF_TOKEN = os.environ.get("HF_TOKEN")
    if HF_TOKEN:
        print("token: HF_TOKEN environment variable")
    else:
        HF_TOKEN = getpass.getpass("Hugging Face read token (input hidden): ").strip()
        print("token: entered at the prompt")

if not HF_TOKEN:
    raise SystemExit(
        "No token. Either add it as the Colab secret HF_TOKEN with notebook "
        "access enabled, set the HF_TOKEN environment variable, or paste it at "
        "the prompt. Do not put it in a cell."
    )

HEADERS = {"Authorization": f"Bearer {HF_TOKEN}"}
REPO_ID = "Exploration-Lab/iSign"

# Fail here, with a reason, rather than at the archive cell twenty minutes in.
import requests as _requests

_probe = _requests.get(
    f"https://huggingface.co/api/datasets/{REPO_ID}", headers=HEADERS, timeout=30
)
if _probe.status_code == 401:
    raise SystemExit("Token rejected (401). Check it is a valid read token.")
if _probe.status_code == 403:
    raise SystemExit(
        f"Token is valid but access is denied (403). Accept the terms at "
        f"https://huggingface.co/datasets/{REPO_ID} using the same account the "
        "token belongs to, then re-run."
    )
_probe.raise_for_status()
print(f"authenticated, {REPO_ID} is accessible")
'''

CELL_TRIAGE = '''#@title Triage — which rows are continuous, and on what evidence
import json
import requests
from tools.isl import triage
from tools.isl.remote_zip import hf_urls

CSV_NAME = "iSign_v1.1.csv"  #@param {type:"string"}

session = requests.Session()
csv_path = DRIVE / CSV_NAME
if not csv_path.exists():
    url = hf_urls(REPO_ID, [CSV_NAME])[0]
    response = session.get(url, headers=HEADERS, timeout=120)
    response.raise_for_status()
    csv_path.write_bytes(response.content)
    print(f"downloaded {CSV_NAME} ({len(response.content)/1e6:.1f} MB)")

rows, triage_report = triage.load_rows(csv_path)
continuous, dropped = triage.select_continuous(rows)

print(f"columns          : {triage_report.header}")
print(f"uid / text / src : {triage_report.uid_column} / {triage_report.text_column} / {triage_report.source_column}")
print(f"rows             : {triage_report.total_rows:,}")
print(f"with segment pos : {triage_report.with_sequence_number:,}")
print(f"by source        : {triage_report.by_source}")
print(f"continuous       : {len(continuous):,}")
print(f"excluded         : {len(dropped):,}")
for note in triage_report.notes:
    print(f"  NOTE {note}")

# Selection is derived from corpus identifiers. Translation word count is
# deliberately not a criterion: an isolated sign can carry a multi-word gloss and
# a continuous utterance can translate to one word.
if not triage_report.unambiguous:
    print("\\n  The release did not carry unambiguous corpus identifiers.")
    print("  Treat the audit below as the deciding evidence, not a formality.")
'''

CELL_AUDIT = '''#@title Audit sheet — ~20 rows per inferred group, for a human to label
AUDIT_PER_GROUP = 20  #@param {type:"integer"}

audit_rows = triage.audit_sample(continuous, per_group=AUDIT_PER_GROUP)
audit_path = DRIVE / "reports" / "triage-audit.csv"
triage.write_audit_csv(audit_rows, audit_path)

print(f"wrote {audit_path} — {len(audit_rows)} rows across {len({r.source for r in audit_rows})} groups")
print("Fill in manual_continuous (TRUE/FALSE) by watching the clips, then run the")
print("accuracy cell at the end. This is what lets the write-up say samples were")
print("excluded by reproducible corpus identifiers rather than by appearance.")
'''

CELL_SELECT = '''#@title Select the clips — stratified, not the first N
# 30 for a smoke test; 15000 for the RQ4 pre-training corpus. Raising this is
# safe at any time: the manifest skips whatever is already done, so a larger
# number extends the corpus rather than reprocessing it.
SMOKE_CLIPS = 15000  #@param {type:"integer"}
VERIFICATION_JSON = 3  #@param {type:"integer"}

selected = triage.stratified_sample(continuous, SMOKE_CLIPS)
json_uids = [row.uid for row in selected[:VERIFICATION_JSON]]

videos = {row.video_id for row in selected}
print(f"selected {len(selected)} clips from {len(videos)} distinct source videos")
print(f"of which {len(json_uids)} also written as JSON for the equivalence check")
if len(videos) < min(len(selected), 10):
    # The first real run drew all thirty clips from two videos, and every
    # measurement taken from it described those two recordings.
    print("  Few source videos for this many clips - measurements may not generalise.")
# Taking the head of the file would sample one channel, one signer and one
# recording setup, and every number measured from it would generalise to nothing.
'''

CELL_ARCHIVE = '''#@title Open the split archive by byte range
from tools.isl.remote_zip import open_split_zip

VIDEO_PARTS = ["iSign-videos_v1.1_part_aa", "iSign-videos_v1.1_part_ab"]  #@param

urls = hf_urls(REPO_ID, VIDEO_PARTS)
archive = open_split_zip(urls, session=session, headers=HEADERS)
names = archive.namelist()
print(f"archive holds {len(names):,} members; first: {names[:3]}")

# Map uid -> member path once, so lookup during processing is not a scan.
by_stem = {}
for name in names:
    by_stem.setdefault(Path(name).stem, name)

missing = [row.uid for row in selected if row.uid not in by_stem]
if missing:
    print(f"  {len(missing)} selected uids are not in the archive, e.g. {missing[:3]}")
    selected = [row for row in selected if row.uid in by_stem]
    print(f"  continuing with {len(selected)}")
'''

CELL_PROCESS = '''#@title Process — resumable, skipping anything already done
import time
from tools.isl import smoke
from tools.isl.manifest import Manifest

PREFER_GPU = False  #@param {type:"boolean"}
RETRY_FAILED = False  #@param {type:"boolean"}
# 0 means "use the cores this machine has". MediaPipe here is CPU-bound - the
# GPU delegate is not used - so this is the single biggest lever on a corpus
# run. At one process it managed 3.3 clips a minute; 15,000 would have taken
# 64 hours on a machine with 48 cores idle.
WORKERS = 0  #@param {type:"integer"}
# Downloads are network waits, not CPU, so they want threads. With extraction
# parallel but fetching serial, throughput stuck at 9.4 clips a minute on a
# 48-core machine - one download after another was the whole ceiling.
FETCH_THREADS = 8  #@param {type:"integer"}

manifest = Manifest(DRIVE / "manifest.jsonl")
print(f"manifest: {len(manifest)} recorded, {len(manifest.done())} done")

def fetch(row):
    return archive.read(by_stem[row.uid])

def open_reader():
    """A fresh archive reader, for one fetch thread.

    Each holds a stream position and a read cache, so they cannot be shared
    between threads. Opening one re-reads the central directory, which is why
    this is per-thread rather than per-clip.
    """
    own = open_split_zip(urls, session=requests.Session(), headers=HEADERS)
    return lambda row: own.read(by_stem[row.uid])

todo = manifest.pending([r.uid for r in selected], retry_failed=RETRY_FAILED)
print(f"{len(todo)} to process, {len(selected) - len(todo)} already done")
if len(todo) > 200:
    print("Long run: enable Runtime > Background execution so a closed tab does "
          "not end it. A disconnect costs only the clip in flight either way.")

started = time.perf_counter()
import os
workers = WORKERS or max(1, (os.cpu_count() or 2) - 1)
print(f"{os.cpu_count()} cores, using {workers} workers and {FETCH_THREADS} fetch threads")

reports = smoke.run_batch(
    selected, fetch, DRIVE / "sequences", manifest,
    json_uids=json_uids, prefer_gpu=PREFER_GPU, retry_failed=RETRY_FAILED,
    progress_every=50, workers=workers,
    fetch_factory=open_reader if workers > 1 else None,
    fetch_workers=FETCH_THREADS,
)
elapsed = time.perf_counter() - started

print(f"processed {len(reports)} clips in {elapsed:.0f}s")
print(f"manifest now: {manifest.summary()}")
print("\\nRe-running this cell should process 0 clips — that is the resumability test.")
'''

CELL_VALIDATE = '''#@title Validate — contract conformance and .npz vs JSON equivalence
import numpy as np
from tools.isl import validate as V
from tools.isl.contract import sequence_from_npz

findings = []
for uid in json_uids:
    npz_path = DRIVE / "sequences" / f"{uid}.npz"
    json_path = DRIVE / "sequences" / f"{uid}.json"
    if not npz_path.exists() or not json_path.exists():
        continue
    sequence = sequence_from_npz(np.load(npz_path))
    payload = json.loads(json_path.read_text())

    conformance = V.check_sequence(sequence, uid)
    equivalence = V.compare_npz_json(sequence, payload)
    findings.append({"uid": uid, "conformance": conformance.as_dict(),
                     "equivalence": equivalence})

    print(f"{uid}: contract {'ok' if conformance.ok else 'FAILED'}")
    for stream, stats in equivalence["streams"].items():
        print(f"   {stream:10s} max diff {stats['max_abs_diff']:.3e}")
    print(f"   face visibility reconstructed exactly: "
          f"{equivalence['face_visibility_reconstruction_exact']}")
    for finding in conformance.findings:
        if not finding.ok:
            print(f"   FAILED {finding.check}: {finding.detail}")
'''

CELL_TEMPORAL = '''#@title Temporal — source rates, and what 20fps normalisation costs
from tools.isl.temporal import DEFAULT_TARGET_FPS, motion_preserved, resample

TARGET_FPS = 20.0  #@param {type:"number"}

fps_report = smoke.fps_distribution(reports or [e.detail for e in manifest.entries() if e.status == "done"])
print("source fps:", fps_report)

temporal_rows = []
for uid in json_uids:
    npz_path = DRIVE / "sequences" / f"{uid}.npz"
    if not npz_path.exists():
        continue
    sequence = sequence_from_npz(np.load(npz_path))
    resampled, r = resample(sequence, TARGET_FPS)
    motion = motion_preserved(sequence, resampled)
    temporal_rows.append({"uid": uid, "resample": r.as_dict(), "motion": motion})
    print(f"{uid}: {r.frames_before} -> {r.frames_after} frames "
          f"(source {r.source_fps:.1f}fps, below target: {r.below_target}, "
          f"duplicated {r.duplicated_frames})")
    # Fast hand movement is where sign languages carry information, so how much
    # of the trajectory survives is the number that says whether 20fps is safe.
    print(f"   hand path retained: {motion['path_retained']:.3f}")
'''

CELL_WORKERS = '''#@title Worker scaling — measured, not assumed
import tempfile

BENCH_CLIPS = 6  #@param {type:"integer"}
# Empty means "derive from the machine": 1,2,4,8,16,24 capped at the core count.
# A fixed list stopped at 4 on a 48-core runtime and missed the ceiling entirely.
WORKER_COUNTS = []  #@param

bench_dir = Path(tempfile.mkdtemp())
paths = []
for row in selected[:BENCH_CLIPS]:
    target = bench_dir / f"{row.uid}.mp4"
    target.write_bytes(archive.read(by_stem[row.uid]))
    paths.append((row.uid, str(target)))

bench = smoke.benchmark_workers(
    paths, bench_dir, counts=WORKER_COUNTS or None, prefer_gpu=PREFER_GPU
)
for entry in bench:
    print(f"{entry['workers']:3d} worker(s): {entry['frames_per_second']:7.1f} fps "
          f"| per-worker {entry['peak_worker_rss_mb']:6.0f} MB "
          f"| concurrent {entry['concurrent_rss_mb']:7.0f} MB")

best = max(bench, key=lambda e: e["frames_per_second"])
print(f"\\nfastest: {best['workers']} workers at {best['frames_per_second']:.1f} fps")
print("Choose from throughput AND memory: MediaPipe holds a model per process,")
print("so memory can bind before CPU does.")
'''

CELL_REPORT = '''#@title Report — projections and provenance, written to Drive
from tools.isl import provenance
from tools.isl.extractor import DEFAULT_MODEL

done = [e.detail for e in manifest.entries() if e.status == "done" and e.detail]
proj = smoke.projections(
    done,
    usable_continuous=len(continuous),
    frames_per_second=best["frames_per_second"],
)

# Defensive: a partial re-run may not have populated the optional sections.
findings = globals().get("findings", [])
temporal_rows = globals().get("temporal_rows", [])
fps_report = globals().get("fps_report", {})

smoke_report = {
    "provenance": provenance.collect(
        repo=REPO,
        model_path=REPO / "native/holistic/models/holistic_landmarker.task",
        csv_path=csv_path,
        dataset_revision="v1.1",
        worker_count=best["workers"],
        delegate="GPU" if PREFER_GPU else "CPU",
    ),
    "triage": triage_report.as_dict(),
    "usable_continuous": len(continuous),
    "smoke": {"clips": len(done), "manifest": manifest.summary()},
    "validation": findings,
    "temporal": {"fps": fps_report, "clips": temporal_rows, "target_fps": TARGET_FPS},
    "workers": bench,
    "projections": proj,
}

out = DRIVE / "reports" / "smoke-report.json"
out.write_text(json.dumps(smoke_report, indent=2, default=str))

print(f"usable continuous clips: {len(continuous):,}\\n")
for label, tier in proj["tiers"].items():
    print(f"{label:>24}: {tier['video_hours']:8.1f} h video  "
          f"{tier['landmark_gb']:7.1f} GB landmarks  "
          f"{tier['processing_hours']:7.1f} h processing")
print(f"\\nwrote {out}")
print("Send this file, the manifest, and a couple of .npz/.json pairs back.")
'''

CELL_ACCURACY = '''#@title Triage accuracy — run after filling in the audit sheet
import csv as _csv

audit_file = DRIVE / "reports" / "triage-audit.csv"
inferred, manual = {}, {}
with open(audit_file, newline="", encoding="utf8") as handle:
    for row in _csv.DictReader(handle):
        verdict = (row.get("manual_continuous") or "").strip().upper()
        if verdict in ("TRUE", "FALSE"):
            inferred[row["uid"]] = row["inferred_continuous"].strip().upper() == "TRUE"
            manual[row["uid"]] = verdict == "TRUE"

accuracy = triage.classification_accuracy(inferred, manual)
print(accuracy)
if accuracy["compared"] == 0:
    print("\\nNothing labelled yet — fill in manual_continuous and re-run.")
elif accuracy["accuracy"] is not None and accuracy["accuracy"] < 0.95:
    # Below near-perfect agreement the identifiers are not carrying the decision,
    # and the criterion has to change before the corpus is built.
    print("\\n  Agreement is low. Do not scale up on this criterion.")
'''


def notebook() -> dict:
    def md(text: str) -> dict:
        return {"cell_type": "markdown", "metadata": {}, "source": text.splitlines(True)}

    def code(text: str) -> dict:
        return {
            "cell_type": "code",
            "execution_count": None,
            "metadata": {},
            "outputs": [],
            "source": text.splitlines(True),
        }

    return {
        "nbformat": 4,
        "nbformat_minor": 0,
        "metadata": {
            "colab": {"provenance": [], "toc_visible": True},
            "kernelspec": {"name": "python3", "display_name": "Python 3"},
            "language_info": {"name": "python"},
        },
        "cells": [
            md(MD_INTRO),
            code(CELL_SETUP),
            code(CELL_AUTH),
            md("## 1. Which rows are continuous\n"),
            code(CELL_TRIAGE),
            code(CELL_AUDIT),
            code(CELL_SELECT),
            md("## 2. Read the clips without downloading the corpus\n"),
            code(CELL_ARCHIVE),
            md("## 3. Process\n"),
            code(CELL_PROCESS),
            md("## 4. Prove it is in the NSL landmark space\n"),
            code(CELL_VALIDATE),
            md("## 5. Frame rate\n"),
            code(CELL_TEMPORAL),
            md("## 6. How many workers\n"),
            code(CELL_WORKERS),
            md("## 7. What the full run would cost\n"),
            code(CELL_REPORT),
            md("## 8. Triage accuracy — after the audit sheet is filled in\n"),
            code(CELL_ACCURACY),
        ],
    }


if __name__ == "__main__":
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(notebook(), indent=1))
    print(f"wrote {TARGET}")
