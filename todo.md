# Project TODO

Reconciled against `design.md` and *Research Methodology — Assignment 2 (Proposal)* on 2026-08-22.
Implementation plan: `docs/superpowers/plans/2026-08-22-nsl-landmark-pipeline.md`

## Blocking

- [ ] Resolve the frame-processor dependency mismatch: `react-native-worklets@0.5.1` is installed, but Vision Camera v4 frame processors require `react-native-worklets-core`.
- [ ] Run `pnpm install` — `node_modules` is absent, so nothing currently builds or tests.

## Privacy pipeline — the proposal's core commitment

- [ ] Add `react-native-vision-camera` and a MediaPipe Tasks config plugin; move the build to `expo prebuild` + custom dev client.
- [ ] Define the `LandmarkExtractor` interface (hand 21×2, face 468, pose 33) and ship a deterministic fixture implementation for CI.
- [ ] Implement the MediaPipe Tasks extractor behind that interface.
- [ ] Remove `recordAsync` and the `recordingUri` flow from `app/capture.tsx` and `app/capture-review.tsx`.
- [ ] Retarget the object-storage boundary from MP4 recordings to compressed landmark-sequence blobs.
- [ ] Add the authenticated sequence-upload endpoint. `server/recording-storage.ts:putSignerRecording` is currently dead code — nothing calls it and no route is registered.
- [ ] Scope the raw-video path to the workshop calibration buffer: off by default, flag-gated, encrypted, scheduled purge, audit-logged.

## Corpus and prompts

- [ ] Add the `SentencePrompt` schema and seed all 100 Appendix A sentences with a `each category === 20` validation check. Record the transcription fix for `" need help with this form."` (missing leading "I") inline in the seed.
- [ ] Implement seeded per-participant prompt assignment with server-authoritative `n of 100` progress.
- [ ] Build the Prompt Session screen with skip-with-reason and redo; carry category on the session.
- [ ] Build the Contribution Progress screen.

## Non-manual marker heuristics

- [ ] Implement the five detection rules as pure functions over landmark windows — eyebrow raise (face 33, 133, 105, 334), headshake (face 0; pose 11, 12), shoulder shrug (pose 11, 12; face 7, 8), forward lean (pose 11, 12, 23, 24), body tilt (pose 11, 12).
- [ ] Add per-signer baseline normalization (shoulder width, neutral head position) from opening frames.
- [ ] Make thresholds versioned configuration, not constants; stamp `ruleVersion` on every tag.
- [ ] Unit-test each rule with fixed landmark arrays covering detect, near-threshold, and absent cases.
- [ ] Add the NDFN workshop extension path so new markers arrive as a rule module plus a threshold profile.

## Translation and feedback

- [ ] Add the `SignTranslator` interface and a deterministic fixture translator as the CI implementation.
- [ ] Add the `TranslationJob` lifecycle with `modelVersion` and `latencyMs`.
- [ ] Replace the passive evaluation screen with the Live Translate flow (sign → extract → translate → result).
- [ ] Persist feedback votes. `feedback.submit` currently echoes its input and stores nothing.
- [ ] Add the three Likert scales — naturalness, grammaticality, usefulness — as `QualitativeRating`.

## Research data governance

- [ ] Add versioned, scoped, revocable `ConsentRecord`; block all capture until a current grant exists.
- [ ] Build the Consent screen with withdrawal reachable from Settings.
- [ ] Add seeded signer-independent stratified `SplitAssignment` (70 / 15 / 15).
- [ ] Add the training (JSONL), ELAN, and feedback exports with a provenance manifest; exclude withdrawn participants at the query.

## Corrections to previously claimed work

- [ ] `SignerCapture.status` in `shared/workflow.ts` (`recorded｜submitted｜failed`) drifts from the DB enum (`accepted｜uploaded｜failed`). Align to the `CaptureSession` vocabulary in `design.md` §11.
- [ ] Add the capture access-authorization tests. These were previously marked done; `tests/` contains none.
- [ ] Retire or quarantine unrelated Manus template scaffolding: `server/_core/{llm,imageGeneration,voiceTranscription,oauth}.ts`, `server/storage.ts`, the `users` table, `app/oauth/callback.tsx`.

## Superseded

These were completed against the pre-proposal design and are now superseded by the privacy pipeline above.

- [x] ~~Add signer video capture with explicit camera and microphone permissions.~~ Superseded: no video is captured; microphone is not used.
- [x] ~~Implement capture review and submission state handling.~~ Superseded: review presents a sequence summary, not a recording.
- [x] ~~Configure production recording storage for Hetzner Object Storage.~~ Superseded: the bucket holds landmark sequences; video only under the calibration-buffer exception.
- [x] ~~Add a storage adapter for LocalStack / MinIO.~~ Superseded by the MinIO adapter, retargeted to sequence blobs.

## Complete and still valid

- [x] Configure the SignBridge visual language and stage-aware navigation.
- [x] Design first-party signer accounts with administrator-managed approved email addresses.
- [x] Add one-time invitation and password-setup foundations for approved signers.
- [x] Require a signer session before capture and associate capture metadata with the signer.
- [x] Add public API procedure for workflow configuration.
- [x] Add Docker Compose services for the backend, MariaDB, MinIO, and Mailpit.
- [x] Configure the invitation mail adapter for Mailpit locally and Gmail SMTP in production.
- [x] Add local email delivery simulation and document production email configuration.
- [x] Document local startup, API configuration, and the Hetzner deployment hand-off path.
- [x] Document low-cost storage, backup, and email-delivery trade-offs for the Hetzner deployment.
- [x] Add deterministic unit tests for stage selection.
- [x] Generate a production-ready SignBridge app icon and configure mobile branding assets.
- [x] Keep signer invitation management internal until external administrator API authentication is supplied.
