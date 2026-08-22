# Project TODO

Reconciled against `design.md` and *Research Methodology — Assignment 2 (Proposal)* on 2026-08-22.
Implementation plan: `docs/superpowers/plans/2026-08-22-nsl-landmark-pipeline.md`

## Blocking — needs a decision

**No React Native package provides MediaPipe hand landmarks.** Checked against the registry:

| Package | Provides | Hands? |
| --- | --- | --- |
| `@mediapipe/tasks-vision@1.0.1` (Google) | `HolisticLandmarker` — face, pose, both hands, one model | Yes, but **JS/WASM only** |
| `react-native-mediapipe@0.6.0` | pose, face, object detection | **No** |
| `@thinksys/react-native-mediapipe` | pose skeleton, untyped callback | **No** |

Hands are the primary manual channel for sign language, so a package without them cannot implement this pipeline. Three paths:

- [ ] **A — Custom native plugin.** Write a Swift/Kotlin frame processor wrapping MediaPipe Tasks. Full control and native frame rates; several days of native work, plus Xcode / Android SDK.
- [ ] **B — WASM holistic in a WebView.** `lib/extractors/holistic-web-extractor.ts` is written and type-verified against the official package; it needs a `<video>` element and live browser verification. Works today on web; frame rate on device is the open risk.
- [ ] **C — Measure first.** Verify B's frame rate on a target device, then decide whether A is necessary or merely preferable.

Earlier notes about a `react-native-worklets-core` conflict are moot: that peer belongs to `react-native-vision-camera@4`, and no vision-camera version supplies hand landmarks anyway.

## Remaining work

- [ ] Decide between paths A, B, and C above, then wire the chosen extractor into `lib/extractors/index.ts`. No screen changes required either way.
- [ ] Give the web extractor a `<video>` source. `expo-camera`'s `CameraView` renders one internally on web but does not expose a ref, so this needs either a web-specific capture path or a plain `getUserMedia` video element.
- [ ] Verify holistic extraction live: face 468, pose 33, 21 per hand, and the achieved frame rate on a target device.
- [ ] Implement the workshop calibration buffer itself. The environment contract, consent scope, and retention ceiling exist; the encrypted transient store and scheduled purge do not.
- [ ] Wire the export services to a command or endpoint. `buildTrainingJsonl`, `buildElanTiers`, and `exportManifest` are implemented and tested but nothing calls them yet.
- [ ] Retire or quarantine unrelated Manus template scaffolding: `server/_core/{llm,imageGeneration,voiceTranscription,oauth}.ts`, `server/storage.ts`, the `users` table, `app/oauth/callback.tsx`.

## Known issues found during implementation

- [ ] `internalAdmin.inviteSigner` creates the invitation row before sending the email. When SMTP fails the invitation exists but the administrator never learns the token, leaving an unusable orphaned invitation with no resend path.
- [ ] `components/ui/icon-symbol.tsx` casts its mapping `as IconMapping`, so `keyof typeof MAPPING` resolves to every SF Symbol name. A missing icon type-checks cleanly and renders blank on Android and web.

## Complete

### Privacy pipeline
- [x] `LandmarkExtractor` interface (hand 21×2, face 468, pose 33) with a deterministic fixture implementation for CI.
- [x] Removed `recordAsync` and the `recordingUri` flow; no video path remains on the participant side.
- [x] Object-storage boundary retargeted from MP4 recordings to gzipped landmark-sequence blobs.
- [x] Authenticated sequence-upload endpoint, registered ahead of the body parsers so it receives raw bytes.
- [x] Production storage fails fast on missing credentials and never auto-creates the bucket.

### Corpus and prompts
- [x] `SentencePrompt` schema, all 100 Appendix A sentences seeded, `each category === 20` regression guard.
- [x] Seeded per-signer prompt order that interleaves categories, with server-authoritative `n of 100` progress.
- [x] Prompt Session screen with skip-with-reason and redo; category carried on the session.
- [x] Contribution Progress tab.

### Non-manual marker heuristics
- [x] All five rules as pure functions on the proposal's exact landmark indices.
- [x] Per-signer baseline normalisation from the opening frames.
- [x] Versioned threshold profiles; every stored tag records its `ruleVersion`.
- [x] Unit tests covering detection, neutral, and cross-talk, on anatomically plausible fixtures.

### Translation and feedback
- [x] `SignTranslator` interface with a deterministic fixture translator as the CI implementation.
- [x] `TranslationJob` lifecycle with `modelVersion` and `latencyMs`; failed jobs recorded, not deleted.
- [x] Live Translate screen replacing the passive evaluation fixture.
- [x] Feedback votes persisted — they were previously echoed and discarded.
- [x] Three Likert scales (naturalness, grammaticality, usefulness) as `QualitativeRating`.

### Research data governance
- [x] Versioned, scoped, revocable `ConsentRecord`; capture unreachable without a current grant.
- [x] Consent screen with withdrawal from Settings.
- [x] Seeded signer-independent stratified `SplitAssignment` (70/15/15).
- [x] Training JSONL, ELAN tier, and provenance manifest builders.

### Corrections to previously claimed work
- [x] `SignerCapture.status` drift resolved — DB enums now derive from the shared vocabularies.
- [x] Capture access-authorization tests added; they had been marked done but did not exist.
- [x] `putSignerRecording` dead code removed along with the rest of the MP4 path.

### Infrastructure
- [x] Compose files retargeted to `signbridge-sequences`, with consent, split-seed, and calibration-buffer variables.
- [x] `DEVELOPMENT.md` rewritten for the landmark pipeline, privacy posture, and prebuild requirement.

## Superseded

Completed against the pre-proposal design and now replaced by the privacy pipeline.

- [x] ~~Add signer video capture with camera and microphone permissions.~~ No video is captured; the microphone is not used at all.
- [x] ~~Implement capture review and submission state handling.~~ Review presents a sequence summary, not a recording.
- [x] ~~Configure production recording storage for Hetzner Object Storage.~~ The bucket holds landmark sequences.
