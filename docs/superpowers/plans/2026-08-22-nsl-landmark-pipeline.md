# NSL Privacy-First Landmark Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SignBridge's video-recording capture flow with the proposal's privacy-first pipeline — on-device landmark extraction, prompt-driven corpus collection, heuristic non-manual marker tagging, live translation, and research-grade feedback and governance.

**Architecture:** Camera frames are extracted to hand/face/pose landmarks on-device and discarded; only coordinate sequences, a sentence label, and a category reach the API. Extraction sits behind a `LandmarkExtractor` interface with a deterministic fixture implementation, so every layer above it is testable without a native build. Non-manual marker detection is a set of pure geometry functions over landmark windows. Translation sits behind a `SignTranslator` interface with a fixture implementation, so the full contract runs end to end before the multi-stream Transformer exists.

**Tech Stack:** Expo SDK 54 / React Native 0.81.5 / React 19.1.0, expo-router 6, tRPC 11.7.2 + superjson, Drizzle ORM 0.44.7 on MariaDB 11, Vitest 2.1.9, MinIO 8, react-native-vision-camera 4 + MediaPipe Tasks.

**Spec:** `design.md` (system design) — implements *Research Methodology — Assignment 2 (Proposal)*, `Research Methodology - Assignment 2 Proposal.pdf`

## Global Constraints

- **Zero raw-video retention.** No code on the participant path may call `recordAsync`, write a video file, hold a `recordingUri`, or transmit frames. The only exception is the flag-gated workshop calibration buffer (`design.md` §3.3).
- **Transmitted fields are limited** to anonymized coordinate sequences, the sentence label, and the category classification (`design.md` §3.1).
- **Stream sizes are fixed:** hand 21 landmarks per hand, face 468 (iris refinement disabled), pose 33.
- **NMM landmark indices are exact** and must match `design.md` §5.2 character for character: eyebrow raise face `33, 133, 105, 334`; headshake face `0` + pose `11, 12`; shoulder shrug pose `11, 12` + face `7, 8`; forward lean pose `11, 12, 23, 24`; body tilt pose `11, 12`.
- **Corpus is 100 sentences, 5 categories × 20.** Seed validation must fail while Category E is short.
- **Colors are exact:** Ink Navy `#102A43`, Signal Teal `#0F766E`, Mist Blue `#E6FFFB`, Warm Sand `#FFF7ED`, Success Green `#15803D`, Caution Amber `#B45309`, Error Red `#B91C1C`.
- **Touch targets** are a minimum of 48 points; primary actions sit in the lower third.
- **Copy rule:** never imply an automated English interpretation is definitive.
- **Tests run without a database.** `getDb()` returns `null` when `DATABASE_URL` is unset. Service functions that require a database must throw a clean error; router tests assert authorization and validation paths that fail before the database is reached, and pure logic is tested directly.
- **tRPC v11:** `transformer: superjson` goes inside `httpBatchLink`, never at the client root.
- **Package manager is pnpm** (`pnpm@9.12.0`).

### Prerequisites — do these before Task 1

**Node is not installed on this host** (no Homebrew, no nvm, no Volta). Rancher Desktop provides Docker, so the toolchain runs in a container. Build the image once:

```bash
docker build -t signbridge-dev:latest <toolchain-dir>   # node:22-alpine + pnpm@9.12.0 + git
```

Then every `pnpm …` command in this plan runs through the shim:

```bash
docker run --rm -v "$PWD":/app -v signbridge-pnpm-store:/pnpm-store -w /app \
  signbridge-dev:latest sh -lc 'pnpm install'
```

Waves 1–3 (Tasks 1–10) and Tasks 11a/11c run entirely in the container. **Task 11b needs a real macOS toolchain** — Xcode, Android SDK, and a native Node — because `expo prebuild` and the device build cannot run in this container.

```bash
git init && git add -A && git commit -m "chore: baseline before NSL landmark pipeline"
```

`pnpm drizzle-kit generate` reads `drizzle.config.ts`, which throws unless `DATABASE_URL` is set. It does not connect — the variable only needs to be present:

```bash
export DATABASE_URL='mysql://signbridge:signbridge-local-password@localhost:3306/signbridge'
```

---

## File Structure

| File | Responsibility |
| --- | --- |
| `shared/landmarks.ts` | `Landmark`, `LandmarkFrame`, stream sizes, `LandmarkExtractor` interface |
| `shared/corpus.ts` | Category vocabulary and corpus invariants |
| `shared/workflow.ts` | Stage, status, and vote vocabularies — single source of truth for the DB enums |
| `lib/extractors/fixture-extractor.ts` | Deterministic replay extractor for CI and Expo-less environments |
| `lib/extractors/mediapipe-extractor.ts` | Vision Camera frame processor → MediaPipe Tasks |
| `server/nmm/baseline.ts` | Per-signer baseline normalization |
| `server/nmm/rules.ts` | The five pure geometric detection rules |
| `server/nmm/thresholds.ts` | Versioned threshold profiles |
| `server/corpus-seed.ts` | The 100-sentence corpus and its validation |
| `server/sequence-storage.ts` | Landmark-blob object-storage boundary (replaces `recording-storage.ts`) |
| `server/session-service.ts` | Capture sessions, prompt assignment, progress |
| `server/translation-service.ts` | `SignTranslator` interface, fixture translator, job lifecycle |
| `server/feedback-service.ts` | Vote and Likert persistence |
| `server/consent-service.ts` | Versioned consent grants and withdrawal |
| `server/split-service.ts` | Seeded signer-independent stratified assignment |
| `server/export-service.ts` | Training JSONL, ELAN, and feedback exports |
| `app/consent.tsx`, `app/prompt-session.tsx`, `app/live-translate.tsx`, `app/(tabs)/progress.tsx` | New screens |

---

## Task 1: Shared vocabularies and landmark types

**Files:**
- Create: `shared/landmarks.ts`
- Create: `shared/corpus.ts`
- Modify: `shared/workflow.ts` (full rewrite)
- Test: `tests/shared-vocabulary.test.ts`

**Interfaces:**
- Produces: `HAND_LANDMARK_COUNT = 21`, `FACE_LANDMARK_COUNT = 468`, `POSE_LANDMARK_COUNT = 33`, `Landmark`, `LandmarkFrame`, `LandmarkSequencePayload`, `LandmarkExtractor`, `LandmarkSequenceSummary`; `CORPUS_CATEGORIES`, `SENTENCES_PER_CATEGORY = 20`, `CORPUS_SIZE = 100`, `CorpusCategory`; `workflowStages`, `sessionStatuses`, `translationStatuses`, `feedbackVoteValues`, `WorkflowStage`, `SessionStatus`, `TranslationStatus`, `FeedbackVote`, `stageDetails`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared-vocabulary.test.ts
import { describe, expect, it } from "vitest";

import {
  CORPUS_CATEGORIES,
  CORPUS_SIZE,
  SENTENCES_PER_CATEGORY,
} from "../shared/corpus";
import {
  FACE_LANDMARK_COUNT,
  HAND_LANDMARK_COUNT,
  POSE_LANDMARK_COUNT,
} from "../shared/landmarks";
import {
  feedbackVoteValues,
  sessionStatuses,
  stageDetails,
  translationStatuses,
  workflowStages,
} from "../shared/workflow";

describe("landmark stream sizes", () => {
  it("matches the proposal's stream counts exactly", () => {
    expect(HAND_LANDMARK_COUNT).toBe(21);
    expect(FACE_LANDMARK_COUNT).toBe(468);
    expect(POSE_LANDMARK_COUNT).toBe(33);
  });
});

describe("corpus vocabulary", () => {
  it("defines five categories of twenty sentences", () => {
    expect(CORPUS_CATEGORIES).toEqual([
      "declarative",
      "interrogative",
      "negation",
      "temporal",
      "utility",
    ]);
    expect(SENTENCES_PER_CATEGORY).toBe(20);
    expect(CORPUS_SIZE).toBe(CORPUS_CATEGORIES.length * SENTENCES_PER_CATEGORY);
    expect(CORPUS_SIZE).toBe(100);
  });
});

describe("workflow vocabulary", () => {
  it("names the two research phases", () => {
    expect(workflowStages).toEqual(["capture", "translation"]);
  });

  it("describes every stage for the workspace screen", () => {
    for (const stage of workflowStages) {
      expect(stageDetails[stage].action.length).toBeGreaterThan(0);
    }
  });

  it("defines session, translation, and vote vocabularies", () => {
    expect(sessionStatuses).toEqual([
      "recording",
      "pending_upload",
      "stored",
      "superseded",
      "skipped",
      "failed",
    ]);
    expect(translationStatuses).toEqual(["pending", "processing", "complete", "failed"]);
    expect(feedbackVoteValues).toEqual(["accurate", "needs_correction"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/shared-vocabulary.test.ts`
Expected: FAIL — `Failed to resolve import "../shared/corpus"`

- [ ] **Step 3: Write `shared/landmarks.ts`**

```ts
export const HAND_LANDMARK_COUNT = 21;
export const FACE_LANDMARK_COUNT = 468;
export const POSE_LANDMARK_COUNT = 33;

export type Landmark = { x: number; y: number; z: number; visibility?: number };

/**
 * One extracted frame. A stream that was not detected is `null` rather than an
 * array of zeroes, so that "out of frame" stays distinguishable from "at the origin".
 */
export type LandmarkFrame = {
  /** Milliseconds from the start of the sequence. */
  t: number;
  leftHand: Landmark[] | null;
  rightHand: Landmark[] | null;
  face: Landmark[] | null;
  pose: Landmark[] | null;
};

export type LandmarkSequenceSummary = {
  frameCount: number;
  durationMs: number;
  achievedFps: number;
  /** Fraction of frames in which each stream was detected, 0–1. */
  coverage: { leftHand: number; rightHand: number; face: number; pose: number };
};

export type LandmarkSequencePayload = {
  schemaVersion: 1;
  sessionId: string;
  promptId: string;
  category: string;
  extractorId: string;
  targetFps: number;
  achievedFps: number;
  frameCount: number;
  durationMs: number;
  frames: LandmarkFrame[];
};

export interface LandmarkExtractor {
  readonly id: string;
  start(options: { targetFps: number }): Promise<void>;
  subscribe(onFrame: (frame: LandmarkFrame) => void): () => void;
  stop(): Promise<LandmarkSequenceSummary>;
}
```

- [ ] **Step 4: Write `shared/corpus.ts`**

```ts
export const CORPUS_CATEGORIES = [
  "declarative",
  "interrogative",
  "negation",
  "temporal",
  "utility",
] as const;

export type CorpusCategory = (typeof CORPUS_CATEGORIES)[number];

export const SENTENCES_PER_CATEGORY = 20;
export const CORPUS_SIZE = CORPUS_CATEGORIES.length * SENTENCES_PER_CATEGORY;

/** Appendix A category letters, used for prompt ids such as `B-02`. */
export const CATEGORY_LETTERS: Record<CorpusCategory, string> = {
  declarative: "A",
  interrogative: "B",
  negation: "C",
  temporal: "D",
  utility: "E",
};

export const CATEGORY_PURPOSE: Record<CorpusCategory, string> = {
  declarative: "Baseline sentence structure and lexical order",
  interrogative: "Question force and eyebrow raise",
  negation: "Head shake and negative marking",
  temporal: "Time reference and motion context",
  utility: "Everyday functional communication",
};
```

- [ ] **Step 5: Rewrite `shared/workflow.ts`**

```ts
export const workflowStages = ["capture", "translation"] as const;
export type WorkflowStage = (typeof workflowStages)[number];

export const sessionStatuses = [
  "recording",
  "pending_upload",
  "stored",
  "superseded",
  "skipped",
  "failed",
] as const;
export type SessionStatus = (typeof sessionStatuses)[number];

export const translationStatuses = ["pending", "processing", "complete", "failed"] as const;
export type TranslationStatus = (typeof translationStatuses)[number];

export const feedbackVoteValues = ["accurate", "needs_correction"] as const;
export type FeedbackVote = (typeof feedbackVoteValues)[number];

export const nmmTypes = [
  "eyebrow_raise",
  "headshake",
  "shoulder_shrug",
  "forward_lean",
  "body_tilt",
] as const;
export type NmmType = (typeof nmmTypes)[number];

export type WorkflowConfig = {
  stage: WorkflowStage;
  version: string;
  updatedAt: string;
};

export const stageDetails: Record<
  WorkflowStage,
  { badge: string; title: string; description: string; action: string }
> = {
  capture: {
    badge: "Collection phase",
    title: "Sign a prompted sentence",
    description:
      "You will see a sentence to sign. Your camera stays on this device — only anonymous motion points are sent, never video.",
    action: "Continue collecting",
  },
  translation: {
    badge: "Translation phase",
    title: "Sign and review the English",
    description:
      "Sign into the camera and review the English the model produces, then tell us how accurate it was.",
    action: "Start translating",
  },
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run tests/shared-vocabulary.test.ts`
Expected: PASS (3 suites)

- [ ] **Step 7: Fix the now-broken existing references**

`app/(tabs)/index.tsx` reads `stageDetails[activeStage]` and routes on `activeStage === "capture"`. **Leave its route targets alone** — `/live-translate` does not exist until Task 11a, and repointing at a missing route now would break navigation. The rename is type-safe as it stands because the branch is a cast. `server/workflow-config.ts` must resolve the renamed stage:

```ts
// server/workflow-config.ts
import { type WorkflowStage } from "../shared/workflow";

export const defaultWorkflowStage: WorkflowStage = "capture";

export function resolveWorkflowStage(value: string | undefined): WorkflowStage {
  return value === "translation" ? "translation" : defaultWorkflowStage;
}

export function getWorkflowConfig() {
  return {
    stage: resolveWorkflowStage(process.env.WORKFLOW_STAGE),
    version: process.env.WORKFLOW_CONFIG_VERSION ?? "local-v1",
    updatedAt: new Date().toISOString(),
  };
}
```

Update `tests/workflow-config.test.ts` lines 21–23 to assert `resolveWorkflowStage("translation")` returns `"translation"`, and delete its `feedback.submit` case (lines 25–41) — feedback persistence is rewritten in Task 9 and gets its own test there.

- [ ] **Step 8: Run the full suite and the type check**

Run: `pnpm vitest run && pnpm check`
Expected: PASS, no TypeScript errors

- [ ] **Step 9: Commit**

```bash
git add shared/ tests/shared-vocabulary.test.ts tests/workflow-config.test.ts server/workflow-config.ts "app/(tabs)/index.tsx"
git commit -m "feat: shared landmark, corpus, and workflow vocabularies"
```

---

## Task 2: Fixture landmark extractor

**Files:**
- Create: `vitest.config.ts`
- Create: `lib/extractors/fixture-extractor.ts`
- Create: `tests/fixtures/landmark-frames.ts`
- Test: `tests/fixture-extractor.test.ts`

**Prerequisite — vitest cannot resolve the `@/` alias.** Files under `lib/` and `app/` import via `@/…`, which Metro resolves from `tsconfig.json` `paths`. Vitest honours neither, and the project has no vitest config, so `lib/extractors/fixture-extractor.ts` would fail to resolve `@/shared/landmarks`. Add the config before anything under `lib/` is imported by a test:

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared/", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

**Interfaces:**
- Consumes: `LandmarkExtractor`, `LandmarkFrame`, `LandmarkSequenceSummary`, `HAND_LANDMARK_COUNT`, `FACE_LANDMARK_COUNT`, `POSE_LANDMARK_COUNT` from `shared/landmarks`.
- Produces: `createFixtureExtractor(frames: LandmarkFrame[]): LandmarkExtractor`; `makeLandmarks(count: number, seed: number): Landmark[]`, `makeFrame(overrides): LandmarkFrame`, `makeSequence(options): LandmarkFrame[]` from `tests/fixtures/landmark-frames`.

- [ ] **Step 1: Add `vitest.config.ts`** (see the prerequisite block above), then confirm the existing suite still runs:

Run: `pnpm vitest run`
Expected: the Task 1 suites still pass; no "cannot resolve" errors.

- [ ] **Step 2: Write the fixture builders**

```ts
// tests/fixtures/landmark-frames.ts
import {
  FACE_LANDMARK_COUNT,
  HAND_LANDMARK_COUNT,
  POSE_LANDMARK_COUNT,
  type Landmark,
  type LandmarkFrame,
} from "../../shared/landmarks";

/** Deterministic, non-random landmark filler. */
export function makeLandmarks(count: number, seed = 0): Landmark[] {
  return Array.from({ length: count }, (_, i) => ({
    x: ((i * 7 + seed) % 100) / 100,
    y: ((i * 13 + seed) % 100) / 100,
    z: ((i * 3 + seed) % 50) / 100,
    visibility: 1,
  }));
}

export function makeFrame(overrides: Partial<LandmarkFrame> = {}): LandmarkFrame {
  return {
    t: 0,
    leftHand: makeLandmarks(HAND_LANDMARK_COUNT, 1),
    rightHand: makeLandmarks(HAND_LANDMARK_COUNT, 2),
    face: makeLandmarks(FACE_LANDMARK_COUNT, 3),
    pose: makeLandmarks(POSE_LANDMARK_COUNT, 4),
    ...overrides,
  };
}

export function makeSequence(options: {
  frameCount: number;
  fps?: number;
  mutate?: (frame: LandmarkFrame, index: number) => LandmarkFrame;
}): LandmarkFrame[] {
  const fps = options.fps ?? 30;
  const step = 1000 / fps;
  return Array.from({ length: options.frameCount }, (_, i) => {
    const base = makeFrame({ t: Math.round(i * step) });
    return options.mutate ? options.mutate(base, i) : base;
  });
}
```

- [ ] **Step 3: Write the failing test**

```ts
// tests/fixture-extractor.test.ts
import { describe, expect, it } from "vitest";

import { createFixtureExtractor } from "../lib/extractors/fixture-extractor";
import { makeSequence } from "./fixtures/landmark-frames";

describe("fixture landmark extractor", () => {
  it("replays every frame to a subscriber", async () => {
    const frames = makeSequence({ frameCount: 5 });
    const extractor = createFixtureExtractor(frames);
    const seen: number[] = [];

    await extractor.start({ targetFps: 30 });
    extractor.subscribe((frame) => seen.push(frame.t));
    await extractor.stop();

    expect(seen).toEqual(frames.map((f) => f.t));
  });

  it("summarizes duration and achieved frame rate", async () => {
    const extractor = createFixtureExtractor(makeSequence({ frameCount: 30, fps: 30 }));
    await extractor.start({ targetFps: 30 });
    extractor.subscribe(() => {});
    const summary = await extractor.stop();

    expect(summary.frameCount).toBe(30);
    expect(summary.durationMs).toBe(967);
    expect(summary.achievedFps).toBeCloseTo(31.0, 0);
  });

  it("reports per-stream coverage so missing streams stay visible", async () => {
    const frames = makeSequence({
      frameCount: 4,
      mutate: (frame, i) => (i < 2 ? { ...frame, leftHand: null } : frame),
    });
    const extractor = createFixtureExtractor(frames);
    await extractor.start({ targetFps: 30 });
    extractor.subscribe(() => {});
    const summary = await extractor.stop();

    expect(summary.coverage.leftHand).toBe(0.5);
    expect(summary.coverage.face).toBe(1);
  });

  it("stops delivering frames after unsubscribe", async () => {
    const extractor = createFixtureExtractor(makeSequence({ frameCount: 3 }));
    let count = 0;
    await extractor.start({ targetFps: 30 });
    const unsubscribe = extractor.subscribe(() => {
      count += 1;
      if (count === 1) unsubscribe();
    });
    await extractor.stop();

    expect(count).toBe(1);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm vitest run tests/fixture-extractor.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/extractors/fixture-extractor"`

- [ ] **Step 5: Write the implementation**

```ts
// lib/extractors/fixture-extractor.ts
import type {
  LandmarkExtractor,
  LandmarkFrame,
  LandmarkSequenceSummary,
} from "@/shared/landmarks";

/**
 * Replays a fixed frame list. This is the CI implementation of `LandmarkExtractor`
 * and the reason the capture, tagging, and API layers are testable without a
 * native build or a camera.
 */
export function createFixtureExtractor(frames: LandmarkFrame[]): LandmarkExtractor {
  let listener: ((frame: LandmarkFrame) => void) | null = null;
  let started = false;

  return {
    id: "fixture@1",

    async start() {
      started = true;
    },

    subscribe(onFrame) {
      listener = onFrame;
      return () => {
        listener = null;
      };
    },

    async stop(): Promise<LandmarkSequenceSummary> {
      if (!started) throw new Error("The extractor was stopped before it was started.");
      for (const frame of frames) listener?.(frame);
      started = false;
      listener = null;
      return summarize(frames);
    },
  };
}

function summarize(frames: LandmarkFrame[]): LandmarkSequenceSummary {
  const frameCount = frames.length;
  const durationMs = frameCount === 0 ? 0 : frames[frameCount - 1].t - frames[0].t;
  const achievedFps = durationMs === 0 ? 0 : (frameCount / durationMs) * 1000;
  const ratio = (predicate: (frame: LandmarkFrame) => boolean) =>
    frameCount === 0 ? 0 : frames.filter(predicate).length / frameCount;

  return {
    frameCount,
    durationMs,
    achievedFps,
    coverage: {
      leftHand: ratio((f) => f.leftHand !== null),
      rightHand: ratio((f) => f.rightHand !== null),
      face: ratio((f) => f.face !== null),
      pose: ratio((f) => f.pose !== null),
    },
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run tests/fixture-extractor.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts lib/extractors/fixture-extractor.ts tests/fixture-extractor.test.ts tests/fixtures/landmark-frames.ts
git commit -m "feat: deterministic fixture landmark extractor"
```

---

## Task 3: Non-manual marker baseline and detection rules

**Files:**
- Create: `server/nmm/baseline.ts`
- Create: `server/nmm/thresholds.ts`
- Create: `server/nmm/rules.ts`
- Test: `tests/nmm-rules.test.ts`

**Interfaces:**
- Consumes: `LandmarkFrame`, `Landmark` from `shared/landmarks`; `NmmType` from `shared/workflow`; `makeSequence`, `makeLandmarks` from `tests/fixtures/landmark-frames`.
- Produces: `computeSignerBaseline(frames: LandmarkFrame[]): SignerBaseline | null`; `thresholdProfiles`, `BASELINE_RULE_VERSION = "baseline-v1"`; `nmmRules: NmmRule[]`, `detectNmms(frames, options): NmmDetection[]`, types `SignerBaseline`, `NmmRule`, `NmmDetection`.

**Landmark indices — copy exactly:**

| Rule | Face indices | Pose indices |
| --- | --- | --- |
| `eyebrow_raise` | 33, 133 (eyes), 105, 334 (eyebrows) | — |
| `headshake` | 0 (nose) | 11, 12 (shoulders) |
| `shoulder_shrug` | 7, 8 (ears) | 11, 12 (shoulders) |
| `forward_lean` | — | 11, 12 (shoulders), 23, 24 (hips) |
| `body_tilt` | — | 11, 12 (shoulders) |

- [ ] **Step 1: Write the failing test**

```ts
// tests/nmm-rules.test.ts
import { describe, expect, it } from "vitest";

import { computeSignerBaseline } from "../server/nmm/baseline";
import { detectNmms, nmmRules } from "../server/nmm/rules";
import { BASELINE_RULE_VERSION } from "../server/nmm/thresholds";
import { makeSequence } from "./fixtures/landmark-frames";
import type { LandmarkFrame } from "../shared/landmarks";

/** Places the landmarks each rule reads at explicit, physical coordinates. */
function poseFrame(
  t: number,
  o: {
    shoulderL?: [number, number, number];
    shoulderR?: [number, number, number];
    hipL?: [number, number, number];
    hipR?: [number, number, number];
    nose?: [number, number, number];
    earL?: [number, number, number];
    earR?: [number, number, number];
    browL?: [number, number, number];
    browR?: [number, number, number];
    eyeL?: [number, number, number];
    eyeR?: [number, number, number];
  } = {},
): LandmarkFrame {
  const [frame] = makeSequence({ frameCount: 1 });
  const pose = [...frame.pose!];
  const face = [...frame.face!];
  const set = (arr: typeof pose, i: number, v?: [number, number, number]) => {
    if (v) arr[i] = { x: v[0], y: v[1], z: v[2], visibility: 1 };
  };

  set(pose, 11, o.shoulderL ?? [0.4, 0.5, 0]);
  set(pose, 12, o.shoulderR ?? [0.6, 0.5, 0]);
  set(pose, 23, o.hipL ?? [0.42, 0.8, 0]);
  set(pose, 24, o.hipR ?? [0.58, 0.8, 0]);
  set(face, 0, o.nose ?? [0.5, 0.35, 0]);
  set(face, 7, o.earL ?? [0.42, 0.32, 0]);
  set(face, 8, o.earR ?? [0.58, 0.32, 0]);
  set(face, 33, o.eyeL ?? [0.45, 0.33, 0]);
  set(face, 133, o.eyeR ?? [0.55, 0.33, 0]);
  set(face, 105, o.browL ?? [0.45, 0.30, 0]);
  set(face, 334, o.browR ?? [0.55, 0.30, 0]);

  return { ...frame, t, pose, face };
}

const neutral = (count: number) =>
  Array.from({ length: count }, (_, i) => poseFrame(i * 33));

describe("signer baseline", () => {
  it("derives shoulder width and neutral head position from opening frames", () => {
    const baseline = computeSignerBaseline(neutral(30));
    expect(baseline).not.toBeNull();
    expect(baseline!.shoulderWidth).toBeCloseTo(0.2, 3);
    expect(baseline!.neutralBrowGap).toBeGreaterThan(0);
  });

  it("returns null when pose is never detected", () => {
    const frames = makeSequence({ frameCount: 10, mutate: (f) => ({ ...f, pose: null }) });
    expect(computeSignerBaseline(frames)).toBeNull();
  });
});

describe("the five detection rules", () => {
  it("registers exactly the five proposal rules", () => {
    expect(nmmRules.map((r) => r.type)).toEqual([
      "eyebrow_raise",
      "headshake",
      "shoulder_shrug",
      "forward_lean",
      "body_tilt",
    ]);
    expect(nmmRules.every((r) => r.ruleVersion === BASELINE_RULE_VERSION)).toBe(true);
  });

  it("finds nothing in a neutral sequence", () => {
    const detections = detectNmms(neutral(60), { baseline: computeSignerBaseline(neutral(30))! });
    expect(detections).toEqual([]);
  });

  it("detects an eyebrow raise when brows lift away from the eyes", () => {
    const base = computeSignerBaseline(neutral(30))!;
    const frames = [
      ...neutral(15),
      ...Array.from({ length: 20 }, (_, i) =>
        poseFrame(500 + i * 33, { browL: [0.45, 0.24, 0], browR: [0.55, 0.24, 0] }),
      ),
    ];
    const hit = detectNmms(frames, { baseline: base }).find((d) => d.type === "eyebrow_raise");
    expect(hit).toBeDefined();
    expect(hit!.startFrame).toBeGreaterThanOrEqual(15);
    expect(hit!.confidence).toBeGreaterThan(0);
    expect(hit!.confidence).toBeLessThanOrEqual(1);
  });

  it("detects a headshake from horizontal nose oscillation", () => {
    const base = computeSignerBaseline(neutral(30))!;
    const frames = [
      ...neutral(10),
      ...Array.from({ length: 36 }, (_, i) =>
        poseFrame(330 + i * 33, { nose: [0.5 + (i % 6 < 3 ? 0.05 : -0.05), 0.35, 0] }),
      ),
    ];
    const hit = detectNmms(frames, { baseline: base }).find((d) => d.type === "headshake");
    expect(hit).toBeDefined();
  });

  it("detects a shoulder shrug when the shoulder-to-ear gap compresses", () => {
    const base = computeSignerBaseline(neutral(30))!;
    const frames = [
      ...neutral(10),
      ...Array.from({ length: 20 }, (_, i) =>
        poseFrame(330 + i * 33, { shoulderL: [0.4, 0.4, 0], shoulderR: [0.6, 0.4, 0] }),
      ),
    ];
    const hit = detectNmms(frames, { baseline: base }).find((d) => d.type === "shoulder_shrug");
    expect(hit).toBeDefined();
  });

  it("detects a forward lean from shoulder-to-hip depth delta", () => {
    const base = computeSignerBaseline(neutral(30))!;
    const frames = [
      ...neutral(10),
      ...Array.from({ length: 20 }, (_, i) =>
        poseFrame(330 + i * 33, { shoulderL: [0.4, 0.5, -0.15], shoulderR: [0.6, 0.5, -0.15] }),
      ),
    ];
    const hit = detectNmms(frames, { baseline: base }).find((d) => d.type === "forward_lean");
    expect(hit).toBeDefined();
  });

  it("detects a body tilt from shoulder-line angle", () => {
    const base = computeSignerBaseline(neutral(30))!;
    const frames = [
      ...neutral(10),
      ...Array.from({ length: 20 }, (_, i) =>
        poseFrame(330 + i * 33, { shoulderL: [0.4, 0.44, 0], shoulderR: [0.6, 0.56, 0] }),
      ),
    ];
    const hit = detectNmms(frames, { baseline: base }).find((d) => d.type === "body_tilt");
    expect(hit).toBeDefined();
  });

  it("stamps every detection with the rule version that produced it", () => {
    const base = computeSignerBaseline(neutral(30))!;
    const frames = [
      ...neutral(10),
      ...Array.from({ length: 20 }, (_, i) =>
        poseFrame(330 + i * 33, { browL: [0.45, 0.24, 0], browR: [0.55, 0.24, 0] }),
      ),
    ];
    for (const d of detectNmms(frames, { baseline: base })) {
      expect(d.ruleVersion).toBe(BASELINE_RULE_VERSION);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/nmm-rules.test.ts`
Expected: FAIL — `Failed to resolve import "../server/nmm/baseline"`

- [ ] **Step 3: Write `server/nmm/baseline.ts`**

```ts
import type { Landmark, LandmarkFrame } from "../../shared/landmarks";

/** Pose indices, per design.md §5.2. */
export const POSE_SHOULDER_LEFT = 11;
export const POSE_SHOULDER_RIGHT = 12;
export const POSE_HIP_LEFT = 23;
export const POSE_HIP_RIGHT = 24;

/** Face indices, per design.md §5.2. */
export const FACE_NOSE = 0;
export const FACE_EAR_LEFT = 7;
export const FACE_EAR_RIGHT = 8;
export const FACE_EYE_LEFT = 33;
export const FACE_EYE_RIGHT = 133;
export const FACE_BROW_LEFT = 105;
export const FACE_BROW_RIGHT = 334;

/** Frames used to establish the signer's neutral posture. */
export const BASELINE_FRAME_COUNT = 30;

export type SignerBaseline = {
  /** Distance between the acromion landmarks. Every other measure is scaled by this. */
  shoulderWidth: number;
  /** Neutral vertical gap between the ocular centroid and the superciliary centroid. */
  neutralBrowGap: number;
  /** Neutral vertical gap between the shoulder line and the auditory landmarks. */
  neutralShoulderEarGap: number;
  /** Neutral depth delta between the shoulder plane and the hip plane. */
  neutralDepthDelta: number;
  /** Neutral horizontal position of the nose, relative to the shoulder midpoint. */
  neutralNoseOffset: number;
  frameCount: number;
};

export function midpoint(a: Landmark, b: Landmark): Landmark {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

export function distance2d(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Per-signer normalization. Camera distance and body size must not leak into
 * detection, so every rule measures against these values rather than raw units.
 * Returns null when pose or face is never detected in the opening window.
 */
export function computeSignerBaseline(frames: LandmarkFrame[]): SignerBaseline | null {
  const window = frames.slice(0, BASELINE_FRAME_COUNT).filter((f) => f.pose && f.face);
  if (window.length === 0) return null;

  const shoulderWidths: number[] = [];
  const browGaps: number[] = [];
  const shoulderEarGaps: number[] = [];
  const depthDeltas: number[] = [];
  const noseOffsets: number[] = [];

  for (const frame of window) {
    const pose = frame.pose!;
    const face = frame.face!;
    const shoulderL = pose[POSE_SHOULDER_LEFT];
    const shoulderR = pose[POSE_SHOULDER_RIGHT];
    const shoulderMid = midpoint(shoulderL, shoulderR);
    const width = distance2d(shoulderL, shoulderR);
    if (width === 0) continue;

    shoulderWidths.push(width);

    const eyeMid = midpoint(face[FACE_EYE_LEFT], face[FACE_EYE_RIGHT]);
    const browMid = midpoint(face[FACE_BROW_LEFT], face[FACE_BROW_RIGHT]);
    browGaps.push((eyeMid.y - browMid.y) / width);

    const earMid = midpoint(face[FACE_EAR_LEFT], face[FACE_EAR_RIGHT]);
    shoulderEarGaps.push((shoulderMid.y - earMid.y) / width);

    const hipMid = midpoint(pose[POSE_HIP_LEFT], pose[POSE_HIP_RIGHT]);
    depthDeltas.push((shoulderMid.z - hipMid.z) / width);

    noseOffsets.push((face[FACE_NOSE].x - shoulderMid.x) / width);
  }

  if (shoulderWidths.length === 0) return null;

  return {
    shoulderWidth: mean(shoulderWidths),
    neutralBrowGap: mean(browGaps),
    neutralShoulderEarGap: mean(shoulderEarGaps),
    neutralDepthDelta: mean(depthDeltas),
    neutralNoseOffset: mean(noseOffsets),
    frameCount: window.length,
  };
}
```

- [ ] **Step 4: Write `server/nmm/thresholds.ts`**

```ts
import type { NmmType } from "../../shared/workflow";

export const BASELINE_RULE_VERSION = "baseline-v1";

export type ThresholdProfile = {
  ruleVersion: string;
  /** Minimum consecutive frames a condition must hold before it is a detection. */
  minFrames: number;
  values: Record<NmmType, number>;
  /** Minimum direction reversals for the headshake oscillation window. */
  headshakeMinReversals: number;
  /** Sliding window, in frames, used for the headshake oscillation test. */
  headshakeWindowFrames: number;
};

/**
 * Thresholds are configuration, not constants: the NDFN Linguistic Validation
 * Workshop retunes them without a code change, and every stored tag records the
 * profile that produced it. See design.md §5.3 and §5.4.
 */
export const thresholdProfiles: Record<string, ThresholdProfile> = {
  [BASELINE_RULE_VERSION]: {
    ruleVersion: BASELINE_RULE_VERSION,
    minFrames: 4,
    values: {
      // All values are fractions of shoulder width, past the signer's neutral.
      eyebrow_raise: 0.12,
      headshake: 0.15,
      shoulder_shrug: 0.15,
      forward_lean: 0.35,
      body_tilt: 0.12, // radians of shoulder-line rotation
    },
    headshakeMinReversals: 3,
    headshakeWindowFrames: 20,
  },
};

export function getThresholdProfile(ruleVersion = BASELINE_RULE_VERSION): ThresholdProfile {
  const profile = thresholdProfiles[ruleVersion];
  if (!profile) throw new Error(`Unknown NMM threshold profile: ${ruleVersion}`);
  return profile;
}
```

- [ ] **Step 5: Write `server/nmm/rules.ts`**

```ts
import type { LandmarkFrame } from "../../shared/landmarks";
import type { NmmType } from "../../shared/workflow";
import {
  FACE_BROW_LEFT,
  FACE_BROW_RIGHT,
  FACE_EAR_LEFT,
  FACE_EAR_RIGHT,
  FACE_EYE_LEFT,
  FACE_EYE_RIGHT,
  FACE_NOSE,
  POSE_HIP_LEFT,
  POSE_HIP_RIGHT,
  POSE_SHOULDER_LEFT,
  POSE_SHOULDER_RIGHT,
  distance2d,
  midpoint,
  type SignerBaseline,
} from "./baseline";
import { BASELINE_RULE_VERSION, getThresholdProfile, type ThresholdProfile } from "./thresholds";

export type NmmDetection = {
  type: NmmType;
  startFrame: number;
  endFrame: number;
  confidence: number;
  ruleVersion: string;
};

export type NmmRule = {
  type: NmmType;
  ruleVersion: string;
  /**
   * Per-frame signal, expressed as a fraction of the rule's threshold.
   * `>= 1` means the condition holds for that frame. `null` means the frame
   * lacks the landmarks this rule needs and must not count either way.
   */
  signal(frames: LandmarkFrame[], index: number, ctx: RuleContext): number | null;
};

type RuleContext = { baseline: SignerBaseline; profile: ThresholdProfile };

function shoulderWidthOf(frame: LandmarkFrame): number | null {
  if (!frame.pose) return null;
  const width = distance2d(frame.pose[POSE_SHOULDER_LEFT], frame.pose[POSE_SHOULDER_RIGHT]);
  return width === 0 ? null : width;
}

const eyebrowRaise: NmmRule = {
  type: "eyebrow_raise",
  ruleVersion: BASELINE_RULE_VERSION,
  signal(frames, i, { baseline, profile }) {
    const frame = frames[i];
    const width = shoulderWidthOf(frame);
    if (!frame.face || width === null) return null;
    const eyeMid = midpoint(frame.face[FACE_EYE_LEFT], frame.face[FACE_EYE_RIGHT]);
    const browMid = midpoint(frame.face[FACE_BROW_LEFT], frame.face[FACE_BROW_RIGHT]);
    const gap = (eyeMid.y - browMid.y) / width;
    return (gap - baseline.neutralBrowGap) / profile.values.eyebrow_raise;
  },
};

const shoulderShrug: NmmRule = {
  type: "shoulder_shrug",
  ruleVersion: BASELINE_RULE_VERSION,
  signal(frames, i, { baseline, profile }) {
    const frame = frames[i];
    const width = shoulderWidthOf(frame);
    if (!frame.face || !frame.pose || width === null) return null;
    const shoulderMid = midpoint(frame.pose[POSE_SHOULDER_LEFT], frame.pose[POSE_SHOULDER_RIGHT]);
    const earMid = midpoint(frame.face[FACE_EAR_LEFT], frame.face[FACE_EAR_RIGHT]);
    const gap = (shoulderMid.y - earMid.y) / width;
    // Compression: the gap shrinks as the shoulders rise toward the ears.
    return (baseline.neutralShoulderEarGap - gap) / profile.values.shoulder_shrug;
  },
};

const forwardLean: NmmRule = {
  type: "forward_lean",
  ruleVersion: BASELINE_RULE_VERSION,
  signal(frames, i, { baseline, profile }) {
    const frame = frames[i];
    const width = shoulderWidthOf(frame);
    if (!frame.pose || width === null) return null;
    const shoulderMid = midpoint(frame.pose[POSE_SHOULDER_LEFT], frame.pose[POSE_SHOULDER_RIGHT]);
    const hipMid = midpoint(frame.pose[POSE_HIP_LEFT], frame.pose[POSE_HIP_RIGHT]);
    const delta = (shoulderMid.z - hipMid.z) / width;
    // MediaPipe z decreases toward the camera, so leaning in is a negative delta.
    return (baseline.neutralDepthDelta - delta) / profile.values.forward_lean;
  },
};

const bodyTilt: NmmRule = {
  type: "body_tilt",
  ruleVersion: BASELINE_RULE_VERSION,
  signal(frames, i, { profile }) {
    const frame = frames[i];
    if (!frame.pose) return null;
    const left = frame.pose[POSE_SHOULDER_LEFT];
    const right = frame.pose[POSE_SHOULDER_RIGHT];
    const angle = Math.abs(Math.atan2(right.y - left.y, right.x - left.x));
    return angle / profile.values.body_tilt;
  },
};

const headshake: NmmRule = {
  type: "headshake",
  ruleVersion: BASELINE_RULE_VERSION,
  signal(frames, i, { baseline, profile }) {
    const half = Math.floor(profile.headshakeWindowFrames / 2);
    const start = Math.max(0, i - half);
    const end = Math.min(frames.length, i + half);
    const offsets: number[] = [];

    for (let k = start; k < end; k += 1) {
      const frame = frames[k];
      const width = shoulderWidthOf(frame);
      if (!frame.face || !frame.pose || width === null) continue;
      const shoulderMid = midpoint(frame.pose[POSE_SHOULDER_LEFT], frame.pose[POSE_SHOULDER_RIGHT]);
      offsets.push((frame.face[FACE_NOSE].x - shoulderMid.x) / width - baseline.neutralNoseOffset);
    }

    if (offsets.length < 4) return null;

    let reversals = 0;
    let peak = 0;
    let direction = 0;
    for (let k = 1; k < offsets.length; k += 1) {
      const step = offsets[k] - offsets[k - 1];
      if (Math.abs(step) < 1e-6) continue;
      const next = step > 0 ? 1 : -1;
      if (direction !== 0 && next !== direction) reversals += 1;
      direction = next;
      peak = Math.max(peak, Math.abs(offsets[k]));
    }

    if (reversals < profile.headshakeMinReversals) return 0;
    return peak / profile.values.headshake;
  },
};

export const nmmRules: NmmRule[] = [
  eyebrowRaise,
  headshake,
  shoulderShrug,
  forwardLean,
  bodyTilt,
];

/**
 * Runs every rule over the sequence and collapses each rule's above-threshold
 * runs into detections. Pure: no I/O, no device, no model.
 */
export function detectNmms(
  frames: LandmarkFrame[],
  options: { baseline: SignerBaseline; ruleVersion?: string },
): NmmDetection[] {
  const profile = getThresholdProfile(options.ruleVersion);
  const ctx: RuleContext = { baseline: options.baseline, profile };
  const detections: NmmDetection[] = [];

  for (const rule of nmmRules) {
    let runStart: number | null = null;
    let runPeak = 0;

    const closeRun = (endExclusive: number) => {
      if (runStart === null) return;
      if (endExclusive - runStart >= profile.minFrames) {
        detections.push({
          type: rule.type,
          startFrame: runStart,
          endFrame: endExclusive - 1,
          confidence: Math.min(1, (runPeak - 1) / 1 + 0.5),
          ruleVersion: rule.ruleVersion,
        });
      }
      runStart = null;
      runPeak = 0;
    };

    for (let i = 0; i < frames.length; i += 1) {
      const signal = rule.signal(frames, i, ctx);
      if (signal === null || signal < 1) {
        closeRun(i);
        continue;
      }
      if (runStart === null) runStart = i;
      runPeak = Math.max(runPeak, signal);
    }
    closeRun(frames.length);
  }

  return detections.sort((a, b) => a.startFrame - b.startFrame);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run tests/nmm-rules.test.ts`
Expected: PASS (10 tests). If a rule under-fires, tune only the value in `thresholdProfiles` — never the landmark indices.

- [ ] **Step 7: Run the full suite and type check**

Run: `pnpm vitest run && pnpm check`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add server/nmm/ tests/nmm-rules.test.ts
git commit -m "feat: non-manual marker baseline and five geometric detection rules"
```

---

## Task 4: Corpus seed and its validation

**Files:**
- Create: `server/corpus-seed.ts`
- Test: `tests/corpus-seed.test.ts`

**Interfaces:**
- Consumes: `CORPUS_CATEGORIES`, `SENTENCES_PER_CATEGORY`, `CATEGORY_LETTERS`, `CorpusCategory` from `shared/corpus`.
- Produces: `corpusSeed: SeedPrompt[]`, `validateCorpusSeed(seed): CorpusValidation`, type `SeedPrompt = { id: string; category: CorpusCategory; orderIndex: number; textEnglish: string; expectedNmms: NmmType[] }`.

All 100 sentences are transcribed from Appendix A of the proposal. One entry is printed there as `" need help with this form."`, missing its leading "I"; the seed records it correctly and marks the correction in a comment. No other sentence is altered. The validation exists so a future edit cannot silently shorten a category.

- [ ] **Step 1: Write the failing test**

```ts
// tests/corpus-seed.test.ts
import { describe, expect, it } from "vitest";

import { corpusSeed, validateCorpusSeed } from "../server/corpus-seed";
import { CORPUS_CATEGORIES, CORPUS_SIZE, SENTENCES_PER_CATEGORY } from "../shared/corpus";

describe("corpus seed", () => {
  it("assigns a stable, category-letter id to every prompt", () => {
    expect(corpusSeed[0].id).toBe("A-01");
    expect(new Set(corpusSeed.map((p) => p.id)).size).toBe(corpusSeed.length);
  });

  it("holds all one hundred Appendix A sentences", () => {
    expect(corpusSeed).toHaveLength(CORPUS_SIZE);
    for (const category of CORPUS_CATEGORIES) {
      expect(corpusSeed.filter((p) => p.category === category)).toHaveLength(
        SENTENCES_PER_CATEGORY,
      );
    }
  });

  it("transcribes the first and last sentence of every category", () => {
    const bounds: Record<string, [string, string]> = {
      "A": ["I am going home.", "This is my house."],
      "B": ["What is your name?", "Is the water safe to drink?"],
      "C": ["I do not understand.", "I cannot go now."],
      "D": ["I went yesterday.", "I eat breakfast before class."],
      "E": ["I need a doctor now.", "I need urgent assistance."],
    };
    for (const [letter, [first, last]] of Object.entries(bounds)) {
      expect(corpusSeed.find((p) => p.id === `${letter}-01`)!.textEnglish).toBe(first);
      expect(corpusSeed.find((p) => p.id === `${letter}-20`)!.textEnglish).toBe(last);
    }
  });

  it("tags interrogatives and negations with the markers they are designed to elicit", () => {
    const question = corpusSeed.find((p) => p.id === "B-02")!;
    expect(question.textEnglish).toBe("Where is the hospital?");
    expect(question.expectedNmms).toContain("eyebrow_raise");

    const negation = corpusSeed.find((p) => p.id === "C-01")!;
    expect(negation.textEnglish).toBe("I do not understand.");
    expect(negation.expectedNmms).toContain("headshake");
  });

  it("corrects the mistyped Appendix A utility sentence", () => {
    expect(corpusSeed.some((p) => p.textEnglish === "I need help with this form.")).toBe(true);
    expect(corpusSeed.some((p) => p.textEnglish.startsWith(" need"))).toBe(false);
  });

  it("has no blank or duplicate sentences", () => {
    expect(corpusSeed.every((p) => p.textEnglish.trim().length > 0)).toBe(true);
    expect(new Set(corpusSeed.map((p) => p.textEnglish)).size).toBe(CORPUS_SIZE);
  });

  it("passes validation", () => {
    const result = validateCorpusSeed(corpusSeed);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  it("fails validation when a category is short", () => {
    const short = corpusSeed.filter((p) => p.id !== "E-20");
    const result = validateCorpusSeed(short);
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual([{ category: "utility", missing: 1 }]);
    expect(result.errors[0]).toContain("utility");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/corpus-seed.test.ts`
Expected: FAIL — `Failed to resolve import "../server/corpus-seed"`

- [ ] **Step 3: Write the implementation**

```ts
// server/corpus-seed.ts
import { CATEGORY_LETTERS, CORPUS_CATEGORIES, SENTENCES_PER_CATEGORY, type CorpusCategory } from "../shared/corpus";
import type { NmmType } from "../shared/workflow";

export type SeedPrompt = {
  id: string;
  category: CorpusCategory;
  orderIndex: number;
  textEnglish: string;
  expectedNmms: NmmType[];
};

const SENTENCES: Record<CorpusCategory, string[]> = {
  declarative: [
    "I am going home.",
    "My name is [Name].",
    "The school is open.",
    "I like coffee.",
    "It is a sunny day.",
    "The bus is late.",
    "I have a pen.",
    "We are learning.",
    "The water is cold.",
    "I see a mountain.",
    "She is reading a book.",
    "He is at the market.",
    "The room is quiet.",
    "We are in Kathmandu.",
    "The teacher is busy.",
    "My brother is tall.",
    "The food is ready.",
    "I feel happy today.",
    "The sky is clear.",
    "This is my house.",
  ],
  interrogative: [
    "What is your name?",
    "Where is the hospital?",
    "Are you hungry?",
    "Can you help me?",
    "When does the shop open?",
    "How do I get to Kathmandu?",
    "Is this your bag?",
    "Who is that person?",
    "Why are you late?",
    "Do you know sign language?",
    "Where are you going?",
    "What time is it?",
    "Can I sit here?",
    "Is the bus coming?",
    "Do you live here?",
    "Are you a student?",
    "Which road should I take?",
    "When will you return?",
    "Can you repeat that?",
    "Is the water safe to drink?",
  ],
  negation: [
    "I do not understand.",
    "I don't want sugar.",
    "No, that is wrong.",
    "The doctor is not here.",
    "I cannot sign fast.",
    "There is no more rice.",
    "I didn't see the car.",
    "He is not my brother.",
    "I don't like spicy food.",
    "It is not raining.",
    "She is not at home.",
    "I do not agree.",
    "The store is not open.",
    "We cannot wait longer.",
    "There is no money left.",
    "He did not come today.",
    "This is not mine.",
    "I am not ready.",
    "They are not coming.",
    "I cannot go now.",
  ],
  temporal: [
    "I went yesterday.",
    "We will meet tomorrow.",
    "I woke up at 7 AM.",
    "Next week is a holiday.",
    "Last year I was a student.",
    "I will finish soon.",
    "Before I eat, I wash hands.",
    "After the movie, I went home.",
    "Monday is a busy day.",
    "It takes two hours.",
    "I will arrive in the evening.",
    "She came before lunch.",
    "We studied after class.",
    "The meeting starts at 9 AM.",
    "I left early this morning.",
    "The shop closes at 5 PM.",
    "I will call you later.",
    "We finished the task yesterday.",
    "He will travel next month.",
    "I eat breakfast before class.",
  ],
  utility: [
    "I need a doctor now.",
    "Where is the emergency room?",
    "I lost my wallet.",
    "Please call an interpreter.",
    "I am allergic to medicine.",
    "There is a fire.",
    "I am feeling dizzy.",
    "Please write it down.",
    "Where is the police station?",
    // Appendix A prints this as " need help with this form." — corrected here.
    "I need help with this form.",
    "I need water.",
    "Please help me.",
    "I missed my bus.",
    "My phone is not working.",
    "Can you show me the way?",
    "I need to go to the hospital.",
    "Please speak slowly.",
    "I do not feel well.",
    "My child is sick.",
    "I need urgent assistance.",
  ],
};

/** Markers each category is designed to elicit. See design.md §6.1. */
const EXPECTED_NMMS: Record<CorpusCategory, NmmType[]> = {
  declarative: [],
  interrogative: ["eyebrow_raise"],
  negation: ["headshake"],
  temporal: ["forward_lean", "body_tilt"],
  utility: [],
};

export const corpusSeed: SeedPrompt[] = CORPUS_CATEGORIES.flatMap((category) =>
  SENTENCES[category].map((textEnglish, index) => ({
    id: `${CATEGORY_LETTERS[category]}-${String(index + 1).padStart(2, "0")}`,
    category,
    orderIndex: index,
    textEnglish,
    expectedNmms: EXPECTED_NMMS[category],
  })),
);

export type CorpusValidation = {
  valid: boolean;
  errors: string[];
  missing: { category: CorpusCategory; missing: number }[];
};

/**
 * The corpus must hold exactly twenty usable sentences per category. This guard
 * stops an edit silently shortening a category and unbalancing the study design.
 */
export function validateCorpusSeed(seed: SeedPrompt[]): CorpusValidation {
  const errors: string[] = [];
  const missing: { category: CorpusCategory; missing: number }[] = [];

  for (const category of CORPUS_CATEGORIES) {
    const usable = seed.filter((p) => p.category === category && p.textEnglish.trim().length > 0);
    const shortfall = SENTENCES_PER_CATEGORY - usable.length;
    if (shortfall > 0) {
      missing.push({ category, missing: shortfall });
      errors.push(
        `Category "${category}" holds ${usable.length} of ${SENTENCES_PER_CATEGORY} sentences; ${shortfall} missing.`,
      );
    }
  }

  const ids = seed.map((p) => p.id);
  if (new Set(ids).size !== ids.length) errors.push("Prompt ids are not unique.");

  return { valid: errors.length === 0, errors, missing };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/corpus-seed.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add server/corpus-seed.ts tests/corpus-seed.test.ts
git commit -m "feat: 100-sentence corpus seed with category-count validation"
```

---

## Task 5: Research schema and migration

**Files:**
- Modify: `drizzle/schema.ts` (add tables; keep `users`, `signerAccounts`, `signerInvitations`, `signerSessions`; replace `signerCaptures`)
- Create: `drizzle/00NN_*.sql` (generated)
- Test: `tests/schema-vocabulary.test.ts`

**Interfaces:**
- Consumes: `sessionStatuses`, `translationStatuses`, `feedbackVoteValues`, `nmmTypes` from `shared/workflow`; `CORPUS_CATEGORIES` from `shared/corpus`.
- Produces: tables `sentencePrompts`, `captureSessions`, `landmarkSequences`, `nmmTags`, `translationJobs`, `feedbackVotes`, `qualitativeRatings`, `consentRecords`, `splitAssignments`, and their `$inferSelect` types.

The DB enums are derived from the shared vocabularies so the two cannot drift — the drift between `SignerCapture.status` and the `signer_captures` enum is exactly the bug this prevents.

- [ ] **Step 1: Write the failing test**

```ts
// tests/schema-vocabulary.test.ts
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/mysql-core";

import {
  captureSessions,
  feedbackVotes,
  nmmTags,
  qualitativeRatings,
  sentencePrompts,
  translationJobs,
} from "../drizzle/schema";
import { CORPUS_CATEGORIES } from "../shared/corpus";
import {
  feedbackVoteValues,
  nmmTypes,
  sessionStatuses,
  translationStatuses,
} from "../shared/workflow";

function enumValues(table: unknown, columnName: string): readonly string[] {
  const column = getTableConfig(table as never).columns.find((c) => c.name === columnName);
  if (!column) throw new Error(`No column named ${columnName}`);
  return (column as unknown as { enumValues: readonly string[] }).enumValues;
}

describe("schema enums track the shared vocabularies", () => {
  it("uses the shared session status list", () => {
    expect(enumValues(captureSessions, "status")).toEqual([...sessionStatuses]);
  });

  it("uses the shared corpus categories", () => {
    expect(enumValues(sentencePrompts, "category")).toEqual([...CORPUS_CATEGORIES]);
    expect(enumValues(captureSessions, "category")).toEqual([...CORPUS_CATEGORIES]);
  });

  it("uses the shared translation status list", () => {
    expect(enumValues(translationJobs, "status")).toEqual([...translationStatuses]);
  });

  it("uses the shared vote and marker lists", () => {
    expect(enumValues(feedbackVotes, "vote")).toEqual([...feedbackVoteValues]);
    expect(enumValues(nmmTags, "type")).toEqual([...nmmTypes]);
  });

  it("stores the three Likert scales as separate columns", () => {
    const columns = getTableConfig(qualitativeRatings as never).columns.map((c) => c.name);
    expect(columns).toEqual(
      expect.arrayContaining(["naturalness", "grammaticality", "usefulness"]),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/schema-vocabulary.test.ts`
Expected: FAIL — `sentencePrompts` is not exported from `../drizzle/schema`

- [ ] **Step 3: Add the tables to `drizzle/schema.ts`**

Append to the existing file, and delete the `signerCaptures` table it replaces:

```ts
import { CORPUS_CATEGORIES } from "../shared/corpus";
import {
  feedbackVoteValues,
  nmmTypes,
  sessionStatuses,
  translationStatuses,
} from "../shared/workflow";

export const sentencePrompts = mysqlTable("sentence_prompts", {
  id: varchar("id", { length: 16 }).primaryKey(),
  category: mysqlEnum("category", CORPUS_CATEGORIES).notNull(),
  orderIndex: int("orderIndex").notNull(),
  textEnglish: varchar("textEnglish", { length: 512 }).notNull(),
  /** JSON array of NmmType — markers this sentence is designed to elicit. */
  expectedNmms: text("expectedNmms").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const consentRecords = mysqlTable(
  "consent_records",
  {
    id: int("id").autoincrement().primaryKey(),
    signerId: int("signerId").notNull(),
    consentVersion: varchar("consentVersion", { length: 32 }).notNull(),
    /** JSON array — "participation" and optionally "workshop_calibration". */
    scopes: text("scopes").notNull(),
    grantedAt: timestamp("grantedAt").defaultNow().notNull(),
    withdrawnAt: timestamp("withdrawnAt"),
  },
  (table) => [index("consent_signer_id_idx").on(table.signerId)],
);

export const captureSessions = mysqlTable(
  "capture_sessions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    signerId: int("signerId").notNull(),
    promptId: varchar("promptId", { length: 16 }).notNull(),
    category: mysqlEnum("category", CORPUS_CATEGORIES).notNull(),
    status: mysqlEnum("status", sessionStatuses).default("recording").notNull(),
    skipReason: varchar("skipReason", { length: 256 }),
    startedAt: timestamp("startedAt").defaultNow().notNull(),
    completedAt: timestamp("completedAt"),
  },
  (table) => [
    index("capture_session_signer_id_idx").on(table.signerId),
    index("capture_session_prompt_idx").on(table.signerId, table.promptId),
  ],
);

export const landmarkSequences = mysqlTable(
  "landmark_sequences",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    sessionId: varchar("sessionId", { length: 64 }).notNull().unique(),
    schemaVersion: int("schemaVersion").notNull(),
    extractorId: varchar("extractorId", { length: 64 }).notNull(),
    frameCount: int("frameCount").notNull(),
    targetFps: int("targetFps").notNull(),
    achievedFps: int("achievedFps").notNull(),
    durationMs: int("durationMs").notNull(),
    storageKey: varchar("storageKey", { length: 512 }).notNull().unique(),
    sizeBytes: int("sizeBytes").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [index("landmark_sequence_session_idx").on(table.sessionId)],
);

export const nmmTags = mysqlTable(
  "nmm_tags",
  {
    id: int("id").autoincrement().primaryKey(),
    sessionId: varchar("sessionId", { length: 64 }).notNull(),
    type: mysqlEnum("type", nmmTypes).notNull(),
    startFrame: int("startFrame").notNull(),
    endFrame: int("endFrame").notNull(),
    /** Confidence 0–1, stored as basis points to avoid float drift. */
    confidenceBp: int("confidenceBp").notNull(),
    ruleVersion: varchar("ruleVersion", { length: 64 }).notNull(),
  },
  (table) => [index("nmm_tag_session_idx").on(table.sessionId)],
);

export const translationJobs = mysqlTable(
  "translation_jobs",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    sessionId: varchar("sessionId", { length: 64 }).notNull(),
    status: mysqlEnum("status", translationStatuses).default("pending").notNull(),
    englishResponse: text("englishResponse"),
    confidenceBp: int("confidenceBp"),
    modelVersion: varchar("modelVersion", { length: 64 }).notNull(),
    latencyMs: int("latencyMs"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    completedAt: timestamp("completedAt"),
  },
  (table) => [index("translation_job_session_idx").on(table.sessionId)],
);

export const feedbackVotes = mysqlTable(
  "feedback_votes",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    translationJobId: varchar("translationJobId", { length: 64 }).notNull(),
    signerId: int("signerId"),
    vote: mysqlEnum("vote", feedbackVoteValues).notNull(),
    note: varchar("note", { length: 280 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    // MySQL treats NULLs as distinct, so anonymous votes are not constrained.
    uniqueIndex("feedback_vote_job_signer_uq").on(table.translationJobId, table.signerId),
  ],
);

export const qualitativeRatings = mysqlTable(
  "qualitative_ratings",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    translationJobId: varchar("translationJobId", { length: 64 }).notNull(),
    signerId: int("signerId"),
    naturalness: int("naturalness").notNull(),
    grammaticality: int("grammaticality").notNull(),
    usefulness: int("usefulness").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("qualitative_rating_job_signer_uq").on(table.translationJobId, table.signerId),
  ],
);

export const splitAssignments = mysqlTable("split_assignments", {
  signerId: int("signerId").primaryKey(),
  split: mysqlEnum("split", ["train", "validation", "test"]).notNull(),
  seed: varchar("seed", { length: 64 }).notNull(),
  assignedAt: timestamp("assignedAt").defaultNow().notNull(),
});

export type SentencePrompt = typeof sentencePrompts.$inferSelect;
export type ConsentRecord = typeof consentRecords.$inferSelect;
export type CaptureSession = typeof captureSessions.$inferSelect;
export type LandmarkSequence = typeof landmarkSequences.$inferSelect;
export type NmmTag = typeof nmmTags.$inferSelect;
export type TranslationJob = typeof translationJobs.$inferSelect;
export type FeedbackVoteRow = typeof feedbackVotes.$inferSelect;
export type QualitativeRating = typeof qualitativeRatings.$inferSelect;
export type SplitAssignment = typeof splitAssignments.$inferSelect;
```

Extend the existing import at line 1 to include `uniqueIndex`:

```ts
import { index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
```

Then delete the `signerCaptures` table and the `createCaptureForSigner` function in `server/signer-service.ts` that inserts into it, along with the `capture.submit` procedure in `server/routers.ts` — both are replaced in Task 7.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/schema-vocabulary.test.ts && pnpm check`
Expected: PASS, no TypeScript errors

- [ ] **Step 5: Generate the migration**

```bash
DATABASE_URL='mysql://signbridge:signbridge-local-password@localhost:3306/signbridge' pnpm drizzle-kit generate
```

Expected: a new `drizzle/0002_*.sql` plus a `drizzle/meta/0002_snapshot.json` and an updated `_journal.json`. Read the generated SQL and confirm it drops `signer_captures` and creates the nine new tables.

- [ ] **Step 6: Commit**

```bash
git add drizzle/ tests/schema-vocabulary.test.ts server/signer-service.ts server/routers.ts
git commit -m "feat: research schema for prompts, sessions, sequences, tags, translation, feedback, consent, splits"
```

---

## Task 6: Consent service and gate

**Files:**
- Create: `server/consent-service.ts`
- Modify: `server/routers.ts` (add `consent` router)
- Test: `tests/consent.test.ts`

**Interfaces:**
- Consumes: `consentRecords` from `drizzle/schema`; `getSignerFromSessionToken`, `extractBearerToken` from `server/signer-service` and `server/signer-security`.
- Produces: `CURRENT_CONSENT_VERSION`, `CONSENT_SCOPES`, `isConsentCurrent(record, version)`, `parseScopes(raw)`, `grantConsent(input)`, `withdrawConsent(signerId)`, `getCurrentConsent(signerId)`; router `consent.status`, `consent.grant`, `consent.withdraw`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/consent.test.ts
import { describe, expect, it } from "vitest";

import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";
import {
  CONSENT_SCOPES,
  CURRENT_CONSENT_VERSION,
  isConsentCurrent,
  parseScopes,
} from "../server/consent-service";

function anonymousContext(): TrpcContext {
  return {
    user: null,
    req: { headers: {}, protocol: "http" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("consent vocabulary", () => {
  it("names the participation and workshop scopes", () => {
    expect(CONSENT_SCOPES).toEqual(["participation", "workshop_calibration"]);
  });

  it("parses a stored scope list and rejects unknown scopes", () => {
    expect(parseScopes('["participation"]')).toEqual(["participation"]);
    expect(parseScopes('["participation","bogus"]')).toEqual(["participation"]);
    expect(parseScopes("not json")).toEqual([]);
  });
});

describe("consent currency", () => {
  const base = {
    consentVersion: CURRENT_CONSENT_VERSION,
    withdrawnAt: null as Date | null,
    scopes: '["participation"]',
  };

  it("accepts a current, unwithdrawn grant", () => {
    expect(isConsentCurrent(base, CURRENT_CONSENT_VERSION)).toBe(true);
  });

  it("rejects a withdrawn grant", () => {
    expect(isConsentCurrent({ ...base, withdrawnAt: new Date() }, CURRENT_CONSENT_VERSION)).toBe(
      false,
    );
  });

  it("rejects a grant made against an earlier consent version", () => {
    expect(isConsentCurrent({ ...base, consentVersion: "v0" }, CURRENT_CONSENT_VERSION)).toBe(false);
  });

  it("rejects a missing grant", () => {
    expect(isConsentCurrent(null, CURRENT_CONSENT_VERSION)).toBe(false);
  });
});

describe("consent router", () => {
  it("refuses to grant consent without a signer session", async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(
      caller.consent.grant({ consentVersion: CURRENT_CONSENT_VERSION, scopes: ["participation"] }),
    ).rejects.toThrow(/sign in/i);
  });

  it("reports no consent for an anonymous caller", async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(caller.consent.status()).resolves.toEqual({
      granted: false,
      consentVersion: CURRENT_CONSENT_VERSION,
      scopes: [],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/consent.test.ts`
Expected: FAIL — `Failed to resolve import "../server/consent-service"`

- [ ] **Step 3: Write `server/consent-service.ts`**

```ts
import { and, desc, eq, isNull } from "drizzle-orm";

import { consentRecords } from "../drizzle/schema";
import { getDb } from "./db";

/** Bump when the participant-facing consent text changes materially. */
export const CURRENT_CONSENT_VERSION = "v1";

export const CONSENT_SCOPES = ["participation", "workshop_calibration"] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];

type ConsentShape = {
  consentVersion: string;
  withdrawnAt: Date | null;
  scopes: string;
};

export function parseScopes(raw: string): ConsentScope[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is ConsentScope =>
      (CONSENT_SCOPES as readonly string[]).includes(s),
    );
  } catch {
    return [];
  }
}

/**
 * A grant is current only if it exists, was made against the version in force,
 * and has not been withdrawn. A protocol amendment therefore invalidates prior
 * grants rather than silently reinterpreting them.
 */
export function isConsentCurrent(
  record: ConsentShape | null,
  version = CURRENT_CONSENT_VERSION,
): boolean {
  if (!record) return false;
  if (record.withdrawnAt !== null) return false;
  return record.consentVersion === version;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("The consent database is not configured.");
  return db;
}

export async function getCurrentConsent(signerId: number) {
  const db = await requireDb();
  const row = (
    await db
      .select()
      .from(consentRecords)
      .where(and(eq(consentRecords.signerId, signerId), isNull(consentRecords.withdrawnAt)))
      .orderBy(desc(consentRecords.grantedAt))
      .limit(1)
  )[0];
  return row ?? null;
}

export async function grantConsent(input: {
  signerId: number;
  consentVersion: string;
  scopes: ConsentScope[];
}) {
  const db = await requireDb();
  await db
    .update(consentRecords)
    .set({ withdrawnAt: new Date() })
    .where(and(eq(consentRecords.signerId, input.signerId), isNull(consentRecords.withdrawnAt)));

  await db.insert(consentRecords).values({
    signerId: input.signerId,
    consentVersion: input.consentVersion,
    scopes: JSON.stringify(input.scopes),
  });

  return { granted: true as const, consentVersion: input.consentVersion, scopes: input.scopes };
}

export async function withdrawConsent(signerId: number) {
  const db = await requireDb();
  await db
    .update(consentRecords)
    .set({ withdrawnAt: new Date() })
    .where(and(eq(consentRecords.signerId, signerId), isNull(consentRecords.withdrawnAt)));
  return { granted: false as const };
}

/** Capture is unreachable without a current grant. Throws otherwise. */
export async function requireCurrentConsent(signerId: number) {
  const record = await getCurrentConsent(signerId);
  if (!isConsentCurrent(record)) {
    throw new Error("Research consent is required before capture.");
  }
  return record!;
}
```

- [ ] **Step 4: Add the router to `server/routers.ts`**

Add this helper above `appRouter`, and the router inside it:

```ts
async function signerFromContext(ctx: { req: { headers: Record<string, unknown> } }) {
  const token = extractBearerToken(ctx.req.headers.authorization as string | undefined);
  return token ? getSignerFromSessionToken(token) : null;
}
```

```ts
  consent: router({
    status: publicProcedure.query(async ({ ctx }) => {
      const signer = await signerFromContext(ctx);
      if (!signer) {
        return { granted: false, consentVersion: CURRENT_CONSENT_VERSION, scopes: [] as string[] };
      }
      const record = await getCurrentConsent(signer.id);
      return {
        granted: isConsentCurrent(record),
        consentVersion: CURRENT_CONSENT_VERSION,
        scopes: record ? parseScopes(record.scopes) : ([] as string[]),
      };
    }),
    grant: publicProcedure
      .input(
        z.object({
          consentVersion: z.string().max(32),
          scopes: z.array(z.enum(CONSENT_SCOPES)).min(1),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const signer = await signerFromContext(ctx);
        if (!signer) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in before granting consent." });
        }
        return grantConsent({ signerId: signer.id, ...input });
      }),
    withdraw: publicProcedure.mutation(async ({ ctx }) => {
      const signer = await signerFromContext(ctx);
      if (!signer) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in before withdrawing consent." });
      }
      return withdrawConsent(signer.id);
    }),
  }),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/consent.test.ts && pnpm check`
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add server/consent-service.ts server/routers.ts tests/consent.test.ts
git commit -m "feat: versioned, scoped, revocable research consent"
```

---

## Task 7: Sequence storage and the capture session API

**Files:**
- Create: `server/sequence-storage.ts`
- Delete: `server/recording-storage.ts`
- Create: `server/session-service.ts`
- Create: `server/sequence-upload.ts`
- Modify: `server/_core/index.ts` (register the upload route)
- Modify: `server/routers.ts` (replace the `capture` router)
- Test: `tests/sequence-upload.test.ts`

**Interfaces:**
- Consumes: `LandmarkSequencePayload` from `shared/landmarks`; `detectNmms`, `computeSignerBaseline` from `server/nmm/*`; `requireCurrentConsent` from `server/consent-service`; `corpusSeed` from `server/corpus-seed`.
- Produces: `sequenceObjectKey(input)`, `putLandmarkSequence(input)`, `assertStorageConfig()`, `MAX_SEQUENCE_BYTES`, `resolveUploadRejection(input)`, `registerSequenceUploadRoute(app)`; router `capture.nextPrompt`, `capture.startSession`, `capture.skipPrompt`, `capture.progress`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/sequence-upload.test.ts
import { describe, expect, it } from "vitest";

import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";
import { MAX_SEQUENCE_BYTES, resolveUploadRejection } from "../server/sequence-upload";
import { sequenceObjectKey } from "../server/sequence-storage";

function anonymousContext(): TrpcContext {
  return {
    user: null,
    req: { headers: {}, protocol: "http" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

const signer = { id: 7, email: "a@b.test", displayName: null, status: "active" as const };
const session = { id: "s-1", signerId: 7, status: "recording" as const };

describe("sequence object keys", () => {
  it("namespaces by signer and session and never uses a video extension", () => {
    const key = sequenceObjectKey({ signerId: 7, sessionId: "s-1" });
    expect(key).toBe("sequences/signer-7/s-1.json.gz");
    expect(key).not.toMatch(/\.mp4$/);
  });
});

describe("upload authorization", () => {
  it("rejects an unauthenticated upload", () => {
    expect(
      resolveUploadRejection({ signer: null, session, byteLength: 100, contentType: "application/json" }),
    ).toEqual({ status: 401, message: "Sign in before submitting a sequence." });
  });

  it("rejects a session that belongs to another signer", () => {
    expect(
      resolveUploadRejection({
        signer,
        session: { ...session, signerId: 99 },
        byteLength: 100,
        contentType: "application/json",
      }),
    ).toEqual({ status: 403, message: "This session belongs to another signer." });
  });

  it("rejects a missing session", () => {
    expect(
      resolveUploadRejection({ signer, session: null, byteLength: 100, contentType: "application/json" }),
    ).toEqual({ status: 404, message: "The capture session was not found." });
  });

  it("rejects a session that already has a stored sequence", () => {
    expect(
      resolveUploadRejection({
        signer,
        session: { ...session, status: "stored" },
        byteLength: 100,
        contentType: "application/json",
      }),
    ).toEqual({ status: 409, message: "This session already has a stored sequence." });
  });

  it("rejects an empty body", () => {
    expect(
      resolveUploadRejection({ signer, session, byteLength: 0, contentType: "application/json" }),
    ).toEqual({ status: 400, message: "The sequence payload was empty." });
  });

  it("rejects a body over the size limit", () => {
    expect(
      resolveUploadRejection({
        signer,
        session,
        byteLength: MAX_SEQUENCE_BYTES + 1,
        contentType: "application/json",
      }),
    ).toEqual({ status: 413, message: "The sequence payload is too large." });
  });

  it("rejects a video content type outright", () => {
    expect(
      resolveUploadRejection({ signer, session, byteLength: 100, contentType: "video/mp4" }),
    ).toEqual({ status: 415, message: "Only landmark sequences are accepted." });
  });

  it("accepts a signer's own recording session", () => {
    expect(
      resolveUploadRejection({ signer, session, byteLength: 4096, contentType: "application/json" }),
    ).toBeNull();
  });
});

describe("capture router authorization", () => {
  it("refuses to start a session without a signer", async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(caller.capture.startSession({ promptId: "A-01" })).rejects.toThrow(/sign in/i);
  });

  it("refuses to report progress without a signer", async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(caller.capture.progress()).rejects.toThrow(/sign in/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/sequence-upload.test.ts`
Expected: FAIL — `Failed to resolve import "../server/sequence-upload"`

- [ ] **Step 3: Write `server/sequence-storage.ts` and delete `server/recording-storage.ts`**

```ts
import { Client } from "minio";

const bucketName = process.env.OBJECT_STORAGE_BUCKET ?? "signbridge-sequences";
const region = process.env.OBJECT_STORAGE_REGION ?? "us-east-1";

function isHetzner() {
  return process.env.OBJECT_STORAGE_MODE === "hetzner";
}

/**
 * Fails fast in production rather than surfacing a misconfiguration as a
 * mysterious upload error. Buckets are private and credentials are server-side
 * only; the client never receives either.
 */
export function assertStorageConfig() {
  if (!isHetzner()) return;
  const required = [
    "OBJECT_STORAGE_ENDPOINT",
    "OBJECT_STORAGE_BUCKET",
    "OBJECT_STORAGE_ACCESS_KEY",
    "OBJECT_STORAGE_SECRET_KEY",
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Object storage is not configured: missing ${missing.join(", ")}`);
  }
}

function createClient() {
  const endpoint = new URL(process.env.OBJECT_STORAGE_ENDPOINT ?? "http://minio:9000");
  return new Client({
    endPoint: endpoint.hostname,
    port: Number(endpoint.port || (endpoint.protocol === "https:" ? 443 : 80)),
    useSSL: endpoint.protocol === "https:",
    accessKey: process.env.OBJECT_STORAGE_ACCESS_KEY ?? "signbridge-local",
    secretKey: process.env.OBJECT_STORAGE_SECRET_KEY ?? "signbridge-local-secret",
    region,
  });
}

export function sequenceObjectKey(input: { signerId: number; sessionId: string }) {
  return `sequences/signer-${input.signerId}/${input.sessionId}.json.gz`;
}

/**
 * The single storage boundary for landmark sequences. Docker development targets
 * MinIO; production targets a private Hetzner Object Storage bucket. No video
 * passes through here — see design.md §3.3 for the one flag-gated exception.
 */
export async function putLandmarkSequence(input: {
  key: string;
  data: Uint8Array;
}) {
  assertStorageConfig();
  const client = createClient();

  // In production the bucket is provisioned out of band; auto-creating it would
  // mask a credential or naming error rather than surfacing it.
  if (!isHetzner() && !(await client.bucketExists(bucketName))) {
    await client.makeBucket(bucketName, region);
  }

  await client.putObject(bucketName, input.key, Buffer.from(input.data), input.data.byteLength, {
    "Content-Type": "application/gzip",
  });

  return {
    bucket: bucketName,
    key: input.key,
    sizeBytes: input.data.byteLength,
    storageDriver: isHetzner() ? "hetzner-object-storage" : "minio",
  } as const;
}

export async function getLandmarkSequenceUrl(key: string, ttlSeconds = 300) {
  assertStorageConfig();
  return createClient().presignedGetObject(bucketName, key, ttlSeconds);
}
```

```bash
rm server/recording-storage.ts
```

- [ ] **Step 4: Write `server/sequence-upload.ts`**

```ts
import express, { type Express } from "express";
import { gunzipSync } from "node:zlib";

import { computeSignerBaseline } from "./nmm/baseline";
import { detectNmms } from "./nmm/rules";
import { extractBearerToken } from "./signer-security";
import { getSignerFromSessionToken } from "./signer-service";
import { putLandmarkSequence, sequenceObjectKey } from "./sequence-storage";
import { getCaptureSession, storeSequenceForSession } from "./session-service";
import { requireCurrentConsent } from "./consent-service";
import type { LandmarkSequencePayload } from "../shared/landmarks";

/** 30 fps × 60 s of gzipped landmark JSON sits well inside this. */
export const MAX_SEQUENCE_BYTES = 24 * 1024 * 1024;

type Rejection = { status: number; message: string };

/**
 * Pure authorization and validation gate. Deterministic and DB-free so the whole
 * decision table is unit-testable.
 */
export function resolveUploadRejection(input: {
  signer: { id: number } | null;
  session: { id: string; signerId: number; status: string } | null;
  byteLength: number;
  contentType: string | undefined;
}): Rejection | null {
  if (!input.signer) return { status: 401, message: "Sign in before submitting a sequence." };
  if (!input.session) return { status: 404, message: "The capture session was not found." };
  if (input.session.signerId !== input.signer.id) {
    return { status: 403, message: "This session belongs to another signer." };
  }
  if (input.session.status !== "recording" && input.session.status !== "pending_upload") {
    return { status: 409, message: "This session already has a stored sequence." };
  }
  if ((input.contentType ?? "").startsWith("video/")) {
    return { status: 415, message: "Only landmark sequences are accepted." };
  }
  if (input.byteLength === 0) return { status: 400, message: "The sequence payload was empty." };
  if (input.byteLength > MAX_SEQUENCE_BYTES) {
    return { status: 413, message: "The sequence payload is too large." };
  }
  return null;
}

export function registerSequenceUploadRoute(app: Express) {
  app.post(
    "/api/sessions/:sessionId/sequence",
    express.raw({ type: ["application/gzip", "application/json"], limit: MAX_SEQUENCE_BYTES }),
    async (req, res) => {
      const token = extractBearerToken(req.headers.authorization);
      const signer = token ? await getSignerFromSessionToken(token) : null;
      const session = await getCaptureSession(req.params.sessionId);
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

      const rejection = resolveUploadRejection({
        signer,
        session,
        byteLength: body.byteLength,
        contentType: req.headers["content-type"],
      });
      if (rejection) {
        res.status(rejection.status).json({ error: rejection.message });
        return;
      }

      try {
        await requireCurrentConsent(signer!.id);
      } catch {
        res.status(403).json({ error: "Research consent is required before capture." });
        return;
      }

      let payload: LandmarkSequencePayload;
      try {
        const json =
          req.headers["content-type"] === "application/gzip" ? gunzipSync(body) : body;
        payload = JSON.parse(json.toString("utf8")) as LandmarkSequencePayload;
      } catch {
        res.status(400).json({ error: "The sequence payload could not be decoded." });
        return;
      }

      const baseline = computeSignerBaseline(payload.frames);
      const detections = baseline ? detectNmms(payload.frames, { baseline }) : [];

      const key = sequenceObjectKey({ signerId: signer!.id, sessionId: session!.id });
      const stored = await putLandmarkSequence({ key, data: body });

      await storeSequenceForSession({
        sessionId: session!.id,
        payload,
        storageKey: stored.key,
        sizeBytes: stored.sizeBytes,
        detections,
      });

      res.status(201).json({
        sessionId: session!.id,
        status: "stored",
        frameCount: payload.frameCount,
        nmmTags: detections.length,
      });
    },
  );
}
```

- [ ] **Step 5: Write `server/session-service.ts`**

```ts
import { and, eq, inArray } from "drizzle-orm";

import { captureSessions, landmarkSequences, nmmTags, sentencePrompts } from "../drizzle/schema";
import { corpusSeed } from "./corpus-seed";
import { getDb } from "./db";
import type { NmmDetection } from "./nmm/rules";
import { CORPUS_SIZE } from "../shared/corpus";
import type { LandmarkSequencePayload } from "../shared/landmarks";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("The session database is not configured.");
  return db;
}

/**
 * Seeded per-signer prompt order. A partial contribution must stay balanced
 * across categories rather than concentrating in Category A, so the order
 * interleaves categories and is stable for a given signer.
 */
export function promptOrderForSigner(signerId: number): string[] {
  const byCategory = new Map<string, string[]>();
  for (const prompt of corpusSeed) {
    const list = byCategory.get(prompt.category) ?? [];
    list.push(prompt.id);
    byCategory.set(prompt.category, list);
  }
  const categories = [...byCategory.keys()];
  const rotation = signerId % categories.length;
  const rotated = [...categories.slice(rotation), ...categories.slice(0, rotation)];

  const order: string[] = [];
  for (let i = 0; i < CORPUS_SIZE; i += 1) {
    const category = rotated[i % rotated.length];
    const slot = Math.floor(i / rotated.length);
    const id = byCategory.get(category)?.[slot];
    if (id) order.push(id);
  }
  return order;
}

export async function getCaptureSession(sessionId: string) {
  const db = await requireDb();
  const row = (
    await db.select().from(captureSessions).where(eq(captureSessions.id, sessionId)).limit(1)
  )[0];
  return row ?? null;
}

export async function getSignerProgress(signerId: number) {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(captureSessions)
    .where(
      and(
        eq(captureSessions.signerId, signerId),
        inArray(captureSessions.status, ["stored", "skipped"]),
      ),
    );

  const completedPromptIds = new Set(rows.filter((r) => r.status === "stored").map((r) => r.promptId));
  const skippedPromptIds = new Set(rows.filter((r) => r.status === "skipped").map((r) => r.promptId));

  const byCategory: Record<string, number> = {};
  for (const prompt of corpusSeed) {
    if (completedPromptIds.has(prompt.id)) {
      byCategory[prompt.category] = (byCategory[prompt.category] ?? 0) + 1;
    }
  }

  return {
    completed: completedPromptIds.size,
    skipped: skippedPromptIds.size,
    total: CORPUS_SIZE,
    byCategory,
    completedPromptIds: [...completedPromptIds],
    skippedPromptIds: [...skippedPromptIds],
  };
}

export async function getNextPromptForSigner(signerId: number) {
  const progress = await getSignerProgress(signerId);
  const done = new Set([...progress.completedPromptIds, ...progress.skippedPromptIds]);
  const nextId = promptOrderForSigner(signerId).find((id) => !done.has(id));
  if (!nextId) return null;
  const prompt = corpusSeed.find((p) => p.id === nextId)!;
  return { ...prompt, progress: { completed: progress.completed, total: progress.total } };
}

export async function startCaptureSession(input: { signerId: number; promptId: string }) {
  const db = await requireDb();
  const prompt = corpusSeed.find((p) => p.id === input.promptId);
  if (!prompt) throw new Error(`Unknown prompt: ${input.promptId}`);

  // A redo supersedes the previous stored session; the old one is kept for audit.
  await db
    .update(captureSessions)
    .set({ status: "superseded" })
    .where(
      and(
        eq(captureSessions.signerId, input.signerId),
        eq(captureSessions.promptId, input.promptId),
        eq(captureSessions.status, "stored"),
      ),
    );

  const id = crypto.randomUUID();
  await db.insert(captureSessions).values({
    id,
    signerId: input.signerId,
    promptId: prompt.id,
    category: prompt.category,
    status: "recording",
  });

  return { id, promptId: prompt.id, category: prompt.category, textEnglish: prompt.textEnglish };
}

export async function skipPrompt(input: { signerId: number; promptId: string; reason: string }) {
  const db = await requireDb();
  const prompt = corpusSeed.find((p) => p.id === input.promptId);
  if (!prompt) throw new Error(`Unknown prompt: ${input.promptId}`);

  const id = crypto.randomUUID();
  await db.insert(captureSessions).values({
    id,
    signerId: input.signerId,
    promptId: prompt.id,
    category: prompt.category,
    status: "skipped",
    skipReason: input.reason.slice(0, 256),
    completedAt: new Date(),
  });
  return { id, status: "skipped" as const };
}

export async function storeSequenceForSession(input: {
  sessionId: string;
  payload: LandmarkSequencePayload;
  storageKey: string;
  sizeBytes: number;
  detections: NmmDetection[];
}) {
  const db = await requireDb();

  await db.insert(landmarkSequences).values({
    id: crypto.randomUUID(),
    sessionId: input.sessionId,
    schemaVersion: input.payload.schemaVersion,
    extractorId: input.payload.extractorId,
    frameCount: input.payload.frameCount,
    targetFps: Math.round(input.payload.targetFps),
    achievedFps: Math.round(input.payload.achievedFps),
    durationMs: input.payload.durationMs,
    storageKey: input.storageKey,
    sizeBytes: input.sizeBytes,
  });

  if (input.detections.length > 0) {
    await db.insert(nmmTags).values(
      input.detections.map((d) => ({
        sessionId: input.sessionId,
        type: d.type,
        startFrame: d.startFrame,
        endFrame: d.endFrame,
        confidenceBp: Math.round(d.confidence * 10_000),
        ruleVersion: d.ruleVersion,
      })),
    );
  }

  await db
    .update(captureSessions)
    .set({ status: "stored", completedAt: new Date() })
    .where(eq(captureSessions.id, input.sessionId));

  return { sessionId: input.sessionId, status: "stored" as const };
}

export async function seedSentencePrompts() {
  const db = await requireDb();
  for (const prompt of corpusSeed) {
    await db
      .insert(sentencePrompts)
      .values({
        id: prompt.id,
        category: prompt.category,
        orderIndex: prompt.orderIndex,
        textEnglish: prompt.textEnglish,
        expectedNmms: JSON.stringify(prompt.expectedNmms),
      })
      .onDuplicateKeyUpdate({
        set: { textEnglish: prompt.textEnglish, expectedNmms: JSON.stringify(prompt.expectedNmms) },
      });
  }
  return { seeded: corpusSeed.length };
}
```

- [ ] **Step 6: Replace the `capture` router in `server/routers.ts`**

```ts
  capture: router({
    nextPrompt: publicProcedure.query(async ({ ctx }) => {
      const signer = await signerFromContext(ctx);
      if (!signer) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to collect samples." });
      return getNextPromptForSigner(signer.id);
    }),
    progress: publicProcedure.query(async ({ ctx }) => {
      const signer = await signerFromContext(ctx);
      if (!signer) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to view progress." });
      return getSignerProgress(signer.id);
    }),
    startSession: publicProcedure
      .input(z.object({ promptId: z.string().min(1).max(16) }))
      .mutation(async ({ ctx, input }) => {
        const signer = await signerFromContext(ctx);
        if (!signer) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in before capturing." });
        await requireCurrentConsent(signer.id).catch(() => {
          throw new TRPCError({ code: "FORBIDDEN", message: "Research consent is required before capture." });
        });
        return startCaptureSession({ signerId: signer.id, promptId: input.promptId });
      }),
    skipPrompt: publicProcedure
      .input(z.object({ promptId: z.string().min(1).max(16), reason: z.string().trim().max(256) }))
      .mutation(async ({ ctx, input }) => {
        const signer = await signerFromContext(ctx);
        if (!signer) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in before skipping." });
        return skipPrompt({ signerId: signer.id, ...input });
      }),
  }),
```

- [ ] **Step 7: Register the route in `server/_core/index.ts`**

Add the import and call it beside the other registrations (after `registerOAuthRoutes(app)` at line 58):

```ts
import { registerSequenceUploadRoute } from "../sequence-upload";
// …
  registerSequenceUploadRoute(app);
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm vitest run tests/sequence-upload.test.ts && pnpm check`
Expected: PASS (11 tests)

- [ ] **Step 9: Commit**

```bash
git add server/sequence-storage.ts server/sequence-upload.ts server/session-service.ts server/routers.ts server/_core/index.ts tests/sequence-upload.test.ts
git rm --cached server/recording-storage.ts 2>/dev/null || true
git commit -m "feat: landmark sequence storage, capture sessions, and authenticated upload"
```

---

## Task 8: Translation service and job lifecycle

**Files:**
- Create: `server/translation-service.ts`
- Modify: `server/routers.ts` (replace the `evaluation` router with `translation`)
- Test: `tests/translation-service.test.ts`

**Interfaces:**
- Consumes: `translationStatuses` from `shared/workflow`.
- Produces: `SignTranslator`, `createFixtureTranslator()`, `FIXTURE_MODEL_VERSION`, `getTranslator()`, `createTranslationJob(input)`; router `translation.next`, `translation.request`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/translation-service.test.ts
import { describe, expect, it } from "vitest";

import {
  FIXTURE_MODEL_VERSION,
  createFixtureTranslator,
  getTranslator,
} from "../server/translation-service";

describe("fixture translator", () => {
  it("reports a model version so results stay attributable", () => {
    expect(createFixtureTranslator().modelVersion).toBe(FIXTURE_MODEL_VERSION);
  });

  it("is deterministic for the same sequence reference", async () => {
    const translator = createFixtureTranslator();
    const a = await translator.translate({ sequenceRef: "s-1", frameCount: 120 });
    const b = await translator.translate({ sequenceRef: "s-1", frameCount: 120 });
    expect(a).toEqual(b);
  });

  it("varies its output across different sequences", async () => {
    const translator = createFixtureTranslator();
    const outputs = await Promise.all(
      ["s-1", "s-2", "s-3", "s-4"].map((ref) =>
        translator.translate({ sequenceRef: ref, frameCount: 120 }),
      ),
    );
    expect(new Set(outputs.map((o) => o.englishResponse)).size).toBeGreaterThan(1);
  });

  it("returns a confidence inside the unit interval", async () => {
    const { confidence } = await createFixtureTranslator().translate({
      sequenceRef: "s-9",
      frameCount: 200,
    });
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  it("selects the fixture translator when no model is configured", () => {
    delete process.env.SIGN_TRANSLATOR_MODE;
    expect(getTranslator().modelVersion).toBe(FIXTURE_MODEL_VERSION);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/translation-service.test.ts`
Expected: FAIL — `Failed to resolve import "../server/translation-service"`

- [ ] **Step 3: Write the implementation**

```ts
// server/translation-service.ts
import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";

import { translationJobs } from "../drizzle/schema";
import { getDb } from "./db";

export const FIXTURE_MODEL_VERSION = "fixture@1";

export interface SignTranslator {
  readonly modelVersion: string;
  translate(input: { sequenceRef: string; frameCount: number }): Promise<{
    englishResponse: string;
    confidence: number;
  }>;
}

/**
 * Deterministic stand-in for the multi-stream Transformer. It exists so the full
 * contract — session, upload, job lifecycle, feedback, ratings, export — is
 * exercisable end to end before the model exists. See design.md §14.2.
 */
const FIXTURE_RESPONSES = [
  "I am going home.",
  "Where is the hospital?",
  "I do not understand.",
  "I went yesterday.",
  "I need a doctor now.",
  "Can you help me?",
];

export function createFixtureTranslator(): SignTranslator {
  return {
    modelVersion: FIXTURE_MODEL_VERSION,
    async translate({ sequenceRef, frameCount }) {
      const digest = createHash("sha256").update(sequenceRef).digest();
      const englishResponse = FIXTURE_RESPONSES[digest[0] % FIXTURE_RESPONSES.length];
      // Longer sequences read as marginally more confident; bounded to [0.5, 0.95].
      const confidence = Math.min(0.95, 0.5 + Math.min(frameCount, 450) / 1000);
      return { englishResponse, confidence };
    },
  };
}

export function getTranslator(): SignTranslator {
  // Only the fixture translator exists today. When the Transformer ships, select
  // it here on SIGN_TRANSLATOR_MODE and leave every caller untouched.
  return createFixtureTranslator();
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("The translation database is not configured.");
  return db;
}

export async function createTranslationJob(input: { sessionId: string; frameCount: number }) {
  const db = await requireDb();
  const translator = getTranslator();
  const id = crypto.randomUUID();
  const startedAt = Date.now();

  await db.insert(translationJobs).values({
    id,
    sessionId: input.sessionId,
    status: "processing",
    modelVersion: translator.modelVersion,
  });

  try {
    const result = await translator.translate({
      sequenceRef: input.sessionId,
      frameCount: input.frameCount,
    });
    const latencyMs = Date.now() - startedAt;

    await db
      .update(translationJobs)
      .set({
        status: "complete",
        englishResponse: result.englishResponse,
        confidenceBp: Math.round(result.confidence * 10_000),
        latencyMs,
        completedAt: new Date(),
      })
      .where(eq(translationJobs.id, id));

    return {
      id,
      status: "complete" as const,
      englishResponse: result.englishResponse,
      confidence: result.confidence,
      modelVersion: translator.modelVersion,
      latencyMs,
    };
  } catch (error) {
    await db
      .update(translationJobs)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(translationJobs.id, id));
    throw error;
  }
}

export async function getLatestTranslationJob(sessionId: string) {
  const db = await requireDb();
  const row = (
    await db
      .select()
      .from(translationJobs)
      .where(eq(translationJobs.sessionId, sessionId))
      .orderBy(desc(translationJobs.createdAt))
      .limit(1)
  )[0];
  return row ?? null;
}
```

- [ ] **Step 4: Replace the `evaluation` router in `server/routers.ts`**

```ts
  translation: router({
    request: publicProcedure
      .input(z.object({ sessionId: z.string().min(1).max(64), frameCount: z.number().int().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const signer = await signerFromContext(ctx);
        if (!signer) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in before translating." });
        const session = await getCaptureSession(input.sessionId);
        if (!session || session.signerId !== signer.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "This session belongs to another signer." });
        }
        return createTranslationJob(input);
      }),
    next: publicProcedure
      .input(z.object({ sessionId: z.string().min(1).max(64) }))
      .query(async ({ input }) => getLatestTranslationJob(input.sessionId)),
  }),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/translation-service.test.ts && pnpm check`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add server/translation-service.ts server/routers.ts tests/translation-service.test.ts
git commit -m "feat: pluggable sign translator with fixture implementation and job lifecycle"
```

---

## Task 9: Feedback and Likert persistence

**Files:**
- Create: `server/feedback-service.ts`
- Modify: `server/routers.ts` (replace the `feedback` router)
- Test: `tests/feedback-service.test.ts`

**Interfaces:**
- Consumes: `feedbackVoteValues` from `shared/workflow`; `feedbackVotes`, `qualitativeRatings` from `drizzle/schema`.
- Produces: `LIKERT_MIN = 1`, `LIKERT_MAX = 5`, `normalizeFeedbackNote(note)`, `isValidLikert(value)`, `recordFeedbackVote(input)`, `recordQualitativeRating(input)`; router `feedback.submit`, `feedback.rate`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/feedback-service.test.ts
import { describe, expect, it } from "vitest";

import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";
import {
  LIKERT_MAX,
  LIKERT_MIN,
  isValidLikert,
  normalizeFeedbackNote,
} from "../server/feedback-service";

function anonymousContext(): TrpcContext {
  return {
    user: null,
    req: { headers: {}, protocol: "http" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("feedback note normalization", () => {
  it("trims a note and keeps its content", () => {
    expect(normalizeFeedbackNote("  The final phrase is missing.  ")).toBe(
      "The final phrase is missing.",
    );
  });

  it("treats an empty or whitespace note as absent", () => {
    expect(normalizeFeedbackNote("   ")).toBeNull();
    expect(normalizeFeedbackNote(undefined)).toBeNull();
  });

  it("truncates a note to the stored column width", () => {
    expect(normalizeFeedbackNote("x".repeat(400))).toHaveLength(280);
  });
});

describe("Likert validation", () => {
  it("accepts the full 1 to 5 range", () => {
    expect(LIKERT_MIN).toBe(1);
    expect(LIKERT_MAX).toBe(5);
    for (let v = LIKERT_MIN; v <= LIKERT_MAX; v += 1) expect(isValidLikert(v)).toBe(true);
  });

  it("rejects out-of-range and non-integer scores", () => {
    expect(isValidLikert(0)).toBe(false);
    expect(isValidLikert(6)).toBe(false);
    expect(isValidLikert(3.5)).toBe(false);
  });
});

describe("feedback router", () => {
  it("rejects a vote outside the directional vocabulary", async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(
      // @ts-expect-error deliberately invalid vote
      caller.feedback.submit({ translationJobId: "j-1", vote: "maybe" }),
    ).rejects.toThrow();
  });

  it("rejects a Likert score outside 1 to 5", async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(
      caller.feedback.rate({
        translationJobId: "j-1",
        naturalness: 7,
        grammaticality: 3,
        usefulness: 3,
      }),
    ).rejects.toThrow();
  });

  it("surfaces a clean error when the database is unavailable", async () => {
    const caller = appRouter.createCaller(anonymousContext());
    await expect(
      caller.feedback.submit({ translationJobId: "j-1", vote: "accurate" }),
    ).rejects.toThrow(/could not be recorded/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/feedback-service.test.ts`
Expected: FAIL — `Failed to resolve import "../server/feedback-service"`

- [ ] **Step 3: Write `server/feedback-service.ts`**

```ts
import { feedbackVotes, qualitativeRatings } from "../drizzle/schema";
import { getDb } from "./db";
import type { FeedbackVote } from "../shared/workflow";

export const LIKERT_MIN = 1;
export const LIKERT_MAX = 5;
const NOTE_MAX_LENGTH = 280;

export function normalizeFeedbackNote(note: string | undefined | null): string | null {
  const trimmed = note?.trim() ?? "";
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, NOTE_MAX_LENGTH);
}

export function isValidLikert(value: number): boolean {
  return Number.isInteger(value) && value >= LIKERT_MIN && value <= LIKERT_MAX;
}

async function requireDb() {
  const db = await getDb();
  // Feedback is research data. Dropping it silently would corrupt the study, so
  // the failure is surfaced to the participant for retry rather than swallowed.
  if (!db) throw new Error("Feedback could not be recorded. Please try again.");
  return db;
}

export async function recordFeedbackVote(input: {
  translationJobId: string;
  signerId: number | null;
  vote: FeedbackVote;
  note?: string;
}) {
  const db = await requireDb();
  const id = crypto.randomUUID();
  const note = normalizeFeedbackNote(input.note);

  await db
    .insert(feedbackVotes)
    .values({ id, translationJobId: input.translationJobId, signerId: input.signerId, vote: input.vote, note })
    .onDuplicateKeyUpdate({ set: { vote: input.vote, note } });

  return { id, status: "recorded" as const, translationJobId: input.translationJobId, vote: input.vote, note };
}

export async function recordQualitativeRating(input: {
  translationJobId: string;
  signerId: number | null;
  naturalness: number;
  grammaticality: number;
  usefulness: number;
}) {
  for (const [name, value] of [
    ["naturalness", input.naturalness],
    ["grammaticality", input.grammaticality],
    ["usefulness", input.usefulness],
  ] as const) {
    if (!isValidLikert(value)) {
      throw new Error(`${name} must be an integer between ${LIKERT_MIN} and ${LIKERT_MAX}.`);
    }
  }

  const db = await requireDb();
  const id = crypto.randomUUID();
  const values = {
    naturalness: input.naturalness,
    grammaticality: input.grammaticality,
    usefulness: input.usefulness,
  };

  await db
    .insert(qualitativeRatings)
    .values({ id, translationJobId: input.translationJobId, signerId: input.signerId, ...values })
    .onDuplicateKeyUpdate({ set: values });

  return { id, status: "recorded" as const, ...values };
}
```

- [ ] **Step 4: Replace the `feedback` router in `server/routers.ts`**

```ts
  feedback: router({
    submit: publicProcedure
      .input(
        z.object({
          translationJobId: z.string().min(1).max(64),
          vote: z.enum(feedbackVoteValues),
          note: z.string().trim().max(280).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const signer = await signerFromContext(ctx);
        try {
          return await recordFeedbackVote({ ...input, signerId: signer?.id ?? null });
        } catch (error) {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: error instanceof Error ? error.message : "Feedback could not be recorded.",
          });
        }
      }),
    rate: publicProcedure
      .input(
        z.object({
          translationJobId: z.string().min(1).max(64),
          naturalness: z.number().int().min(1).max(5),
          grammaticality: z.number().int().min(1).max(5),
          usefulness: z.number().int().min(1).max(5),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const signer = await signerFromContext(ctx);
        try {
          return await recordQualitativeRating({ ...input, signerId: signer?.id ?? null });
        } catch (error) {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: error instanceof Error ? error.message : "Ratings could not be recorded.",
          });
        }
      }),
  }),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/feedback-service.test.ts && pnpm check`
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add server/feedback-service.ts server/routers.ts tests/feedback-service.test.ts
git commit -m "feat: persist feedback votes and Likert ratings"
```

---

## Task 10: Signer-independent stratified splits and export

**Files:**
- Create: `server/split-service.ts`
- Create: `server/export-service.ts`
- Test: `tests/split-service.test.ts`

**Interfaces:**
- Consumes: `splitAssignments`, `captureSessions`, `landmarkSequences`, `nmmTags`, `consentRecords` from `drizzle/schema`; `corpusSeed`; `isConsentCurrent`.
- Produces: `SPLIT_RATIOS`, `assignSplits(signerIds, seed)`, `hashToUnit(value)`; `buildTrainingJsonl(rows)`, `buildElanTiers(session)`, `exportManifest(input)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/split-service.test.ts
import { describe, expect, it } from "vitest";

import { SPLIT_RATIOS, assignSplits, hashToUnit } from "../server/split-service";
import { buildElanTiers, buildTrainingJsonl, exportManifest } from "../server/export-service";

const signers = Array.from({ length: 35 }, (_, i) => i + 1);

describe("split ratios", () => {
  it("uses the proposal's 70 / 15 / 15 partition", () => {
    expect(SPLIT_RATIOS).toEqual({ train: 0.7, validation: 0.15, test: 0.15 });
  });
});

describe("signer-independent assignment", () => {
  it("places every signer in exactly one split", () => {
    const assigned = assignSplits(signers, "study-seed-1");
    expect(assigned).toHaveLength(signers.length);
    expect(new Set(assigned.map((a) => a.signerId)).size).toBe(signers.length);
  });

  it("approximates the target ratios", () => {
    const assigned = assignSplits(signers, "study-seed-1");
    const count = (split: string) => assigned.filter((a) => a.split === split).length;
    expect(count("train")).toBeGreaterThanOrEqual(22);
    expect(count("train")).toBeLessThanOrEqual(26);
    expect(count("validation")).toBeGreaterThanOrEqual(4);
    expect(count("test")).toBeGreaterThanOrEqual(4);
  });

  it("is reproducible for the same seed and unstable across seeds", () => {
    expect(assignSplits(signers, "seed-a")).toEqual(assignSplits(signers, "seed-a"));
    expect(assignSplits(signers, "seed-a")).not.toEqual(assignSplits(signers, "seed-b"));
  });

  it("records the seed on every assignment so the partition stays traceable", () => {
    for (const a of assignSplits(signers, "study-seed-1")) expect(a.seed).toBe("study-seed-1");
  });

  it("maps a value into the unit interval deterministically", () => {
    const u = hashToUnit("signer-7");
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThan(1);
    expect(hashToUnit("signer-7")).toBe(u);
  });
});

describe("exports", () => {
  const row = {
    sessionId: "s-1",
    signerId: 7,
    promptId: "B-02",
    category: "interrogative" as const,
    textEnglish: "Where is the hospital?",
    storageKey: "sequences/signer-7/s-1.json.gz",
    extractorId: "fixture@1",
    frameCount: 120,
    durationMs: 4000,
    split: "train" as const,
    nmmTags: [
      {
        type: "eyebrow_raise" as const,
        startFrame: 10,
        endFrame: 40,
        confidence: 0.8,
        ruleVersion: "baseline-v1",
      },
    ],
  };

  it("emits one JSON object per line, carrying provenance", () => {
    const lines = buildTrainingJsonl([row]).trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.text).toBe("Where is the hospital?");
    expect(parsed.category).toBe("interrogative");
    expect(parsed.extractorId).toBe("fixture@1");
    expect(parsed.nmm[0].type).toBe("eyebrow_raise");
  });

  it("never leaks a video reference into an export", () => {
    expect(buildTrainingJsonl([row])).not.toMatch(/\.mp4|video/i);
  });

  it("builds ELAN tiers with temporal boundaries in milliseconds", () => {
    const tiers = buildElanTiers({ ...row, achievedFps: 30 });
    const sentence = tiers.find((t) => t.tier === "sentence")!;
    expect(sentence.annotations[0]).toEqual({ start: 0, end: 4000, value: "Where is the hospital?" });
    const nmm = tiers.find((t) => t.tier === "nmm")!;
    expect(nmm.annotations[0]).toEqual({ start: 333, end: 1333, value: "eyebrow_raise" });
  });

  it("stamps a manifest with the seed, versions, and consent state", () => {
    const manifest = exportManifest({
      seed: "study-seed-1",
      ruleVersion: "baseline-v1",
      extractorId: "fixture@1",
      consentVersion: "v1",
      rowCount: 1,
      generatedAt: "2026-08-22T00:00:00.000Z",
    });
    expect(manifest).toMatchObject({
      seed: "study-seed-1",
      ruleVersion: "baseline-v1",
      consentVersion: "v1",
      rowCount: 1,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/split-service.test.ts`
Expected: FAIL — `Failed to resolve import "../server/split-service"`

- [ ] **Step 3: Write `server/split-service.ts`**

```ts
import { createHash } from "node:crypto";

import { splitAssignments } from "../drizzle/schema";
import { getDb } from "./db";

export const SPLIT_RATIOS = { train: 0.7, validation: 0.15, test: 0.15 } as const;
export type Split = keyof typeof SPLIT_RATIOS;

/** Deterministic map from any string into [0, 1). */
export function hashToUnit(value: string): number {
  const digest = createHash("sha256").update(value).digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000;
}

export type SplitAssignmentResult = { signerId: number; split: Split; seed: string };

/**
 * Splits by signer, not by sample, so the model is always evaluated on entirely
 * unseen individuals. Seeded and recorded so the partition is reproducible.
 * See design.md §12.3.
 */
export function assignSplits(signerIds: number[], seed: string): SplitAssignmentResult[] {
  const ordered = [...signerIds].sort(
    (a, b) => hashToUnit(`${seed}:${a}`) - hashToUnit(`${seed}:${b}`),
  );

  const total = ordered.length;
  const trainCount = Math.round(total * SPLIT_RATIOS.train);
  const validationCount = Math.round(total * SPLIT_RATIOS.validation);

  return ordered.map((signerId, index) => ({
    signerId,
    split:
      index < trainCount
        ? "train"
        : index < trainCount + validationCount
          ? "validation"
          : "test",
    seed,
  }));
}

export async function persistSplitAssignments(assignments: SplitAssignmentResult[]) {
  const db = await getDb();
  if (!db) throw new Error("The split database is not configured.");
  for (const assignment of assignments) {
    await db
      .insert(splitAssignments)
      .values(assignment)
      .onDuplicateKeyUpdate({ set: { split: assignment.split, seed: assignment.seed } });
  }
  return { assigned: assignments.length };
}
```

- [ ] **Step 4: Write `server/export-service.ts`**

```ts
import type { CorpusCategory } from "../shared/corpus";
import type { NmmType } from "../shared/workflow";
import type { Split } from "./split-service";

export type ExportRow = {
  sessionId: string;
  signerId: number;
  promptId: string;
  category: CorpusCategory;
  textEnglish: string;
  storageKey: string;
  extractorId: string;
  frameCount: number;
  durationMs: number;
  split: Split;
  nmmTags: {
    type: NmmType;
    startFrame: number;
    endFrame: number;
    confidence: number;
    ruleVersion: string;
  }[];
};

/**
 * One JSON object per line. Carries the sequence reference and its provenance —
 * never a media file. See design.md §12.4.
 */
export function buildTrainingJsonl(rows: ExportRow[]): string {
  return rows
    .map((row) =>
      JSON.stringify({
        sessionId: row.sessionId,
        signerId: row.signerId,
        split: row.split,
        promptId: row.promptId,
        category: row.category,
        text: row.textEnglish,
        sequence: row.storageKey,
        extractorId: row.extractorId,
        frameCount: row.frameCount,
        durationMs: row.durationMs,
        nmm: row.nmmTags.map((tag) => ({
          type: tag.type,
          startFrame: tag.startFrame,
          endFrame: tag.endFrame,
          confidence: tag.confidence,
          ruleVersion: tag.ruleVersion,
        })),
      }),
    )
    .join("\n")
    .concat("\n");
}

export type ElanTier = {
  tier: "sentence" | "nmm";
  annotations: { start: number; end: number; value: string }[];
};

/**
 * Sentence-level tiers with millisecond boundaries, so the linguistic team can
 * inspect and correct heuristic output in ELAN.
 */
export function buildElanTiers(row: ExportRow & { achievedFps: number }): ElanTier[] {
  const msPerFrame = row.achievedFps > 0 ? 1000 / row.achievedFps : 0;
  return [
    {
      tier: "sentence",
      annotations: [{ start: 0, end: row.durationMs, value: row.textEnglish }],
    },
    {
      tier: "nmm",
      annotations: row.nmmTags.map((tag) => ({
        start: Math.round(tag.startFrame * msPerFrame),
        end: Math.round(tag.endFrame * msPerFrame),
        value: tag.type,
      })),
    },
  ];
}

export type ExportManifest = {
  seed: string;
  ruleVersion: string;
  extractorId: string;
  consentVersion: string;
  rowCount: number;
  generatedAt: string;
};

/** Provenance travels with the data; without it a result is unreproducible. */
export function exportManifest(input: ExportManifest): ExportManifest {
  return { ...input };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/split-service.test.ts && pnpm check`
Expected: PASS (10 tests)

- [ ] **Step 6: Commit**

```bash
git add server/split-service.ts server/export-service.ts tests/split-service.test.ts
git commit -m "feat: signer-independent stratified splits and training/ELAN exports"
```

---

## Task 11a: Mobile screens on the fixture extractor

**Not blocked by the native build.** Every screen here runs against `createFixtureExtractor`, so the whole participant journey is exercisable before the native extractor exists. Task 11b swaps in the native extractor behind the same interface without touching these screens.

**Files:**
- Create: `lib/format-elapsed.ts`, `lib/upload-sequence.ts`, `lib/capture-buffer.ts`
- Create: `app/consent.tsx`, `app/prompt-session.tsx`, `app/live-translate.tsx`, `app/(tabs)/progress.tsx`
- Modify: `app/capture.tsx`, `app/capture-review.tsx`, `app/feedback.tsx`, `app/(tabs)/settings.tsx`, `app/(tabs)/_layout.tsx`
- Delete: `app/evaluation.tsx`, `app/capture-submitted.tsx`
- Test: `tests/format-elapsed.test.ts`

**Interfaces:**
- Consumes: `LandmarkExtractor`, `LandmarkFrame`, `LandmarkSequencePayload` from `shared/landmarks`; `createFixtureExtractor` from Task 2; the `capture`, `consent`, `translation`, and `feedback` routers.
- Produces: `formatElapsed(ms): string`, `uploadSequence(payload): Promise<UploadResult>`, `setCaptureBuffer(frames)` / `takeCaptureBuffer(): LandmarkFrame[]`, `getExtractor(): LandmarkExtractor`.

- [ ] **Step 1: Write the failing test for the elapsed timer**

```ts
// tests/format-elapsed.test.ts
import { describe, expect, it } from "vitest";

import { formatElapsed } from "../lib/format-elapsed";

describe("elapsed timer formatting", () => {
  it("formats sub-minute durations with a leading zero on seconds", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(7_000)).toBe("0:07");
    expect(formatElapsed(59_400)).toBe("0:59");
  });

  it("rolls over into minutes", () => {
    expect(formatElapsed(60_000)).toBe("1:00");
    expect(formatElapsed(65_000)).toBe("1:05");
    expect(formatElapsed(605_000)).toBe("10:05");
  });

  it("clamps negative input to zero", () => {
    expect(formatElapsed(-500)).toBe("0:00");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/format-elapsed.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/format-elapsed"`

- [ ] **Step 3: Write `lib/format-elapsed.ts`**

```ts
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/format-elapsed.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Add the extractor selector**

```ts
// lib/extractors/index.ts
import { Platform } from "react-native";

import { createFixtureExtractor } from "./fixture-extractor";
import type { LandmarkExtractor } from "@/shared/landmarks";
import { demoSequence } from "./demo-sequence";

/**
 * Task 11b replaces the native branch with `createMediaPipeExtractor()`.
 * Nothing above this function changes when it does.
 */
export function getExtractor(): LandmarkExtractor {
  if (Platform.OS === "web") return createFixtureExtractor(demoSequence);
  return createFixtureExtractor(demoSequence);
}
```

`lib/extractors/demo-sequence.ts` exports a short, checked-in `LandmarkFrame[]` built with the same generator as `tests/fixtures/landmark-frames.ts`, so the screens have something to render before a camera exists.

- [ ] **Step 6: Add the in-memory capture buffer**

Frames must never travel as a route param — a serialized 400-frame payload in a URL is both broken and a privacy smell. Keep them in a module ref that the review screen drains exactly once:

```ts
// lib/capture-buffer.ts
import type { LandmarkFrame } from "@/shared/landmarks";

let buffer: LandmarkFrame[] = [];

export function setCaptureBuffer(frames: LandmarkFrame[]) {
  buffer = frames;
}

/** Drains the buffer. Calling twice returns an empty array by design. */
export function takeCaptureBuffer(): LandmarkFrame[] {
  const frames = buffer;
  buffer = [];
  return frames;
}

export function clearCaptureBuffer() {
  buffer = [];
}
```

- [ ] **Step 7: Rewrite `app/capture.tsx`**

Remove `useMicrophonePermissions`, `recordAsync`, `stopRecording`, and every reference to `recordingUri`. The screen now:

- requests **camera permission only**, with the copy `"SignBridge reads motion points from the camera. No video is recorded or saved."` on Mist Blue `#E6FFFB`;
- shows the prompt sentence and its category badge above the framing guide;
- runs `getExtractor()`, buffering frames via `setCaptureBuffer`;
- shows the elapsed timer via `formatElapsed`, and a live "reading motion points" indicator;
- on **Stop**, navigates to `/capture-review` with the `sessionId` only.

- [ ] **Step 8: Rewrite `app/capture-review.tsx`**

Replace the video placeholder with the sequence summary: frame count, duration via `formatElapsed`, achieved fps, per-stream coverage bars. The privacy line becomes `"Only anonymous motion points are sent. No video exists on this device."` Submit drains the buffer and POSTs it via `uploadSequence`.

- [ ] **Step 9: Add `lib/upload-sequence.ts`**

```ts
import { getApiBaseUrl } from "@/constants/oauth";
import { getSignerSessionToken } from "@/lib/signer-session";
import type { LandmarkSequencePayload } from "@/shared/landmarks";

export type UploadResult = { sessionId: string; status: string; nmmTags: number };

export async function uploadSequence(payload: LandmarkSequencePayload): Promise<UploadResult> {
  const token = await getSignerSessionToken();
  const response = await fetch(`${getApiBaseUrl()}/api/sessions/${payload.sessionId}/sequence`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
    credentials: "include",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "The sequence could not be submitted.");
  }
  return (await response.json()) as UploadResult;
}
```

- [ ] **Step 10: Add the new screens**

- `app/consent.tsx` — study purpose, what is and is not collected (mirroring §3.2's four guarantees), withdrawal rights, and a single **I agree to participate** action calling `consent.grant`. Blocks navigation to capture until `consent.status` reports `granted`.
- `app/prompt-session.tsx` — `capture.nextPrompt` result: sentence on a Mist Blue card, category badge, `n of 100` progress, and three actions — **Start signing**, **Skip this sentence** (with a reason sheet), **Redo previous**.
- `app/live-translate.tsx` — replaces `app/evaluation.tsx`. Camera + `getExtractor()`, then `translation.request`, showing the English on Warm Sand `#FFF7ED` with the disclaimer `"This is an automated response. Please judge it against your signing."`
- `app/(tabs)/progress.tsx` — `capture.progress`: per-category completion bars, totals, and skipped count. Register it in `app/(tabs)/_layout.tsx` with `IconSymbol name="chart.bar.fill"`.

Delete `app/evaluation.tsx` and `app/capture-submitted.tsx` (the confirmation now lives inline on Prompt Session).

- [ ] **Step 11: Extend `app/feedback.tsx` with the Likert scales**

Keep the two verdict cards. Below them add three 1–5 scales — Naturalness, Grammaticality, Usefulness — each a row of five 48-point targets labelled at both ends. Submit calls `feedback.submit` then `feedback.rate`; the rating call is skipped if the participant leaves the scales untouched, so the directional vote is never blocked by them.

- [ ] **Step 12: Update `app/(tabs)/settings.tsx`**

Show the resolved `getApiBaseUrl()`, `Constants.expoConfig?.version`, the extractor id from `getExtractor().id`, the rule version, and consent status with a **Withdraw consent** action. Replace the privacy card copy with §3.2's four guarantees.

- [ ] **Step 13: Verify no video path survives**

```bash
grep -rn "recordAsync\|recordingUri\|video/mp4\|putSignerRecording" app lib server shared tests
```

Expected: no matches outside a comment describing what the system does not do.

- [ ] **Step 14: Run the full verification**

```bash
pnpm vitest run && pnpm check && pnpm lint
```

Expected: all tests pass, no TypeScript errors, no lint errors.

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "feat: prompt-driven capture screens, live translate, Likert feedback"
```

---

## Task 11b: Native MediaPipe extractor

**Blocked** only by the absence of a native toolchain (Xcode / Android SDK). The dependency conflict noted earlier does not apply to Vision Camera v5. Everything else in this plan ships without this task.

**Files:**
- Create: `lib/extractors/mediapipe-extractor.ts`
- Modify: `lib/extractors/index.ts`, `app.config.ts`, `package.json`

**Interfaces:**
- Consumes: `LandmarkExtractor`, `LandmarkFrame`, stream-count constants from `shared/landmarks`.
- Produces: `createMediaPipeExtractor(): LandmarkExtractor` — same interface as the fixture extractor, so no screen changes.

- [ ] **Step 1: Install the native dependencies and prebuild**

```bash
npx expo install react-native-vision-camera
pnpm add react-native-nitro-modules react-native-nitro-image
npx expo prebuild --clean
```

Add the Vision Camera plugin and the camera permission strings to `app.config.ts`'s `plugins` array:

```ts
    [
      "react-native-vision-camera",
      {
        cameraPermissionText:
          "SignBridge needs the camera to read hand, face, and body motion points. No video is saved.",
        enableMicrophonePermission: false,
      },
    ],
```

Note: `enableMicrophonePermission: false` is deliberate. The proposal's pipeline has no audio channel, and requesting a permission the system never uses weakens the privacy claim.

- [ ] **Step 2: Write `lib/extractors/mediapipe-extractor.ts`**

```ts
import {
  FACE_LANDMARK_COUNT,
  HAND_LANDMARK_COUNT,
  POSE_LANDMARK_COUNT,
  type LandmarkExtractor,
  type LandmarkFrame,
  type LandmarkSequenceSummary,
} from "@/shared/landmarks";

/**
 * Vision Camera frame processor → MediaPipe Tasks.
 *
 * The frame processor receives each camera frame, runs HandLandmarker,
 * FaceLandmarker (iris refinement off, 468 points), and PoseLandmarker, then
 * releases the frame. No frame is ever copied to disk or off the device —
 * see design.md §3.1.
 */
export function createMediaPipeExtractor(): LandmarkExtractor {
  let listener: ((frame: LandmarkFrame) => void) | null = null;
  let startedAt = 0;
  let frameCount = 0;
  let lastT = 0;
  const detected = { leftHand: 0, rightHand: 0, face: 0, pose: 0 };

  const onNativeFrame = (native: {
    timestampMs: number;
    leftHand: number[][] | null;
    rightHand: number[][] | null;
    face: number[][] | null;
    pose: number[][] | null;
  }) => {
    const toLandmarks = (raw: number[][] | null, expected: number) =>
      raw && raw.length === expected
        ? raw.map(([x, y, z, visibility]) => ({ x, y, z, visibility }))
        : null;

    const frame: LandmarkFrame = {
      t: native.timestampMs - startedAt,
      leftHand: toLandmarks(native.leftHand, HAND_LANDMARK_COUNT),
      rightHand: toLandmarks(native.rightHand, HAND_LANDMARK_COUNT),
      face: toLandmarks(native.face, FACE_LANDMARK_COUNT),
      pose: toLandmarks(native.pose, POSE_LANDMARK_COUNT),
    };

    frameCount += 1;
    lastT = frame.t;
    if (frame.leftHand) detected.leftHand += 1;
    if (frame.rightHand) detected.rightHand += 1;
    if (frame.face) detected.face += 1;
    if (frame.pose) detected.pose += 1;

    listener?.(frame);
  };

  return {
    id: "mediapipe-tasks@0.10",

    async start({ targetFps }) {
      startedAt = Date.now();
      frameCount = 0;
      lastT = 0;
      detected.leftHand = detected.rightHand = detected.face = detected.pose = 0;
      await nativeExtractor.start({ targetFps, onFrame: onNativeFrame });
    },

    subscribe(onFrame) {
      listener = onFrame;
      return () => {
        listener = null;
      };
    },

    async stop(): Promise<LandmarkSequenceSummary> {
      await nativeExtractor.stop();
      listener = null;
      const ratio = (n: number) => (frameCount === 0 ? 0 : n / frameCount);
      return {
        frameCount,
        durationMs: lastT,
        achievedFps: lastT === 0 ? 0 : (frameCount / lastT) * 1000,
        coverage: {
          leftHand: ratio(detected.leftHand),
          rightHand: ratio(detected.rightHand),
          face: ratio(detected.face),
          pose: ratio(detected.pose),
        },
      };
    },
  };
}
```

The `nativeExtractor` binding is the frame-processor plugin registered by the config plugin. Wire it in the same file with the Vision Camera `useFrameProcessor` hook in `app/capture.tsx`; keep the shape above so the interface contract does not change.

- [ ] **Step 3: Swap the native branch in `lib/extractors/index.ts`**

```ts
import { Platform } from "react-native";

import { createFixtureExtractor } from "./fixture-extractor";
import { createMediaPipeExtractor } from "./mediapipe-extractor";
import { demoSequence } from "./demo-sequence";
import type { LandmarkExtractor } from "@/shared/landmarks";

export function getExtractor(): LandmarkExtractor {
  if (Platform.OS === "web") return createFixtureExtractor(demoSequence);
  return createMediaPipeExtractor();
}
```

No screen changes: Task 11a consumes `getExtractor()` and the `LandmarkExtractor` interface, both unchanged.

- [ ] **Step 4: Verify stream sizes against a real device**

Run the app on a physical device, sign for five seconds on any prompt, and read the Capture Review summary. Expected: `face` coverage near 1.0, `pose` coverage near 1.0, at least one hand above 0.5, and an achieved fps of 20 or better. A face stream that reports anything other than 468 points means iris refinement is on — disable it in the plugin config.

- [ ] **Step 5: Confirm no frame ever reaches disk**

```bash
grep -rn "recordAsync\|writeAsStringAsync\|cacheDirectory\|documentDirectory" app lib
```

Expected: no matches. Then, with the app running on device, confirm the app's Documents and Caches directories contain no media file after a capture.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: native MediaPipe Tasks landmark extractor behind the extractor interface"
```

---

## Task 11c: Deployment configuration and documentation

**Files:**
- Modify: `docker-compose.yml`, `docker-compose.hetzner.yml`, `DEVELOPMENT.md`

**Interfaces:**
- Consumes: `assertStorageConfig` and the bucket naming from Task 7; `CURRENT_CONSENT_VERSION` from Task 6; `SPLIT_RATIOS` from Task 10.
- Produces: no code — the environment contract and the developer-facing docs.

- [ ] **Step 1: Retarget the storage variables**

In both `docker-compose.yml` and `docker-compose.hetzner.yml`, change the `OBJECT_STORAGE_BUCKET` default from `signbridge-recordings` to `signbridge-sequences`, and change the `minio-init` service's bucket default to match. Then add to the `backend` service environment in both files:

```yaml
      CALIBRATION_BUFFER_ENABLED: ${CALIBRATION_BUFFER_ENABLED:-false}
      CONSENT_VERSION: ${CONSENT_VERSION:-v1}
      STUDY_SPLIT_SEED: ${STUDY_SPLIT_SEED:-signbridge-study-v1}
```

In `docker-compose.hetzner.yml` only, make the calibration flag explicit rather than defaulted, so enabling it in production is a deliberate act:

```yaml
      CALIBRATION_BUFFER_ENABLED: ${CALIBRATION_BUFFER_ENABLED:-false}
      CALIBRATION_BUFFER_RETENTION_HOURS: ${CALIBRATION_BUFFER_RETENTION_HOURS:-24}
```

- [ ] **Step 2: Verify the compose files still parse**

```bash
docker compose -f docker-compose.yml config >/dev/null && echo OK
docker compose -f docker-compose.hetzner.yml config >/dev/null 2>&1 || echo "expected: fails on required vars"
```

Expected: the local file validates; the Hetzner overlay reports its `:?` required variables, which is correct behaviour.

- [ ] **Step 3: Update `DEVELOPMENT.md`**

Replace every "video recording" reference with "landmark sequence"; the table row currently reading `**Video recording objects** | MinIO at http://localhost:9000 | Private Hetzner Object Storage bucket` becomes `**Landmark sequence objects**`. Then add three sections:

1. **Build model** — the app requires `npx expo prebuild` and a custom development client. Expo Go is no longer supported, because MediaPipe runs as a native frame processor. Include the `pnpm android` / `pnpm ios` commands and note that a first build takes 10–20 minutes.
2. **New environment variables** — a table for `CALIBRATION_BUFFER_ENABLED`, `CALIBRATION_BUFFER_RETENTION_HOURS`, `CONSENT_VERSION`, and `STUDY_SPLIT_SEED`, each with its default and what it controls.
3. **Privacy posture** — a short section stating that the participant path never writes or transmits video, that object storage holds gzipped landmark JSON, and that the calibration buffer is the single flag-gated exception with its own retention rule. Link to `design.md` §3.

- [ ] **Step 4: Reconcile `todo.md`**

Tick every item this plan completed. Leave the native-toolchain item open if Task 11b has not run.

- [ ] **Step 5: Full verification**

```bash
pnpm vitest run && pnpm check && pnpm lint
grep -rn "recordAsync\|recordingUri\|video/mp4\|putSignerRecording\|signbridge-recordings" app lib server shared tests docker-compose*.yml DEVELOPMENT.md
```

Expected: all green, and the grep returns no matches outside explicit "what we do not do" statements.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: landmark-sequence deployment contract and prebuild developer guide"
```

---

## Self-Review Notes

**Spec coverage.** Every row of `design.md` §2 maps to a task: privacy pipeline → Tasks 2, 7, 11; NMM rules → Task 3; corpus → Task 4; schema → Task 5; consent → Task 6; sessions and prompts → Task 7; translation → Task 8; feedback and Likert → Task 9; splits and export → Task 10; screens, native build, and deployment → Task 11.

**Execution waves.** Tasks 1–4 are pure logic (no database, no camera, no native build) and Tasks 2/3/4 depend only on Task 1, so they parallelise. Tasks 5–7 are persistence; Task 5 gates 6–10. Tasks 8/9/10 depend only on Task 5 and parallelise. Task 11a runs the whole participant journey on the fixture extractor, so it ships before the native blocker is resolved; 11b is the only task that requires a native toolchain; 11c is documentation and deployment config.

**Corpus fidelity.** Task 4 transcribes all 100 Appendix A sentences. The single alteration is the missing leading "I" on `" need help with this form."`, corrected in the seed and noted in a comment beside it. The category-count validation is a regression guard, not a blocker.

**Type consistency.** `LandmarkFrame`, `LandmarkExtractor`, `SignerBaseline`, `NmmDetection`, `SeedPrompt`, `ExportRow`, and `SignTranslator` are each defined once and consumed by name. Confidence crosses the DB boundary as `confidenceBp` (basis points) in every table that stores it, and as a 0–1 float everywhere else.
