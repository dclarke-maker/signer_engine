# ISL preprocessing

Turns Indian Sign Language video into the same landmark space as Nepali Sign
Language capture, for the RQ4 pre-training arm.

Read `docs/isl-preprocessing-contract.md` first — it is what this code
implements, and `lib/extractors/holistic-buffer.ts` is what *that* is derived
from.

## Running the smoke test

Everything happens in `notebooks/isl_preprocessing.ipynb` on Colab. Before the
first run:

1. Accept the terms at <https://huggingface.co/datasets/Exploration-Lab/iSign>.
   The dataset is gated and **CC-BY-NC-SA 4.0**.
2. Create a Hugging Face **read** token.
3. In Colab, add it under **Secrets** (the key icon) as `HF_TOKEN` and enable
   notebook access. It is never written into the notebook.

Then Run All. It processes ~30 stratified clips, validates them, benchmarks
worker counts, and writes `reports/smoke-report.json` to Drive.

Re-running processes zero already-done clips. That is the resumability test, not
a side effect.

## Layout

| File | |
| --- | --- |
| `contract.py` | Counts, ordering, truncation, rounding, serialisation. Imports no MediaPipe, so it stays testable. |
| `extractor.py` | Video → landmarks, mirroring the Kotlin plugin. |
| `remote_zip.py` | Reads members out of iSign's split archive by HTTP range, so a smoke test does not need the corpus on disk. |
| `triage.py` | Continuous-vs-isolated selection from corpus identifiers, plus the manual audit sheet. |
| `manifest.py` | Append-only JSONL on Drive. Resume, skip, failures with reasons. |
| `temporal.py` | Common frame rate at **model input** — deliberately outside the extraction contract. |
| `smoke.py` | Batch processing, worker benchmarking, corpus projections. |
| `validate.py` | Contract conformance and `.npz`↔JSON equivalence. |
| `cross_runtime.py` | Android extractor vs Python extractor on identical frames. |
| `provenance.py` | Versions, model SHA-256, machine, dataset revision — in every report. |

## Tests

```bash
docker run --rm -v "$PWD":/w -w /w python:3.11-slim sh -lc \
  'pip install -q -r tools/isl/requirements-dev.txt && PYTHONPATH=/w python -m pytest tools/isl/tests -q'
```

`tests/isl-contract.test.ts` is the other half: it feeds a payload emitted by
this package through the real NSL server code, so drift between the two runtimes
becomes a failing build.

## Cross-runtime equivalence

Same weights are not the same preprocessing. To measure the difference:

```bash
python -m tools.isl.make_frames path/to/clip.mp4 --count 8   # frames are NOT committed
npx expo prebuild --platform android
cd android && ./gradlew connectedAndroidTest
adb pull /sdcard/Android/data/<pkg>/files/holistic-equivalence.json
python -m tools.isl.cross_runtime holistic-equivalence.json
```

No tolerance is asserted until one has been measured — two runtimes on two
delegates will not agree bit for bit, and a threshold invented in advance would
either pass everything or fail on arrival.

## Regenerating

```bash
python -m tools.isl.build_notebook                                   # the notebook
python -m tools.isl.make_fixture tests/fixtures/isl-verification.json && \
  gzip -9 tests/fixtures/isl-verification.json                       # the TS fixture
```
