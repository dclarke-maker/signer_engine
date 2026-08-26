# Session mode — how a signer records

## Why it exists

Framing the upper body and both extended arms puts the phone roughly 1.3–1.5 m
from the signer. Signing needs both hands, so the phone cannot be held. Every
tap is therefore a walk.

Under the original one-sentence-at-a-time flow that made each sentence:

| | |
|---|---|
| step in, read, tap record | ~8 s |
| step back, settle | ~3 s |
| **sign** | **~4 s** |
| step in, tap stop | ~4 s |
| read the review, submit | ~7 s |

About 26 s of logistics around 4 s of data, roughly 400 transits across the
hundred sentences, and 45 minutes of walking per signer against 7 minutes of
signing.

Two consequences mattered more than the tedium:

- **Fatigue is confounded with linguistic category.** `promptOrderForSigner`
  rotates the starting category per signer, so the exhausted end of the session
  lands on a different category for each person.
- **Every sequence was bracketed by a reach toward the camera.** ~30–60 frames
  at each end of every sample, correlated with nothing linguistic, and the most
  consistent motion in the corpus.

## What the signer does now

Once, at the start of a block:

1. Stand the phone up on its own — against a wall, a stack of books, or a stand
   — at about chest height.
2. Step back until head and both arms fit in the picture.

Then, without touching the phone, for ten sentences:

3. The sentence appears at 38 pt, sized to be read at 1.5 m.
4. **Framing gate.** Nothing starts until face and body have been detected for
   twelve consecutive frames. Self-adjusting: the first sentence waits while the
   signer walks back, the next nine open immediately.
5. **Countdown**, 3 s. The capture session row is opened on the server during
   it; if that fails the count holds rather than recording something with
   nowhere to be stored.
6. **Recording**, for a fixed 12 seconds with the remaining time shown. Tapping
   anywhere ends it early, for a signer who does walk up.
7. **"✓ Saved"**, then the next sentence. The upload runs in the background so
   nobody stands watching a progress bar.

After ten, they walk to the phone once: a list of the ten with frame counts and
in-frame percentage, any of them tappable to re-record, then *Record N again*,
*Next 10 sentences*, or *Done for now*.

Roughly 25 minutes of work per signer instead of an hour of walking, and ten
trips to the phone instead of four hundred.

## How recording ends

**A fixed 12-second window.** The signer sees the seconds remaining and a bar
that empties; a tap anywhere ends it early.

It was originally a detected ending — the app watched the landmarks and stopped
when the signer came to rest. Measured over a real ten-sentence block that
ended **three of ten** correctly and let seven run to the limit, and no
threshold repaired it: resting hands held at the waist moved at a median 0.128
frame-heights per second against a 0.12 threshold, and raising it far enough to
catch rest made stretches of actual signing read as still. The full numbers are
in [reports/rest-detection-measurement.md](reports/rest-detection-measurement.md).

The fault was structural. Ending a sentence on the device is irreversible and
decided from a single frame; every landmark is stored, so the same judgement
made afterwards costs nothing when wrong and can be recomputed. It now lives in
`shared/rest-trim.ts` as `proposeTrim`, which **reports** where a sequence could
be cut and returns `found: false` rather than guessing when no confident resting
point exists. Nothing is trimmed on the strength of the current numbers.

Two guards survive the move, because trailing stillness is cheap and a truncated
utterance is not:

- **It must see movement first.** After the countdown a signer stands still with
  their hands down, which is indistinguishable from having finished.
- **Rest must persist for 1.5 s.** A held handshape is stillness that carries
  meaning; sign languages use holds as content.

Speed is measured after aspect correction, since x is normalised by frame width
and y by height; on a 9:16 frame raw dx under-reads lateral movement by nearly
half, and signing is largely lateral.

## What still needs calibrating on real signers

**No block has been recorded by a Deaf signer.** The measurement above was hand
movement, not NSL, and did not exercise the signing space — real signing reaches
the face and the sides, so the separation between signing and rest may be much
wider than these numbers suggest.

At the NDFN pilot, before the full cohort: capture 10–20 genuinely signed
sentences, re-run the analysis in the report, and fit `REST_MOTION_THRESHOLD`
against them. Also worth checking whether 12 s is the right window — the three
sentences that did end on detected rest ran 5.7 s, 8.9 s and 9.4 s including the
rest that ended them.

Every timing lives in `shared/capture-session.ts` and is meant to change once
those numbers exist.

## Limits

- **Uploads are not retried automatically.** A failure is shown at the block
  review with the sentence marked; the signer re-records it. After two held
  failures the block stops early rather than filling memory with sequences that
  cannot be sent — one sentence is several megabytes.
- **No per-sample review before submission.** Bad framing surfaces at the end of
  a block rather than immediately. This is the deliberate trade for not walking:
  the block review still catches it while someone is standing at the phone.
- **The signer waits out the tail of every window.** A four-second sentence
  still occupies twelve. That is the price of never truncating one, and it is
  paid in a place where the signer is standing still rather than walking.
- The single-sentence screen (`app/capture.tsx`) is unchanged and remains
  reachable as *Record just this sentence*.
