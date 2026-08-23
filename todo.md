# Project TODO

Reconciled against `design.md` and *Research Methodology — Assignment 2 (Proposal)* on 2026-08-22.
Implementation plan: `docs/superpowers/plans/2026-08-22-nsl-landmark-pipeline.md`

## Blocking

- [ ] **A device build.** `expo prebuild` and a native build need Xcode and/or the Android SDK. This host has neither, nor Node itself — all work so far has run in a container. Nothing below can be verified until this exists.

## Remaining work

- [x] ~~Build the Android plugin.~~ **Compiles and ships.** Build `30b6b222` succeeded; the APK carries `HolisticFrameProcessorPlugin`, its package registration, and the model STORED-uncompressed so MediaPipe can memory-map it. Two fixes were needed: an `expo-dev-client` version mismatch, and `frame.imageProxy.toBitmap()` replaced with `frame.image`.
- [x] ~~Build the Swift plugin.~~ **Compiles and ships.** Build `e1ea1681` (ios-simulator) succeeded; `HolisticFrameProcessorPlugin` and the `holisticLandmarks` registration are in `SignBridge.debug.dylib`, and the model is bundled. One fix was needed: `FrameProcessorPlugin` does not store the proxy it is initialised with, so the plugin keeps its own reference.
- [ ] **Run extraction on iOS.** A simulator has no camera, so nothing above proves MediaPipe works there. Needs a device build, which needs an Apple Developer membership.
- [ ] **Install the APK on a device and confirm extraction actually works.** Compiling proves nothing about output. Follow `docs/device-verification.md`, which lists the numbers and what they mean. Needs an Android device that is not HarmonyOS NEXT.
- [ ] **Verify against the wire format.** `encodeHolisticBuffer` in `lib/extractors/holistic-buffer.ts` is the executable spec; confirm the native writers produce a buffer the decoder accepts, then check face 468, pose 33, 21 per hand, and the achieved frame rate.
- [ ] Give the web extractor a `<video>` source. `expo-camera`'s `CameraView` renders one internally on web but does not expose a ref, so this needs a web-specific capture path or a plain `getUserMedia` element.

## Corpus translation

- [ ] **Have a native Nepali speaker review all 100 renderings**, ideally through NDFN. They are drafted in-project and marked `machine-draft`; collection must not begin on drafts, because the signer reads the Nepali while the model is scored against the English. Flip `nepaliSource` to `ndfn-validated` per prompt as they are checked.
- [x] ~~Decide whether written-Nepali prompting is right.~~ **Settled: text prompts stay.** Participants are trained, qualified signers, so literacy is not the limiting factor it would be with a general Deaf sample. More importantly, the variation between signers rendering the same sentence is the training signal, not noise — it is what lets the model generalise to an unseen signer, and it is what the signer-independent split measures. A signed-video prompt would invite mimicry and suppress exactly that variation.

## Elsewhere

- [ ] Implement the workshop calibration buffer itself. The environment contract, consent scope, and retention ceiling exist; the encrypted transient store and scheduled purge do not.
- [ ] Retire the remaining Manus OAuth scaffolding: `server/_core/{oauth,sdk,notification,storageProxy}.ts`, the `users` table, and `app/oauth/callback.tsx`. Unlike the files already removed, these are still wired in — `sdk.authenticateRequest` runs in `createContext` and `oauth`/`storageProxy` register routes — so removing them means changing the auth path, which participant sign-in does not use but the template's `auth.me` does.

## Known issues found during implementation

- [x] `internalAdmin.inviteSigner` left an orphaned invitation when SMTP failed. It now withdraws the invitation and reports that nothing is outstanding.
- [x] `components/ui/icon-symbol.tsx` used `as IconMapping`, which widened the key type so a missing icon type-checked and rendered blank. Now `satisfies`, so an unmapped name is a compile error.

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

## Open — found while verifying on a device

- [ ] **Sequences are uploaded uncompressed.** `lib/upload-sequence.ts` sends plain
  `application/json`. The server already gunzips (`sequence-upload.ts` branches on
  `application/gzip`), the storage key already ends `.json.gz`, and design.md §4.4
  says sequences are compressed — only the client half was never written, so the
  stored object is uncompressed JSON behind a `.json.gz` name.

  Measured on the real 128-frame sequence pulled back out of MinIO:

  | | per sentence | per signer (100) | study (35 signers) |
  | --- | --- | --- | --- |
  | today, uncompressed | 15.8 MB | 1.5 GB | 54 GB |
  | gzip only | 5.6 MB | 0.6 GB | 19 GB |
  | 5 decimals + gzip | 2.1 MB | 0.2 GB | 7 GB |

  Coordinates serialise at full float64 (`0.6392536163330078`). Rounding to five
  decimals is 1e-5, which on a 1080px frame is a hundredth of a pixel — far below
  what MediaPipe resolves — so it is lossless for this purpose and does most of the
  work. Needs a pure-JS gzip (`fflate`) since Hermes has no `CompressionStream`.

  This matters for fieldwork, not just for the bucket: participants upload 100
  sentences over their own mobile data in the Kathmandu Valley.

## Superseded

Completed against the pre-proposal design and now replaced by the privacy pipeline.

- [x] ~~Add signer video capture with camera and microphone permissions.~~ No video is captured; the microphone is not used at all.
- [x] ~~Implement capture review and submission state handling.~~ Review presents a sequence summary, not a recording.
- [x] ~~Configure production recording storage for Hetzner Object Storage.~~ The bucket holds landmark sequences.
