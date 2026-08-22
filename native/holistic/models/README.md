# Holistic model

`holistic_landmarker.task` is committed rather than fetched at build time.

Two reasons. EAS runs `expo prebuild` on its own machines, so anything excluded
from the repository never reaches the build. And the upstream URL points at
`latest`, which means an unpinned model could change underneath the study — the
export manifest records an extractor version, but a silently different model
would make results incomparable across collection rounds.

| | |
| --- | --- |
| Source | `https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/latest/holistic_landmarker.task` |
| Size | 13 MB |
| SHA-256 | `e2dab61191e2dcd0a15f943d8e3ed1dce13c82dfa597b9dd39f562975a50c3f8` |

`scripts/fetch-holistic-model.sh` re-downloads it. Verify the checksum before
replacing this file, and treat a change as a change to the pipeline.
