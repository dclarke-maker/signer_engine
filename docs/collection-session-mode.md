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
6. **Recording.** Ends on its own — see below. Tapping anywhere also stops it,
   for a signer who does walk up.
7. **"✓ Saved"**, then the next sentence. The upload runs in the background so
   nobody stands watching a progress bar.

After ten, they walk to the phone once: a list of the ten with frame counts and
in-frame percentage, any of them tappable to re-record, then *Record N again*,
*Next 10 sentences*, or *Done for now*.

Roughly 25 minutes of work per signer instead of an hour of walking, and ten
trips to the phone instead of four hundred.

## How recording ends

`lib/capture/rest-detector.ts`. Two guards matter more than stopping promptly,
because over-recording leaves trailing stillness that trims cleanly while
truncation removes signed content that cannot be recovered.

- **It must see movement first.** After the countdown a signer stands still with
  their hands down, which is indistinguishable from having finished. Without
  this guard every sentence would stop before it began.
- **Rest must persist for 1.5 s.** A held handshape is stillness that carries
  meaning; sign languages use holds as content.

Rest is *either* hands leaving the frame — how signers actually finish, and the
more reliable signal — *or* hand speed below `REST_MOTION_THRESHOLD`. Speed is
measured after aspect correction, since x is normalised by frame width and y by
height; on a 9:16 frame raw dx under-reads lateral movement by nearly half, and
signing is largely lateral.

A hard cap at 20 s always fires. The sample is kept and flagged in the review as
having reached the time limit.

## What still needs calibrating on real signers

`REST_MOTION_THRESHOLD` (0.12 frame-heights/second) is a starting value, not a
measurement. It has to sit between MediaPipe's landmark jitter on a held pose
and the slowest deliberate signing movement, and that gap is not wide. **Nobody
has yet run a block with a Deaf signer.**

The pilot should check, per sentence:

- how often recording stopped on `rest` versus `max-duration` — a lot of the
  latter means rest is never being detected;
- whether any sample ends mid-sign, which is the failure that costs data;
- the trailing stillness on rest-stopped samples, which sets how much to trim.

`COUNTDOWN_MS`, `REST_HOLD_MS`, `MIN_RECORDING_MS` and `FRAMING_FRAMES` are all
in `shared/capture-session.ts` and are meant to be changed once those numbers
exist.

## Limits

- **Uploads are not retried automatically.** A failure is shown at the block
  review with the sentence marked; the signer re-records it. After two held
  failures the block stops early rather than filling memory with sequences that
  cannot be sent — one sentence is several megabytes.
- **No per-sample review before submission.** Bad framing surfaces at the end of
  a block rather than immediately. This is the deliberate trade for not walking:
  the block review still catches it while someone is standing at the phone.
- The single-sentence screen (`app/capture.tsx`) is unchanged and remains
  reachable as *Record just this sentence*.
