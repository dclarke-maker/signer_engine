# Device verification

What to check the first time the app runs on real hardware, and what the numbers
have to be. Everything below is unverified until someone does this — the test
suite proves the contracts hold and the build proves the code compiles, but
neither shows that MediaPipe emits correct landmarks at a usable rate.

The Capture Review screen already reports every figure needed, so this needs no
extra tooling.

## Before you start

- An Android device that is **not** HarmonyOS NEXT (no Android runtime at all).
- The **preview** APK, not the development one. A development build embeds no
  JavaScript and needs a Metro server on the same network; preview is
  self-contained with the API URL compiled in.

  Latest: `https://expo.dev/artifacts/eas/SjXYN4_T5tKmAltmPATIyf9Rexlwz-zAT5lSfzyDWDc.apk`

  Rebuild with `npx eas-cli@latest build --profile preview --platform android`.
- A signer account. One already exists on the deployed server for this purpose:

  | | |
  | --- | --- |
  | Email | `tester@nsl.local` |
  | Password | `device-test-passphrase-2026` |

  It is a test account on a test deployment, not a participant account — delete
  it before real recruitment. To create others, call `internalAdmin.inviteSigner`
  and read the email from Mailpit over an SSH tunnel:
  `ssh -L 8025:localhost:8025 nsl-prod`, then `http://localhost:8025`.

## 0. Running without a phone

An Android emulator can pass the host webcam through to the virtual camera,
which is enough to exercise extraction end to end. Install Android Studio,
create a Pixel with an **arm64** system image, then in the device's Advanced
Settings set the front camera to **Webcam0** — without that it renders a
synthetic scene with no hands in it, and MediaPipe will correctly find nothing.

Also set the **back** camera to `none`. A Mac has one webcam, the emulator can
map it to only one virtual camera, and with both set to `webcam0` it binds the
back one — leaving no front-facing device at all. The capture screen asks for
the front lens, so the whole pipeline sits idle behind a black preview. Check
it took with:

```bash
adb shell dumpsys media.camera | grep -E "Number of camera devices|Facing:"
```

Expect one device and `Facing: Front`.

Two emulator-only results to expect, neither a defect:

- **`ready on CPU`, not GPU.** The emulator's GL rejects the delegate with
  `GL_INVALID_ENUM`. The CPU fallback is doing its job; check the delegate again
  on real hardware.
- **Poor frame rate.** Already true of emulators generally, and more so on CPU.

The APK ships `arm64-v8a`, so it runs natively on an Apple Silicon Mac.

Frame rate from an emulator says nothing useful: a development machine will beat
any phone a participant owns. Everything else on this list is still meaningful.

## 1. The native module loaded

Open the app and go to Settings. **Motion extractor** must read
`mediapipe-holistic-native@1`.

If it says `fixture@1`, the native plugin did not register and everything below
is meaningless — the app has silently fallen back to replaying canned frames.
Check `adb logcat -s HolisticPlugin` for the delegate line.

## 2. Which delegate is in use

```
adb logcat -s HolisticPlugin
```

Expect `HolisticLandmarker ready on GPU`. `ready on CPU` means the GPU delegate
was rejected — it will still work but considerably slower, and that matters for
the frame rate below. `failed on every delegate` means captures will contain
nothing.

## 3. Stream sizes

Sign one prompt, then read the coverage bars on Capture Review. The proposal
fixes these counts, and the decoder rejects anything else rather than passing a
partial array through:

| Stream | Expected |
| --- | --- |
| Face | 478, or 468 |
| Pose | 33 |
| Left / right hand | 21 each |

MediaPipe Tasks appends ten iris landmarks to the 468-point mesh, so a detected
face normally arrives as **478**. Both counts are accepted. The proposal and
design.md say 468 because that is the mesh the marker rules index into, and
every face index they use is below 468.

Coverage near 100% for face and body, and above ~50% for each hand, means the
signer stayed in frame. Persistently low hand coverage usually means framing,
not a bug — but zero coverage on a stream that should be present is a bug.

**Read the pattern, not just the numbers.** Coverage counts only whether
landmarks came back, not whether they are right, so a high bar is weaker
evidence than it looks. In particular, **body near 100% with face and hands at
zero means the frame reached MediaPipe the wrong way up**: it finds a pose
first and crops the face and hand regions out of it, so a sideways frame
produces a pose of some kind and then nothing else. That is a bug in the
plugin's rotation handling, not a framing problem, and no amount of
repositioning will fix it.

The per-frame log is the faster check:

```
adb logcat -s HolisticPlugin | grep frame
```

Each line carries the frame size, the rotation applied, the aspect ratio, and
the four landmark counts. Counts of `face=0 pose=33` on a well-framed signer
say the same thing as the coverage bars, sooner.

## 4. Frame rate

The **fps** figure on Capture Review is the number that matters most, and the one
this whole architecture was chosen for.

| Achieved fps | Reading |
| --- | --- |
| 25–30 | Working as designed |
| 15–25 | Usable; note it against the device model |
| Below 15 | Too sparse for continuous signing — sequences will miss transitions |

If it is below 15 on a mid-range device, the native path may not be viable on
the hardware the study will actually use, and that is worth knowing before
fieldwork rather than during it.

## 5. The buffer actually decodes

`lib/extractors/holistic-buffer.ts` is the wire-format authority, and its
`encodeHolisticBase64` is the executable specification the Kotlin and Swift
writers must match. If the two disagree, the decoder throws and the frame is
dropped and counted rather than surfacing an error.

Capture Review reports this directly: a capture that discarded frames shows a
**"n% of frames could not be read"** panel with the count. Anything above zero
means the plugin and the JavaScript decoder disagree about the layout, and the
sample is incomplete rather than merely short — recording again will not help.

The older symptom still holds as a cross-check: compare `frameCount` against
`duration × fps`. A large shortfall means the same thing.

The packed bytes cross the worklet boundary as a **base64 string**, not an
ArrayBuffer. This is not a stylistic choice: `Worklets.createRunOnJS` converts
each argument to a worklets-core shared value, and that converter throws on
ArrayBuffers outright. The symptom, if a writer ever returns one again, is this
in logcat on every frame, with a capture that reports zero frames:

```
E ReactNativeJS: [Frame Processor Error: Array buffers are not supported as shared values.]
```

Byte order is little-endian, pinned explicitly by both writers rather than
inherited from the host.

## 6. End to end

Submit the sample and confirm on the server:

```bash
ssh nsl-prod
cd /opt/signbridge && . ./.env.production
docker exec sb-db mariadb -u root -p"$MYSQL_ROOT_PASSWORD" signbridge -e "
  SELECT s.promptId, s.status, l.frameCount, l.achievedFps, l.sizeBytes
  FROM capture_sessions s JOIN landmark_sequences l ON l.sessionId = s.id
  ORDER BY s.startedAt DESC LIMIT 5;
  SELECT type, startFrame, endFrame, confidenceBp FROM nmm_tags ORDER BY id DESC LIMIT 5;"
```

A stored session with a sequence row and plausible NMM tags means the whole
pipeline works: extraction, packing, upload, heuristic tagging, and persistence.

Then check the object store holds a landmark blob and **no media file**:

```bash
docker exec sb-minio sh -c 'ls -R /data/signbridge-sequences' | head
```

Every object should end `.json.gz`. Anything else is a privacy regression.
