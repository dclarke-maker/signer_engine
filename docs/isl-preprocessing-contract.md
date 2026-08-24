# ISL preprocessing contract

What an offline extractor must reproduce for Indian Sign Language video to land in
the same landmark space as Nepali Sign Language capture.

This exists because the two halves of RQ4 are produced by different runtimes. NSL
landmarks come from a Kotlin frame processor on a phone; ISL landmarks will come
from Python over recorded video. If those disagree — even slightly — the model is
pre-trained in one coordinate space and fine-tuned in another, and the transfer
degrades without anything failing. Every bug found during the first device
verification was of exactly that kind: rotation, aspect ratio, mirroring, face
point count, numeric precision. None of them threw.

`lib/extractors/holistic-buffer.ts` is the authority. Where this document and
that file disagree, the file is right and this document is stale.

**ISL is transformed into the NSL representation. The NSL conventions do not
move to accommodate ISL.**

---

## 1. The model

Not "a MediaPipe holistic model" — **the committed file**:

```
native/holistic/models/holistic_landmarker.task
```

The offline extractor loads that exact asset, and its SHA-256 is recorded in
every validation report. A different download of nominally the same model is not
acceptable: weights that differ produce landmarks that differ, and nothing
downstream would notice.

Identical weights are necessary but **not sufficient**. Image conversion,
rotation handling, API version and delegate can all differ between runtimes, so
§9 requires an empirical comparison rather than an assumption.

## 2. MediaPipe configuration

| Setting | Value | Why |
| --- | --- | --- |
| Task | `HolisticLandmarker` | Matches the device |
| Running mode | `VIDEO` (`detect_for_video`) | Same temporal path as the device; `IMAGE` mode discards inter-frame tracking |
| Face blendshapes | off | Not in the pipeline, costs time per frame |
| Pose segmentation masks | off | Same |
| Delegate | GPU attempted, CPU fallback | Mirrors `createLandmarker` in the Kotlin plugin. The delegate actually used is recorded |

Timestamps passed to `detect_for_video` must increase strictly monotonically, as
on the device.

## 3. Streams, order and counts

Order is part of the format, not a convention of convenience:

```
face, pose, leftHand, rightHand
```

| Stream | Count | Notes |
| --- | --- | --- |
| face | 468 or 478 | See §4 |
| pose | 33 | |
| leftHand | 21 | Signer's own left — see §7 |
| rightHand | 21 | |

Each landmark carries `x, y, z, visibility`. Any count other than those listed
rejects the frame — it is never truncated to fit. The marker rules index
landmarks by position, so a short array reads the wrong anatomy rather than
failing.

## 4. Face topology: 478 stored, 468 at model input

MediaPipe Tasks emits **478** face landmarks: the 468-point mesh plus 10 iris
points at indices 468–477. They are **appended, not interleaved**, so indices
0–467 mean the same thing in both layouts.

A Transformer input tensor cannot have a variable dimension, so a single
canonical face topology is required. It is **468**, matching the proposal.

| Stage | Face points | Rule |
| --- | --- | --- |
| Extraction | whatever the model emits (normally 478) | Faithful; nothing discarded |
| Storage | as extracted | Iris points are kept in case a later marker needs gaze |
| **Model input** | **468, fixed** | Deterministic truncation of indices 468–477 |

The truncation is applied **identically to ISL and NSL**, in the training loader,
never in extraction. A test asserts indices 0–467 survive it unchanged.

## 5. Geometry: rotation

The frame is turned **upright before detection**.

`HolisticLandmarker` is not rotation invariant: it locates a pose first and crops
the face and hand regions out of it. A sideways frame yields a pose of some kind
and then no face and no hands at all — on the device this presented as body
coverage near 100% with face and hands at zero.

- **Device**: rotation comes from `Frame.orientation`, reversed to recover
  CameraX's `rotationDegrees`.
- **ISL video**: rotation comes from the container's rotation metadata. Note that
  some decoders apply it automatically and some do not; the extractor must
  determine which and not double-rotate. Verified by §9's landscape fixture.

## 6. Geometry: aspect ratio

Stored per frame as **width ÷ height of the upright frame** — after any rotation,
because rotating swaps them.

MediaPipe normalises `x` by frame width and `y` by frame height. On a 9:16 frame
a unit of `x` is 0.5625 of a unit of `y`, so the two cannot be compared, divided
or combined into an angle without this number. Every marker rule divides a
vertical measure by shoulder width, which is horizontal; `server/nmm/isotropic.ts`
rescales using this value before any rule runs.

`z` is on roughly the same scale as `x` and is rescaled with it.

## 7. Mirroring and handedness

Stored per frame as a flag. **Read from the source, never assumed.**

MediaPipe names hands anatomically, but for the person *as depicted in the frame
it is given*. A mirrored frame depicts a mirrored person, so the labels come back
swapped relative to the real signer, and the decoder swaps them back.

- **Device**: read from the sensor-to-buffer transform. Android's analysis buffer
  reports `false`; a front camera is not automatically mirrored.
- **ISL video**: recorded and broadcast footage, so `false` is expected — but it
  is measured, not assumed, and §9's handedness check confirms it.

A wrong answer here does not fail loudly. It labels every left hand as a right
one across the whole corpus, and left and right are not incidental in a sign
language.

## 8. Coordinates, missing streams, timing, precision

**Normalisation.** Landmarks are stored exactly as MediaPipe emits them —
image-relative, origin top-left, `x` by width and `y` by height. No re-centring,
no scaling, no signer normalisation. Signer-relative normalisation happens later
and is derived, so that the stored capture stays reprocessable if that strategy
changes.

**Missing streams.** A stream not detected in a frame is `null`, never an array
of zeros. "Out of frame" and "at the origin" must stay distinguishable.

**Frame order and timing.** Source order, source timestamps, rebased so the first
frame of a clip is `t = 0`. Timestamps are milliseconds.

**Precision.** Coordinates are rounded to **5 decimal places**, matching
`COORDINATE_DECIMALS` in `lib/sequence-payload.ts`. This is the NSL canonical
stored precision, not a compression choice: 1e-5 of a 1080-pixel frame is a
hundredth of a pixel, well below what the model resolves. Configurable, and the
validation report states the full-precision versus rounded difference.

**No quantisation.** Values are stored as float32. float16 is not used at this
stage — it changes the landmark values themselves rather than their
serialisation, and may only be considered later if it shows negligible error and
no measurable training degradation.

**Face visibility.** MediaPipe supplies no visibility for face landmarks; the
Kotlin plugin writes `orElse(1f)`, so NSL stores `1.0` for every face point. The
ISL `.npz` may omit that column **only because the loader reconstructs exactly
`1.0`** — the value is constant and carries no information. This is the one place
the stored ISL bytes differ from the stored NSL bytes, it is a serialisation
difference and not a value difference, and the equivalence check in §10 proves
the reconstruction is exact.

## 9. What this contract does *not* cover: temporal rate

Extraction is faithful to source timing. It does not resample, interpolate or
duplicate frames.

iSign is roughly 25 fps; the NSL app targets 30 and achieves lower. Bringing them
to a common rate is a **model-input** concern, handled in the training loader by
`tools/isl/temporal.py`, applied to ISL and NSL alike, with the target rate
configurable. The default candidate is **20 fps**, below both, so the operation
is predominantly downsampling rather than fabricating intermediate frames.

Each stored sequence records its **source fps and per-frame timestamps** so any
rate can be produced later without re-extraction.

## 10. Storage and output schema

**Bulk corpus** — one compressed `.npz` per clip, float32:

| Array | Shape | Notes |
| --- | --- | --- |
| `face` | `(frames, 478, 3)` | `x, y, z`; visibility reconstructed as 1.0 (§8) |
| `pose` | `(frames, 33, 4)` | `x, y, z, visibility` |
| `left_hand` | `(frames, 21, 4)` | |
| `right_hand` | `(frames, 21, 4)` | |
| `present` | `(frames, 4)` | bool per stream, in stream order; `False` is the `null` of §8 |
| `t_ms` | `(frames,)` | rebased to 0 |
| `aspect` | `(frames,)` | §6 |
| `mirrored` | `(frames,)` | bool, §7 |

**Verification subset** — the same clips additionally written as
`LandmarkSequencePayload` JSON, the NSL wire shape, so equivalence can be checked
numerically and by feeding it through the real NSL server code.

**Per-clip metadata**, mirroring `buildTrainingJsonl` in `server/export-service.ts`
so ISL and NSL rows are consumable by one loader:

| Field | Source |
| --- | --- |
| `sessionId` | iSign clip UID |
| `signerId` | iSign source signer where known, else null |
| `split` | assigned for pre-training, independent of the NSL splits |
| `promptId` | iSign clip UID |
| `category` | `isl-continuous` |
| `text` | English translation from `iSign_v1.1.csv` |
| `textNepali` | null — ISL clips have no Nepali |
| `sequence` | path to the `.npz` on Drive |
| `extractorId` | **`mediapipe-holistic-offline@1`** |
| `frameCount`, `durationMs`, `sourceFps` | measured |
| `nmm` | empty — the marker rules are NSL-specific and are not run over ISL |
| `dataset` | `{ name: "iSign", version: "v1.1", source: "ISLRTC" \| "ISH News" \| "DEAF ENABLED", licence: "CC-BY-NC-SA-4.0" }` |

`extractorId` is the traceability handle: **`mediapipe-holistic-native@1`** is a
phone capture, **`mediapipe-holistic-offline@1`** is ISL video, and no row is
ambiguous about which runtime produced it.

## 11. Conformance

A contract that is only prose gets violated silently. These run:

1. **`tools/isl/tests/`** — stream order and counts, face truncation preserving
   0–467, null-versus-zero handling, timestamp rebasing, rounding, temporal
   resampling, manifest resume.
2. **`tests/isl-contract.test.ts`** — a verification JSON is fed through the real
   NSL server code, `computeSignerBaseline` and `detectNmms` from `server/nmm/`,
   asserting it parses as `LandmarkFrame[]` and yields a usable baseline. This is
   what proves ISL output is readable by the NSL pipeline rather than merely
   looking similar to it.
3. **Cross-runtime equivalence** — the same frames through the Kotlin extractor
   and the Python extractor, compared after canonical rounding. Fixtures include
   an upright case **and a 90°-rotated landscape case**, because upright-only
   inputs would leave §5 and §6 untested. Divergence is measured and reported
   before any threshold is asserted; runtimes and delegates are not expected to
   agree exactly.

## 12. Licence

iSign is **CC-BY-NC-SA 4.0** and gated on Hugging Face. Non-commercial use only,
attribution required, and derivative datasets carry the same terms. Processed ISL
landmark sequences are a derivative of a ShareAlike corpus and are **not**
interchangeable with NSL capture data for redistribution: NSL sequences are
governed by participant consent, ISL sequences by this licence. They are kept
separable — by `extractorId` and `dataset` — for that reason as much as for
provenance.
