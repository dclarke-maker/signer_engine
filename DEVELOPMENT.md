# SignBridge Development and Deployment Guide

## Purpose

SignBridge has an Expo mobile client and a Node.js backend. The mobile application never records video. While a participant signs, the device extracts hand, face, and pose landmarks and discards each camera frame immediately; only the resulting coordinate sequence, the sentence label, and its category are transmitted. Docker Compose provides the complete low-cost development stack: the backend, MariaDB for research data, MinIO for landmark-sequence storage, and Mailpit for invitation-email inspection. Production uses a Hetzner server, a colocated MariaDB container, private Hetzner Object Storage, and Gmail SMTP for invitations.

> **The app requires a custom development client.** Landmark extraction runs as a native frame processor, which Expo Go cannot load. See [Building the mobile client](#building-the-mobile-client).

## Architecture

| Concern                             | Local development                                      | Production                                                                             |
| ----------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| **Signer identity**                 | MariaDB signer-account, invitation, and session tables | MariaDB on the Hetzner server with a persistent volume                                 |
| **Invitation delivery**             | Mailpit inbox at `http://localhost:8025`               | Gmail SMTP using a dedicated sender account and protected server environment variables |
| **Landmark sequence objects**       | MinIO at `http://localhost:9000`                       | Private Hetzner Object Storage bucket, server-side credentials only                    |
| **Research data**                   | MariaDB prompts, sessions, tags, jobs, feedback        | MariaDB on the Hetzner server with a persistent volume                                 |
| **Administrator invitation access** | Header-protected internal endpoint                     | Replace with the external administrator API guard when its contract is supplied        |

The `signer_accounts` table records only approved email addresses and password hashes. Invitation and session tokens are stored only as SHA-256 hashes. The corresponding raw tokens are returned to the signer once, through the invitation path, and are not stored as plaintext.

## Run the local stack

From the repository root, start the services:

```bash
docker compose up --build
```

The local services are available at the following addresses.

| Service       | Address                 | Purpose                                                                   |
| ------------- | ----------------------- | ------------------------------------------------------------------------- |
| Backend API   | `http://localhost:3000` | Stage configuration, signer sessions, capture sessions, landmark uploads, translation, feedback |
| Mailpit       | `http://localhost:8025` | View local invitation emails without sending messages externally          |
| MinIO API     | `http://localhost:9000` | Object-storage emulator                                                   |
| MinIO console | `http://localhost:9001` | Inspect the local landmark-sequence bucket                                |

Compose waits for MariaDB, runs the reviewed Drizzle migrations, and creates the local MinIO sequence bucket before starting the backend. The development defaults are only for a local workstation. Replace the default database, MinIO, and internal-admin values before sharing the environment with anyone else.

## Signer invitation and sign-in lifecycle

1. An administrator registers an approved signer email using the internal invitation boundary.
2. The backend creates a one-time invitation token with a 72-hour expiration and sends the setup link through Mailpit locally or Gmail SMTP in production.
3. The signer follows the link, sets a password of at least 12 characters, and receives a seven-day session token.
4. The mobile app stores the session token in encrypted native secure storage and verifies the session with the API before opening the camera.
5. Each capture session, landmark sequence, and non-manual marker tag is associated with the authenticated signer identifier.
6. A participant must grant versioned research consent before any capture session can be started.

The temporary internal administrator endpoint requires `x-internal-admin-key`. It is deliberately not called by the mobile app. When the secured administrator API details are available, that header check should be replaced by the provider-issued administrator authentication rule before any production administrator interface is exposed.

## Production: Hetzner Object Storage

Set the following values in the Hetzner server's protected environment before starting the production overlay.

| Variable                    | Example format                        | Purpose                                           |
| --------------------------- | ------------------------------------- | ------------------------------------------------- |
| `OBJECT_STORAGE_ENDPOINT`   | `https://fsn1.your-objectstorage.com` | Location-specific Hetzner Object Storage endpoint |
| `OBJECT_STORAGE_BUCKET`     | `signbridge-sequences-prod`           | Private landmark-sequence bucket                  |
| `OBJECT_STORAGE_REGION`     | `fsn1`                                | Bucket location                                   |
| `OBJECT_STORAGE_ACCESS_KEY` | Provider-issued key                   | Server-only bucket access credential              |
| `OBJECT_STORAGE_SECRET_KEY` | Provider-issued secret                | Server-only bucket access credential              |
| `MYSQL_PASSWORD`            | Long random secret                    | MariaDB application account password              |
| `MYSQL_ROOT_PASSWORD`       | Long random secret                    | MariaDB root password                             |
| `INTERNAL_ADMIN_KEY`        | Long random secret                    | Temporary internal invitation-management guard    |
| `CONSENT_VERSION`           | `v1`                                  | Consent text version in force; a bump invalidates earlier grants |
| `STUDY_SPLIT_SEED`          | `signbridge-study-v1`                 | Seeds the signer-independent partition so it is reproducible |

Hetzner Object Storage uses a compatible object-storage API with location-specific endpoints. Keep the bucket private, create credentials in the Hetzner Console, and retain the issued secret immediately because it is not shown again. [1] [2]

In production the backend refuses to start an upload when any of these four storage variables is missing, and it never creates the bucket itself. Provision the bucket out of band; auto-creation would turn a credential or naming error into a silently wrong bucket rather than a visible failure.

## Privacy posture

The participant path never writes or transmits video. Camera frames exist in device memory only, for as long as it takes to extract landmarks, and are then discarded. Object storage holds gzipped landmark JSON; the database holds prompts, sessions, sequence metadata, non-manual marker tags, translation jobs, votes, and ratings. None of it contains an image, an audio sample, or a free-text identifier.

The one exception is the **workshop calibration buffer**, which lets the NDFN Linguistic Validation Workshop check heuristic thresholds against what a human observer sees. It is off by default, requires a workshop-scoped consent grant, and is never reachable from the participant capture flow.

| Variable                              | Default | Purpose                                                                 |
| ------------------------------------- | ------- | ----------------------------------------------------------------------- |
| `CALIBRATION_BUFFER_ENABLED`          | `false` | Enables the workshop-only transient buffer. Leave off for data collection |
| `CALIBRATION_BUFFER_RETENTION_HOURS`  | `24`    | Hard ceiling enforced by scheduled purge, not by operator discipline     |

See `design.md` §3 for the full data flow and the four security guarantees.

## Exporting the corpus

Phase 3 needs the corpus out of the system for ELAN annotation and ISL pre-training:

```bash
DATABASE_URL=mysql://... STUDY_SPLIT_SEED=signbridge-study-v1 pnpm export:corpus [outputDir]
```

It writes `train.jsonl`, `validation.jsonl`, `test.jsonl`, one ELAN tier file per session under `elan/`, and a `manifest.json` recording the seed, rule version, extractor, consent version, and row count.

Only `stored` sessions are exported. Superseded sessions are kept for audit but are no longer canonical, skipped prompts have no sequence, and signers without a current consent grant are excluded in the query - a withdrawal cannot survive by being filtered somewhere downstream and forgotten.

The command refuses to run without `DATABASE_URL`, says so plainly when there is nothing to export rather than writing three empty files, and warns loudly if any split ends up empty: metrics computed against an empty split are meaningless, and a silent zero would be reported as a result.

## Building the mobile client

Landmark extraction runs as a native frame processor, so **Expo Go cannot run this app**. Generate the native projects and build a development client:

```bash
npx expo prebuild        # generates ios/ and android/
pnpm ios                 # or: pnpm android
```

The first native build takes 10-20 minutes and needs Xcode (iOS) or the Android SDK. Once the development client is installed, `pnpm dev` drives it as usual.

### The MediaPipe holistic plugin

Landmark extraction is a custom Vision Camera frame-processor plugin wrapping MediaPipe Tasks. No off-the-shelf React Native package supplies hand landmarks, so this is written rather than integrated.

| Piece | Where |
| --- | --- |
| Swift plugin + ObjC registration | `native/holistic/ios/` |
| Kotlin plugin + package registration | `native/holistic/android/` |
| Wire format (the authority, unit-tested) | `lib/extractors/holistic-buffer.ts` |
| Expo config plugin | `plugins/with-mediapipe-holistic.js` |
| JS extractor | `lib/extractors/mediapipe-native-extractor.ts` |

The plugin returns one packed `Float32Array` per frame rather than a nested map: a holistic result is ~543 landmarks, and bridging that as objects at 30fps would dominate the frame budget. `holistic-buffer.ts` defines the layout, decodes it, and its `encodeHolisticBuffer` is an executable specification the Swift and Kotlin writers must match.

The model is committed at `native/holistic/models/holistic_landmarker.task` (13 MB). EAS runs `expo prebuild` on its own machines, so anything excluded from the repository never reaches the build — and the upstream URL points at `latest`, which would let the model change underneath the study. See that directory's README for the pinned checksum.

### Building with EAS

The native toolchain runs in the cloud, so no local Xcode or Android SDK is needed:

```bash
npx eas-cli@latest login
npx eas-cli@latest build --profile development --platform android
```

`eas.json` defines three profiles. `development` produces a development client with `expo-dev-client`, which is what the frame processor needs; `preview` is an internal release build; `production` is store-bound. Android development builds need no paid account. iOS device builds require an Apple Developer membership; `--platform ios` with `"simulator": true` avoids that if a simulator build is enough.

Once the development client is installed, `pnpm dev` drives it as usual.

Both platforms have been prebuilt and the generated projects verified: the Kotlin and Swift sources land in the right packages, the model is registered as an Android asset and an iOS bundle resource, the MediaPipe dependency is added to Gradle and the Podfile, and the frame-processor package is registered in `MainApplication`. Only compilation itself remains unproven.

### Building locally instead

```bash
npx expo prebuild --clean
pnpm ios      # or: pnpm android
```

The config plugin fails the build with a clear message if the model is absent, rather than producing an app that silently detects nothing.

**The thread boundary.** A frame processor runs in a worklet runtime that receives *copies* of captured values, so state mutated there never reaches the JS thread. `components/landmark-camera.tsx` therefore does only what must happen on the camera thread - throttling with `runAtTargetFps` and calling the plugin - then marshals the packed buffer across with `Worklets.createRunOnJS`. Decoding, counting, and listener notification all happen on JS, where the extractor's state lives.

Screens render `<LandmarkCamera>` rather than a camera directly. It inspects the extractor: pull extractors (fixture, web) get a plain preview, push extractors get Vision Camera with the frame processor attached. If a push extractor is paired with an unavailable device or plugin - Expo Go, or a build without the config plugin - it falls back to a preview and warns in development, because that combination would otherwise produce a capture of zero frames with no error at all.

Every screen depends on the `LandmarkExtractor` interface rather than a concrete extractor, so the runtime can change without touching them.

## Production: Gmail SMTP

The production Compose overlay configures the invitation adapter for Gmail SMTP. Supply the following values only in the server environment, never in the Expo app or committed repository files.

| Variable                 | Example format                         | Purpose                                                    |
| ------------------------ | -------------------------------------- | ---------------------------------------------------------- |
| `SMTP_USER`              | `signbridge@example.com`               | Dedicated Gmail or Google Workspace sender address         |
| `SMTP_PASSWORD`          | App-specific password                  | Credential used solely by the backend SMTP client          |
| `SMTP_FROM`              | `SignBridge <signbridge@example.com>`  | Visible invitation sender                                  |
| `SIGNER_INVITE_BASE_URL` | `https://api.example.com/set-password` | Public password-setup URL that receives the one-time token |

Google documents `smtp.gmail.com` with SSL on port `465` or TLS on port `587`; the scaffold uses the SSL option. App passwords require two-step verification and may not be available under all organisation policies. Google Workspace recommends its SMTP relay option for managed organisation deployments, so use that option if your administrator provides it. [3] [4]

## Start the Hetzner production overlay

Place the production-only environment variables in the protected Hetzner server configuration, provision a TLS-terminating reverse proxy, and then run:

```bash
docker compose -f docker-compose.hetzner.yml up -d --build
curl http://127.0.0.1:3000/api/health
```

The overlay binds the backend to loopback, leaving the reverse proxy responsible for TLS, public routing, request limits, and access logs. Keep the MariaDB volume on the Hetzner server and document a database-backup schedule before enrolling signers.

## References

[1] [Hetzner, “Object Storage overview.”](https://docs.hetzner.com/storage/object-storage/overview/)

[2] [Hetzner, “Using S3 compatible CLI tools.”](https://docs.hetzner.com/storage/object-storage/getting-started/using-s3-api-tools/)

[3] [Google Workspace, “Send email from a printer, scanner, or app.”](https://knowledge.workspace.google.com/admin/gmail/send-email-from-a-printer-scanner-or-app)

[4] [Google Gmail Help, “Sign in with app passwords.”](https://support.google.com/mail/answer/185833?hl=en)
