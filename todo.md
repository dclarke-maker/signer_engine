# Project TODO

Reconciled against `design.md` and *Research Methodology — Assignment 2 (Proposal)* on 2026-08-22.
Implementation plan: `docs/superpowers/plans/2026-08-22-nsl-landmark-pipeline.md`

## Blocking

- [ ] **A device build.** `expo prebuild` and a native build need Xcode and/or the Android SDK. This host has neither, nor Node itself — all work so far has run in a container. Nothing below can be verified until this exists.

## Remaining work

- [ ] **Build and run the plugin.** The Swift and Kotlin sources are written against the real MediaPipe Tasks and Vision Camera APIs but have never been compiled. Expect signature fixes on first build.
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

## Superseded

Completed against the pre-proposal design and now replaced by the privacy pipeline.

- [x] ~~Add signer video capture with camera and microphone permissions.~~ No video is captured; the microphone is not used at all.
- [x] ~~Implement capture review and submission state handling.~~ Review presents a sequence summary, not a recording.
- [x] ~~Configure production recording storage for Hetzner Object Storage.~~ The bucket holds landmark sequences.
