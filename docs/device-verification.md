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
| Face | 468 |
| Pose | 33 |
| Left / right hand | 21 each |

Coverage near 100% for face and body, and above ~50% for each hand, means the
signer stayed in frame. Persistently low hand coverage usually means framing,
not a bug — but zero coverage on a stream that should be present is a bug.

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
`encodeHolisticBuffer` is the executable specification the Kotlin and Swift
writers must match. If the two disagree, the decoder throws and the frame is
dropped and counted rather than surfacing an error.

So: a capture that reports **far fewer frames than the elapsed time implies** is
the symptom of a format mismatch, not slowness. Compare `frameCount` against
`duration × fps`. A large shortfall means the native writer and the decoder
disagree about the layout.

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
