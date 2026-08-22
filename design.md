# SignBridge System Design

**Context-Aware Nepali Sign Language Translation using Hand Sequences and Facial Cues**

This document is the system design for the research prototype described in *Research Methodology — Assignment 2 (Proposal)*, APUMP2408AI(PR)-ODL. The proposal is the governing specification; where this document makes a choice the proposal does not, the choice is marked as a **design decision** and justified.

---

## 1. Product Intent

SignBridge is the data-collection and human-in-the-loop instrument for a continuous Nepali Sign Language (NSL) translation study. It is a portrait-first Expo / React Native application delivered in two phases, with the active phase selected remotely so the study can advance without a client release.

| | Phase 1 — Collection | Phase 2 — Translation |
| --- | --- | --- |
| **Purpose** | Curate a continuous NSL corpus | Test translation quality with the community |
| **What the participant does** | Signs a prompted sentence from the 100-sentence corpus | Signs freely into the camera and receives English |
| **What the app produces** | Landmark sequences + heuristic non-manual marker tags | A translation, a directional vote, and Likert ratings |

**Research context.** Data collection is conducted in partnership with the **National Federation of the Deaf Nepal (NDFN)**, which supports recruitment, scheduling, and corpus curation. The geographic scope is the **Kathmandu Valley**. The participant group is approximately **30–40 fluent NSL users**. Each participant records a predefined set of **100 sentences** distributed across five linguistic categories.

**The commitment that shapes everything below.** The system performs **zero-retention biometric processing**. Raw video is never written to device storage and never transmitted. Only anonymized numerical coordinate sequences leave the device. Every design decision in this document is subordinate to that guarantee.

---

## 2. Research Traceability

Every requirement the proposal states, and the design element that satisfies it.

| Proposal requirement | Source | Satisfied by |
| --- | --- | --- |
| Two-phase mobile application in Expo and React Native | Implementation and Evaluation | §1, §8 Screen List; remote `workflow.getConfig` |
| Phase 1 displays sentence prompts and records signing sessions | Implementation and Evaluation | §6 Corpus and Prompts; §8 *Prompt Session*, *Capture* |
| Phase 2 provides live translation with up-or-down feedback | Implementation and Evaluation | §9.2; §8 *Live Translate*, *Feedback* |
| Feedback logged and used to prioritize samples for retraining | Implementation and Evaluation | §11 `FeedbackVote`; §12.4 Export |
| On-device landmark extraction, no raw video storage | Privacy-First Feature Extraction | §3, §4 |
| Hand 21 per hand, Face 468, Pose 33 | Privacy-First Feature Extraction | §4.2 |
| Only coordinate sequences, sentence labels, category classifications transmitted | Privacy-First Feature Extraction | §4.4 wire format |
| Four security guarantees | Privacy-First Feature Extraction | §3.2 |
| Transient encrypted video buffer, workshop-only, immediate deletion | Optional Validation Layer | §3.3 |
| Corpus of 100 sentences, five balanced categories of 20 | Scope; Appendix A | §6.1 |
| Rule-based heuristic tagging of non-manual markers | Annotation Workflow | §5 |
| Five geometric detection rules with named landmark indices | Annotation Workflow, NMM table | §5.2 |
| Participatory Linguistic Validation Workshop with NDFN | Data Collection | §5.4 |
| Newly identified markers formalized as MediaPipe displacement vectors | Data Collection | §5.4 |
| 30–40 fluent NSL users, Kathmandu Valley | Scope | §1, §12.1 |
| Multi-stream Transformer, three encoders, cross-attention fusion | Multi-Stream Transformer Architecture | §14 |
| Cross-lingual transfer from Indian Sign Language | Abstract; Research Plan Phase 3 | §14.3 |
| Signer-independent stratified split 70 / 15 / 15 | Validation Strategy | §12.3 |
| Stratification across all five categories in each split | Validation Strategy | §12.3 |
| Test set untouched until final evaluation | Validation Strategy | §12.3 |
| BLEU and ROUGE evaluation | Implementation and Evaluation | §13.1 |
| Deaf participants rate naturalness, grammaticality, usefulness on a Likert scale | Implementation and Evaluation | §13.2; §11 `QualitativeRating` |
| ELAN annotation, ISL pre-training | Research Plan Phase 3 | §12.4 Export |
| Ethics approval; community-based participatory research | Research Plan Phase 1; Data Collection | §12.2 Consent |

---

## 3. Privacy Architecture

### 3.1 Privacy-by-Design Data Flow

The five stages below are the proposal's data flow, restated as the system contract.

| Stage | Guarantee |
| --- | --- |
| **Capture** | The camera delivers frames to a processing buffer in device memory only. No disk write occurs during recording. |
| **Extraction** | The landmark extractor runs on-device, producing the hand, face, and pose streams for each frame. |
| **Immediate Deletion** | Each raw frame is released from memory as soon as its landmarks are extracted. No video file is ever written to device storage or transmitted. |
| **Transmission** | Only anonymized coordinate sequences, the sentence label, and the category classification are sent to the backend API. |
| **Storage** | Structured landmark sequences are stored for training. Zero biometric video is retained. |

De-identification is achieved through **skeletal abstraction**: landmarks are numerical coordinates that cannot reliably reconstruct identifiable facial imagery. The representation is roughly **95% smaller than video**, which also makes it bandwidth-efficient and suitable for low-connectivity fieldwork.

### 3.2 Security Guarantees

1. No facial images stored or transmitted.
2. No personally identifiable visual data retained.
3. Anonymization occurs at the source, on the device.
4. The data-minimization principle is satisfied.

### 3.3 What the System Does Not Do

Stated explicitly, because an earlier draft of this design specified the opposite:

- The app does **not** call `recordAsync` or any API that produces a video file.
- The app does **not** hold a `recordingUri`, present a video preview, or offer a "submit video" action.
- The backend does **not** accept, proxy, or store MP4 payloads on the participant path.

**The single, narrow exception — the workshop calibration buffer.** During the Participatory Linguistic Validation Workshop (§5.4) only, a transient verification buffer may retain raw video so that heuristic thresholds can be validated against what a human observer sees.

| Constraint | Rule |
| --- | --- |
| Enablement | Off by default. Requires `CALIBRATION_BUFFER_ENABLED=true` **and** a workshop-scoped participant consent grant. Unavailable in the participant capture flow under any configuration. |
| Encryption | Encrypted at rest with a key held only by the research team. |
| Retention | Deleted immediately after heuristic validation; a hard maximum retention window is enforced by a scheduled purge, not by operator discipline. |
| Provenance | Every write and every deletion is recorded in an audit log. |
| Outcome | No biometric video persists into the final dataset. |

This is the sole purpose the object-storage boundary retains for video. On the participant path, object storage holds landmark-sequence blobs only.

---

## 4. On-Device Landmark Pipeline

### 4.1 Runtime Decision

The proposal names **MediaPipe Holistic**. Holistic is the legacy MediaPipe Solutions API. The current MediaPipe Tasks API achieves the same coverage by running three landmarkers together, preserving the proposal's stream counts exactly.

**Design decision.** Landmark extraction runs through `react-native-vision-camera` frame processors calling MediaPipe Tasks via a native Expo config plugin.

| Consequence | Detail |
| --- | --- |
| Build model | Requires `expo prebuild` and a custom development client. **Expo Go will no longer run this app.** |
| Rejected alternative | MediaPipe Tasks JS in a WebView — stays in Expo Go but the native frame rate is not adequate for continuous signing. |
| Rejected alternative | Server-side extraction — simplest to build, but transmits frames and therefore violates §3. |
| Known prerequisite | Vision Camera v4 frame processors require `react-native-worklets-core`. The project currently depends on `react-native-worklets@0.5.1`, which is a different package. This must be resolved before frame processors will run. |

### 4.2 Streams

| Stream | Points | Source |
| --- | --- | --- |
| Hand | 21 per hand (42 total) | `HandLandmarker` |
| Face | 468 | `FaceLandmarker`, iris refinement disabled |
| Pose | 33 | `PoseLandmarker` |

Each landmark carries `x`, `y`, `z` plus a visibility score where the task provides one. A frame in which a stream is not detected records that stream as absent rather than as zeroes, so that downstream models can distinguish "hands out of frame" from "hands at the origin".

### 4.3 The Extractor Interface

Extraction sits behind one interface so the native module is swappable and so the rest of the system is testable without a device build.

```ts
type Landmark = { x: number; y: number; z: number; visibility?: number };

type LandmarkFrame = {
  t: number;                    // milliseconds from sequence start
  leftHand: Landmark[] | null;  // 21
  rightHand: Landmark[] | null; // 21
  face: Landmark[] | null;      // 468
  pose: Landmark[] | null;      // 33
};

interface LandmarkExtractor {
  readonly id: string;          // e.g. "mediapipe-tasks@0.10" | "fixture@1"
  start(options: { targetFps: number }): Promise<void>;
  subscribe(onFrame: (frame: LandmarkFrame) => void): () => void;
  stop(): Promise<LandmarkSequenceSummary>;
}
```

Two implementations ship: the MediaPipe Tasks extractor, and a deterministic fixture extractor that replays recorded landmark arrays. The fixture extractor is what makes the heuristics, the API contract, and the screens testable in CI and in Expo-less environments.

### 4.4 Sequence and Wire Format

Sampling targets **30 fps**, with the achieved rate recorded per sequence so that variable device performance is visible in the data rather than hidden by it.

Coordinates are stored **normalized** as MediaPipe emits them (image-relative, origin top-left). A derived, signer-normalized view — translated to a shoulder-midpoint origin and scaled by shoulder width — is computed at export time rather than at capture time, so that the raw capture remains re-processable if the normalization strategy changes.

The transmitted payload carries only what §3 permits:

```jsonc
{
  "schemaVersion": 1,
  "sessionId": "…",
  "promptId": "B-02",              // sentence label
  "category": "interrogative",     // category classification
  "extractorId": "mediapipe-tasks@0.10",
  "targetFps": 30,
  "achievedFps": 27.4,
  "frameCount": 412,
  "durationMs": 15036,
  "frames": [ /* LandmarkFrame[] */ ]
}
```

Sequences are compressed and written to object storage as blobs; the database holds the metadata and the storage key. No field in this payload carries an image, an audio sample, or a free-text identifier.

---

## 5. Non-Manual Marker Heuristics

### 5.1 Why Heuristics

Annotation is performed at the sentence level. Because each recording corresponds to a predefined text prompt, annotation reduces to marking temporal boundaries and tagging non-manual markers. The proposal replaces subjective frame-by-frame manual glossing with **mathematical heuristics derived from the 3D coordinates**, which keeps the pipeline privacy-first (no human needs to watch video) and compatible with gloss-free sequence learning.

### 5.2 Detection Rules

Reproduced from the proposal's NMM table. The landmark indices are load-bearing — a wrong index produces silently wrong linguistics.

| NMM type | Linguistic function | Geometric detection rule | MediaPipe landmarks |
| --- | --- | --- | --- |
| **Eyebrow raise** | Question marking | Normalized vertical distance between ocular centroids and superciliary landmarks exceeds threshold | Face: 33, 133 (eyes); 105, 334 (eyebrows) |
| **Headshake** | Negation | Horizontal frequency oscillation (x-axis) of the nose point relative to a stable shoulder baseline | Face: 0; Pose: 11, 12 |
| **Shoulder shrug** | Uncertainty / indifference | Compression of vertical distance (y-axis) between acromion (shoulder) and auditory (ear) landmarks | Pose: 11, 12; Face: 7, 8 |
| **Forward lean** | Emphasis / topic shift | Depth (z-axis) delta between the shoulder plane and the hip plane exceeds threshold | Pose: 11, 12, 23, 24 |
| **Body tilt** | Comparison / contrast | Angular displacement of the shoulder line relative to the horizontal plane | Pose: 11, 12 |

### 5.3 Rule Contract

Each rule is a pure function over a landmark window — no I/O, no device, no model. This is what makes them unit-testable with fixed arrays.

```ts
type NmmRule = {
  type: "eyebrow_raise" | "headshake" | "shoulder_shrug" | "forward_lean" | "body_tilt";
  ruleVersion: string;                 // e.g. "baseline-v1" | "ndfn-workshop-v1"
  evaluate(window: LandmarkFrame[]): NmmDetection[];
};

type NmmDetection = {
  type: NmmRule["type"];
  startFrame: number;
  endFrame: number;
  confidence: number;                  // 0–1, distance past threshold, normalized
};
```

Thresholds are **configuration, not constants**. Each rule reads its threshold from a versioned profile so the workshop can retune them without a code change, and so any dataset can be traced back to the exact thresholds that produced its tags.

All measurements are normalized against a per-signer baseline (shoulder width, neutral head position) computed from the opening frames of a session, so that camera distance and body size do not leak into detection.

### 5.4 Participatory Extension Path

Standard heuristics — headshakes, leans, shrugs — provide a cross-linguistic baseline. The **Linguistic Validation Workshop** with NDFN representatives during Phase 1 exists to correct that baseline against NSL as it is actually used. Its objectives:

1. Validate whether localized NSL dialects use distinct postural markers the standard heuristics miss — chest puffs for emphasis, specific elbow flairs for temporal marking, unique eyebrow configurations.
2. Establish culturally appropriate thresholds for the geometric detection rules.
3. Identify NSL-specific grammatical markers requiring additional mathematical modeling.

Newly identified markers are formalized as **MediaPipe displacement vectors** and added to the rule set under a new `ruleVersion`. This is why the rule contract carries a version and why thresholds are configuration: the workshop's output must be expressible as data and a new rule module, not as a rewrite.

This participatory approach ensures the system captures culturally valid NSL grammar rather than importing assumptions from Indian Sign Language.

---

## 6. Corpus and Prompts

### 6.1 Structure

100 sentences, five balanced categories of 20. Each participant records the full set.

| Category | Count | Linguistic function | Example |
| --- | --- | --- | --- |
| **A — Declarative** | 20 | Baseline sentence structure and lexical order | *I am going home.* |
| **B — Interrogative** | 20 | Question force and eyebrow raise | *Where is the hospital?* |
| **C — Negation** | 20 | Head shake and negative marking | *I do not understand.* |
| **D — Temporal / Sequential** | 20 | Time reference and motion context | *I went yesterday.* |
| **E — High-impact Utility** | 20 | Everyday functional communication | *I need a doctor now.* |

The corpus is **seed data with a validation rule**, not hard-coded strings: the seed must contain exactly 20 sentences per category or the seed check fails. All 100 sentences are transcribed from Appendix A of the proposal.

> **Transcription note.** Appendix A prints one Category E entry as `" need help with this form."`, missing its leading "I". The seed records it as *"I need help with this form."* and the correction is noted inline in the seed file. No other sentence is altered.

### 6.2 Prompt Delivery

A participant works through the corpus across multiple sittings. The design assumes interruption is normal.

- Prompts are assigned per participant in a **fixed, seeded order** so that partial contributions remain balanced across categories rather than concentrated in Category A.
- Progress is server-authoritative (`n of 100`), so a reinstalled app resumes where the participant left off.
- A participant may **skip** a prompt (recorded with a reason) and **redo** a prompt; the most recent accepted session for a prompt is the canonical one, and superseded sessions are retained for audit but excluded from export.
- Category is carried on the session, not inferred later, because it is one of the three fields §3 permits to be transmitted.

---

## 7. Mobile Design Principles

The interface is designed for a 9:16 portrait phone screen and one-handed use. Primary actions sit in the lower third of the screen, use a minimum 48-point touch target, and present one clear action at a time. The layout follows Apple Human Interface Guidelines conventions: large, legible titles; grouped card surfaces; an unobtrusive bottom tab bar; visible permission explanations; and confirmation states after consequential actions.

Capture guidance uses plain language and does not imply that an automated English interpretation is definitive. Because the system extracts rather than records, guidance must also make the privacy position legible to the participant at the moment it matters — the capture screen states that no video is saved, in the participant's line of sight, not buried in Settings.

---

## 8. Screen List

| Screen | Primary content | Functionality |
| --- | --- | --- |
| **Workspace** | Stage badge, research instruction, current task summary, contribution progress, session status | Loads the active phase from `workflow.getConfig`, routes to collection or translation, exposes an environment-safe refresh. |
| **Signer Sign In** | Approved email field, password field, invitation guidance | Starts a participant session after the backend verifies a first-party account. |
| **Password Setup** | Invitation token and new-password fields | Activates a one-time approved invitation and creates the initial session. |
| **Consent** | Study purpose, what is and is not collected, withdrawal rights, versioned agreement | Records an explicit, versioned consent grant. **Blocks all capture until granted.** Withdrawal is available here at any time. |
| **Prompt Session** | Sentence text, category badge, progress `n/100`, signing guidance | Presents the next assigned prompt; offers start, skip with reason, or redo. |
| **Capture** | Camera frame, framing guide, live extraction indicator, elapsed timer, privacy statement, record/stop | Requests camera permission, runs the on-device extractor, streams landmarks to a memory buffer. Writes no file. |
| **Capture Review** | Sequence summary — frames, duration, achieved fps, stream coverage, detected NMM tags — and a retained-data notice | Lets the participant submit or discard the **sequence**. There is no video to preview; the summary is what the participant is asked to judge. |
| **Live Translate** | Camera frame, live extraction indicator, English interpretation panel, processing state | Phase 2. Signs are extracted on-device, sent for translation, and the English result is shown with a clear model-output label. |
| **Feedback** | Two prominent verdict choices, three Likert scales, optional note | Records **accurate** / **needs correction**, plus naturalness, grammaticality, and usefulness ratings. |
| **Contribution Progress** | Per-category completion, total sessions, skipped prompts | Shows the participant what they have contributed and what remains. |
| **Settings** | API endpoint state, app version, extractor and rule versions, privacy summary, consent status | Non-sensitive refresh; states exactly what is transmitted; links to withdraw consent. |

---

## 9. Primary User Flows

### 9.1 Phase 1 — Collection

1. NDFN and the research team approve a participant email; the system sends a one-time invitation.
2. The participant opens the invitation, sets a password, and receives a secure mobile session.
3. The participant reviews and grants **consent**. No capture is reachable before this.
4. **Workspace** reads `workflow.getConfig` and receives `capture`.
5. **Prompt Session** presents the next assigned sentence with its category and the running progress.
6. **Capture** requests camera permission, states that no video is saved, and starts the on-device extractor. A framing guide keeps hands, face, and upper body in view. Frames are extracted and discarded continuously.
7. The participant taps **Stop**. Heuristic NMM tagging runs over the buffered sequence.
8. **Capture Review** shows the sequence summary and the detected markers. The participant submits or discards.
9. On submit, the compressed landmark sequence, sentence label, and category are transmitted; the sequence blob is stored, metadata and NMM tags are persisted against the participant, and the prompt is marked complete.
10. The flow returns to **Prompt Session** with the next sentence.

### 9.2 Phase 2 — Translation

1. **Workspace** reads `workflow.getConfig` and receives `translation`.
2. The participant opens **Live Translate** and signs into the camera.
3. Landmarks are extracted on-device and sent to the translation endpoint. Processing state is visible.
4. The English response is displayed, clearly labelled as a model output.
5. The participant rates it **Accurate** or **Needs correction**, then rates naturalness, grammaticality, and usefulness. An optional correction note is offered but never required.
6. The vote and ratings are persisted against the translation job. The app confirms and returns to the ready state.

---

## 10. Color and Type Choices

| Token | Color | Intent |
| --- | --- | --- |
| **Ink Navy** | `#102A43` | Primary text, navigation, and trustworthy structure. |
| **Signal Teal** | `#0F766E` | Primary actions, active controls, and the signature brand color. |
| **Mist Blue** | `#E6FFFB` | Calm informational surfaces and capture guidance. |
| **Warm Sand** | `#FFF7ED` | Translation result surface, separating output from user input. |
| **Success Green** | `#15803D` | Submitted states and positive feedback. |
| **Caution Amber** | `#B45309` | Permission, privacy, and needs-attention states. |
| **Error Red** | `#B91C1C` | Capture/API failures and destructive actions. |

The native system font is retained for familiar iOS reading rhythm, with a 30-point large title, 20-point section headings, 17-point body text, and 15-point supporting labels. Text contrast is maintained against white and lightly tinted card backgrounds, while color is never the only indicator of evaluation status.

---

## 11. Domain Vocabulary and API Contract

| Entity | Required fields | Purpose |
| --- | --- | --- |
| **WorkflowConfig** | `stage`, `version`, `updatedAt` | Selects `capture` or `translation` without a mobile release. |
| **Participant** | `id`, `email`, `displayName`, `status` | An approved NSL signer recruited through NDFN. |
| **ConsentRecord** | `participantId`, `consentVersion`, `scopes`, `grantedAt`, `withdrawnAt` | Versioned, explicit research consent. `scopes` distinguishes standard participation from workshop calibration. |
| **SentencePrompt** | `id`, `category`, `orderIndex`, `textEnglish`, `expectedNmms` | One corpus sentence. `expectedNmms` states which markers the sentence is designed to elicit. |
| **CaptureSession** | `id`, `participantId`, `promptId`, `category`, `status`, `startedAt`, `completedAt`, `skipReason` | One attempt at one prompt. `status` ∈ `recording｜pending_upload｜stored｜superseded｜skipped｜failed`. |
| **LandmarkSequence** | `id`, `sessionId`, `schemaVersion`, `extractorId`, `frameCount`, `targetFps`, `achievedFps`, `durationMs`, `storageKey`, `sizeBytes` | Metadata for one stored coordinate sequence. The coordinates live in object storage. |
| **NmmTag** | `id`, `sessionId`, `type`, `startFrame`, `endFrame`, `confidence`, `ruleVersion` | One heuristic detection. `ruleVersion` makes every tag reproducible. |
| **TranslationJob** | `id`, `sessionId`, `status`, `englishResponse`, `modelVersion`, `latencyMs`, `createdAt` | One English interpretation. `status` ∈ `pending｜processing｜complete｜failed`. |
| **FeedbackVote** | `id`, `translationJobId`, `participantId`, `vote`, `note`, `createdAt` | Directional accuracy signal. `vote` ∈ `accurate｜needs_correction`. |
| **QualitativeRating** | `translationJobId`, `participantId`, `naturalness`, `grammaticality`, `usefulness`, `createdAt` | Three 1–5 Likert scores from a Deaf participant. |
| **SplitAssignment** | `participantId`, `split`, `seed`, `assignedAt` | Signer-independent partition. `split` ∈ `train｜validation｜test`. |

**Contract notes.**

- `TranslationJob.modelVersion` and `LandmarkSequence.extractorId` are mandatory. Without them a result cannot be attributed to the pipeline that produced it, and the study's own metrics become unreproducible.
- `FeedbackVote` and `QualitativeRating` are separate entities because a participant may give a directional vote without completing all three scales, and forcing the scales would suppress feedback volume.
- Nothing in this model stores an image, a video, or an audio sample.

---

## 12. Data Governance

### 12.1 Participants

30–40 fluent NSL users recruited through NDFN in the Kathmandu Valley, with preference for regular users of the language able to provide reliable signing samples. Accounts are first-party and invitation-only; there is no open registration.

### 12.2 Consent

Consent is a **record**, not a checkbox in copy. It is versioned, scoped, timestamped, and revocable, and capture is unreachable without a current grant. Withdrawal is reachable from Settings and from the Consent screen, and marks the participant's contributions for exclusion from export while preserving the audit trail. Ethics approval is obtained during Phase 1 alongside NDFN coordination; the consent version in force is recorded on every grant so that a protocol amendment does not retroactively reinterpret earlier agreement.

### 12.3 Signer-Independent Partitioning

Given the corpus size (100 sentences × ~35 signers), the split is **by signer, not by sample**:

| Split | Share | Approx. signers |
| --- | --- | --- |
| Training | 70% | ~24 |
| Validation | 15% | 5–6 |
| Test | 15% | 5–6 |

Every signer's sessions fall entirely within one split, so the model is always evaluated on entirely unseen individuals and signer-specific idiosyncrasies cannot inflate the metrics. Stratification ensures proportional representation of all five categories in each split. Assignment is **seeded and recorded** so that the partition is reproducible.

During Phase 4 fine-tuning, **5-fold cross-validation** runs on the training set to tune hyperparameters without consuming held-out validation data. **The test split is not read until final evaluation**, which is also what prevents the human-in-the-loop feedback loop from leaking into it — feedback collected in Phase 2 must be filtered by split before it can influence retraining.

### 12.4 Export

Phase 3 requires the corpus to leave the system for ELAN annotation and ISL pre-training. Export is a first-class boundary, not a database dump.

- **Training export** — per-split JSONL: landmark sequence reference, prompt text, category, NMM tags, extractor and rule versions.
- **ELAN export** — sentence-level tiers with temporal boundaries and NMM annotations, so the linguistic team can inspect and correct heuristic output in their own tooling.
- **Feedback export** — votes and Likert ratings joined to translation jobs and split assignment, used to prioritize retraining samples.
- Exports carry a manifest recording the seed, the rule version, the extractor version, and the consent state at export time. Withdrawn participants are excluded at the query, not filtered downstream.

### 12.5 Retention

Landmark sequences are retained for the study's duration as the research dataset. Raw video has no retention policy because it is never stored, except under §3.3, where retention is minimal, encrypted, and enforced by scheduled purge.

---

## 13. Evaluation and Metrics

### 13.1 Quantitative

Translation output is measured with **BLEU** and **ROUGE**, computed offline against the reference sentence text. These are model-side metrics; the application's obligation is to produce data in the shape they consume — a translation output paired with the prompt text that generated the signing, attributed to a model version, and partitioned by signer.

### 13.2 Qualitative

Deaf participants review selected translations and rate **naturalness**, **grammaticality**, and **overall usefulness** on a Likert scale. This is not optional garnish: automatic metrics cannot fully capture meaning carried by facial cues, timing, and discourse structure, which is precisely what this study is testing. The `QualitativeRating` entity exists so these ratings are first-class research data rather than free text.

### 13.3 What the App Is Not Responsible For

BLEU/ROUGE computation, model training, and cross-validation run outside the application. The boundary is the export in §12.4.

---

## 14. Model Boundary

### 14.1 Target Architecture

A multi-stream Transformer with three parallel encoders — one for hand motion, one for facial landmarks, one for pose. Each encoder learns modality-specific patterns before the outputs are combined through a **cross-attention fusion layer**, allowing the facial stream to influence interpretation of the hand stream and the pose stream to contribute contextual information about movement and posture. The fused representation passes to a Transformer decoder that generates the English text.

### 14.2 Pluggable Interface

The application never depends on the model directly. Translation sits behind one interface:

```ts
interface SignTranslator {
  readonly modelVersion: string;
  translate(input: { sequenceRef: string; frameCount: number }): Promise<{
    englishResponse: string;
    confidence: number;
  }>;
}
```

A **deterministic fixture translator** ships first and remains the CI implementation. It lets the full mobile and API contract — capture, transmission, translation job lifecycle, feedback, ratings, export — be exercised end to end while the multi-stream model is still being built. This is the proposal's own staging: the contracts are proven before the model exists.

### 14.3 Cross-Lingual Transfer

Phase 3 pre-trains on Indian Sign Language data before fine-tuning on NSL, addressing the cold-start problem that a 100-sentence corpus cannot solve alone. This is a training-pipeline concern, invisible to the application beyond `modelVersion`.

---

## 15. Deployment

Carried forward from the existing deployment work, retargeted from video to landmark sequences.

| Concern | Local development | Production |
| --- | --- | --- |
| Backend | Docker Compose service | Hetzner server, Docker Compose overlay, loopback-bound behind a TLS reverse proxy |
| Participant data | MariaDB container | MariaDB container with a persistent volume and a documented backup schedule |
| Landmark sequence blobs | MinIO | Private Hetzner Object Storage bucket, server-side credentials only |
| Workshop calibration buffer (§3.3) | MinIO, flag-gated | Private bucket, flag-gated, encrypted, scheduled purge |
| Invitation email | Mailpit | Gmail SMTP |

The storage adapter remains the single implementation point for both targets. Buckets are private; credentials are server-side only and never reach the client. The client receives no storage credentials and no bucket URLs — sequence uploads pass through the authenticated API.

Because §4.1 requires a custom development client, the mobile build path is `expo prebuild` → EAS or local native build. Expo Go is no longer a supported way to run this application.

---

## Appendix: Relationship to the Proposal

This document implements *Research Methodology — Assignment 2 (Proposal)*. Where it goes beyond the proposal, it does so in three places, each recorded above as a design decision:

1. **MediaPipe Tasks instead of Holistic** (§4.1) — Holistic is the legacy API; Tasks preserves the proposal's exact stream counts.
2. **Consent as a versioned record** (§12.2) — the proposal requires ethics approval and community-based participatory research; this makes that operational.
3. **Export as a first-class boundary** (§12.4) — the proposal requires ELAN annotation and ISL pre-training; this defines how data reaches them.

Nothing in the proposal is left unimplemented. The single transcription correction is recorded in §6.1.
