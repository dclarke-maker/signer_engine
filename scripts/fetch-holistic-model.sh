#!/usr/bin/env bash
# Downloads the MediaPipe holistic model used by the native frame processor.
# Not committed: the float16 bundle is large and Google serves it directly.
set -euo pipefail

DEST_DIR="$(cd "$(dirname "$0")/.." && pwd)/native/holistic/models"
DEST="$DEST_DIR/holistic_landmarker.task"
URL="https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/latest/holistic_landmarker.task"

mkdir -p "$DEST_DIR"
if [ -f "$DEST" ]; then
  echo "Model already present: $DEST"
  exit 0
fi

echo "Downloading holistic_landmarker.task ..."
curl -fL --progress-bar "$URL" -o "$DEST.partial"
mv "$DEST.partial" "$DEST"
echo "Saved to $DEST"
