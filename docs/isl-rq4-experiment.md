# RQ4: does ISL pre-training help NSL translation?

Design only. Nothing here has been run, and nothing should be until the
preprocessing side is verified and a corpus size has been chosen from measured
numbers.

> **RQ4.** Can cross-lingual transfer learning from Indian Sign Language
> effectively initialize a model for the low-resource NSL domain?

Phase 3 of the proposal: *"ELAN annotation and pre-training with ISL data so that
the model can learn transferable sign-language representations."*

---

## 1. What is actually being asked

The architecture is:

```
hand encoder ─┐
face encoder ─┼─→ fusion ─→ decoder ─→ English
pose encoder ─┘
```

Pre-training that whole network on ISL→English and then fine-tuning the whole
thing on NSL→English would answer a different, weaker question. An improvement
could come from the decoder already being fluent at generating English, which has
nothing to do with sign language transferring across ISL and NSL. The proposal
asks specifically about *transferable sign-language representations*, so the
design has to separate the two.

## 2. Arms

| Arm | Encoders | Fusion + decoder | Isolates |
| --- | --- | --- | --- |
| **A — control** | random | random | the baseline the others are read against |
| **B — visual transfer** *(primary)* | **ISL-pre-trained** | **random** | transfer of sign representations alone |
| **C — full transfer** *(additional)* | ISL-pre-trained | ISL-pre-trained | adds decoder and sequence pre-training |

All three then fine-tune on NSL and are compared on the **same signer-independent
NSL test set**.

**Reading the results**

| Outcome | Reading |
| --- | --- |
| **B > A** | ISL visual representations transfer to NSL. This is the RQ4 claim. |
| **C > B** | English/sequence decoder pre-training contributes on top of that — worth separating in the write-up, because it is not a claim about sign language. |
| **B ≈ A** | Little transferable signal at this corpus size. |
| **B < A** | Negative transfer: ISL initialisation actively hurts. |

The last two are legitimate research findings and complete answers to RQ4. The
proposal's own framing supports reporting them plainly — the participatory
workshop exists precisely so that NSL grammar is *not* imported from ISL, and a
result showing limited visual transfer is consistent with that.

## 3. Controls that have to hold

**One test set, one split.** `server/split-service.ts` produces the
signer-independent 70/15/15 split. Every arm uses the same one, seeded
identically. A signer appearing in both train and test would inflate all three
arms and destroy the comparison, which is why the split is by signer and not by
sample.

**One architecture.** The arms differ only in initialisation. Same layer sizes,
same optimiser, same schedule, same seed handling.

**More than one seed.** With an NSL corpus of 100 sentences across 30–40
signers, the difference between arms may be smaller than the variance between
runs. A single run per arm cannot distinguish them. Report mean and spread over
several seeds, and say how many.

**The same landmark space.** The whole point of
`docs/isl-preprocessing-contract.md`. If ISL and NSL landmarks differ in
rotation, aspect, handedness, face topology or precision, then arm B is measuring
a representation mismatch rather than cross-lingual transfer, and would most
likely show as negative transfer for an entirely uninteresting reason.

**One temporal rate.** ISL is ~25 fps and NSL captures lower. `tools/isl/temporal.py`
brings both to a configurable common rate at model input — default 20 fps, below
both, so it downsamples rather than fabricating motion. Both corpora go through
the same function.

## 4. What is not settled yet

**Corpus size.** Deliberately open until the smoke test reports real throughput
and per-clip size. If B > A at 15k clips, whether more helps is a separate
question worth asking with a scaling curve rather than assumed.

**Isolated signs stay out.** CISLR is iSign's Task 3 and is excluded, because RQ4
targets continuous sentence-level translation. Mixing isolated signs in would
change what "pre-training" means without changing the claim being made about it,
which is the kind of thing that quietly invalidates a result.

**Licensing keeps the corpora separate.** iSign is CC-BY-NC-SA 4.0; NSL capture
is governed by participant consent. Pre-trained weights derived from iSign carry
its terms. `extractorId` and the `dataset` block keep every row attributable.

## 5. A finding to resolve before any of this runs

Recorded while building the ISL verification fixture, and not acted on:

**The non-manual marker thresholds have never been calibrated against real
signing.** `baseline-v1` asks the brow-to-eye gap to change by 0.12 of shoulder
width for an eyebrow raise — about **55 pixels on a 1080-high frame**, which is a
very large movement for an eyebrow. The values come from the proposal, and the
first real NSL capture to reach the server produced **zero** marker tags.

This does not block ISL preprocessing: the marker rules are NSL-specific and are
not run over ISL. It does bear on the NSL side of RQ4, since non-manual markers
are part of what the model is meant to learn from. Calibrating them is the NDFN
Linguistic Validation Workshop's job, and `thresholds.ts` is already structured
as a versioned profile so a retune is a configuration change with `ruleVersion`
recorded on every tag.
