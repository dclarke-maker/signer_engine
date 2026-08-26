# Why the device stopped deciding when a sentence ends

**Measured 26 Aug 2026.** One block of ten sentences, Android emulator against
the local stack, one non-Deaf participant producing hand movement rather than
NSL. Landmarks read back from object storage and analysed offline.

## Result

Recording ended correctly on **3 of 10** sentences. Seven ran to the 20-second
cap.

| Prompt | Frames | Duration | Ended on |
|---|---|---|---|
| B-01 | 144 | 5.7 s | detected rest |
| C-01 | 524 | 20.0 s | **time limit** |
| D-01 | 240 | 9.4 s | detected rest |
| E-01 | 521 | 20.0 s | **time limit** |
| A-01 | 520 | 20.0 s | **time limit** |
| B-02 | 237 | 8.9 s | detected rest |
| C-02 | 515 | 20.0 s | **time limit** |
| D-02 | 512 | 20.0 s | **time limit** |
| E-02 | 520 | 20.0 s | **time limit** |
| A-02 | 509 | 20.0 s | **time limit** |

## Why

**The strong signal never occurred.** Hands were present in **97–99%** of
frames. The detector treats hands leaving the frame as the reliable end-of-
sentence cue; the participant rested with hands clasped at the waist, in shot.
Every decision therefore fell through to the speed threshold, which was only
ever meant to be the fallback.

**Resting speed and the threshold are the same number.** Across the final four
seconds, mean per-landmark hand speed had a median of **0.128** frame-heights
per second. `REST_MOTION_THRESHOLD` was **0.12**. Resting hands sit on the
threshold and cross it constantly. In the capped clip the longest continuous
run below it was **1.2 s**, against the 1.5 s hold required — a near miss
decided by landmark jitter, which is exactly the coin flip the results show.

**No threshold separates rest from slow signing.** Simulated against the two
recovered sequences:

| Configuration | C-01 (ran to 20 s) | B-01 (ended 5.7 s) |
|---|---|---|
| threshold 0.12 | never fires | 5.7 s |
| threshold 0.20 | 13.5 s | 5.7 s |
| threshold 0.25 | 10.2 s | 5.5 s |
| threshold 0.30 | 7.9 s | 5.5 s |
| 5-frame median, 0.20 | **2.0 s** | 5.2 s |

Smoothing to suppress jitter spikes fires at **2.0 s** — the configured minimum,
i.e. the earliest moment it legally could. That is outright truncation. And at
0.30 the capped clip contains a **2.4 s** stretch of actual signing the detector
reads as still. Slow signing and resting hands occupy the same speed range.

**A positional signal did not help either.** Lowest wrist height, in
shoulder-to-hip units where 1.0 is the hip line, had a median of **0.57** and
never exceeded 0.8. Clasping the hands at the midriff is a natural rest posture
and it sits squarely inside signing space.

## What changed

The fault is structural, not a badly chosen constant. Ending a sentence on the
device is **irreversible and made from a single frame of evidence**. Every
landmark is stored, so the same judgement made afterwards costs nothing when it
is wrong and can be recomputed against real signing without re-collecting.

- The device now records a **fixed 12-second window** (`RECORDING_WINDOW_MS`),
  showing the signer the time remaining. A manual tap still ends it early.
- Rest detection moved to `shared/rest-trim.ts` as `proposeTrim`, which reports
  where a sequence *could* be cut and **returns `found: false` rather than
  guessing** when no confident resting point exists — the common case here.
  Nothing is removed on the strength of these numbers.

## Limits of this measurement

The participant was **not producing NSL**. Real signing works a much larger
space — up to the face, out to the sides — so the separation between signing
and rest may be substantially wider for a Deaf signer, and these thresholds may
be pessimistic. This data cannot settle that.

**Calibrate at the NDFN pilot**, before the 30–40 signer collection: capture
10–20 genuinely signed sentences, re-run this analysis, and fit
`REST_MOTION_THRESHOLD` against them. Because trimming is now non-destructive
and offline, that can be done — and redone — without asking anyone to sign
anything twice.
