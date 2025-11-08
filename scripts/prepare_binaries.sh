#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAC_BIN_DIR="$ROOT_DIR/binaries/macos"
FFMPEG_BIN="$MAC_BIN_DIR/ffmpeg"
FFMPEG_ZIP="$MAC_BIN_DIR/ffmpeg.zip"
LEGACY_LINK="$MAC_BIN_DIR/ffmpeg-aarch64-apple-darwin"

if [[ ! -f "$FFMPEG_BIN" ]]; then
  if [[ -f "$FFMPEG_ZIP" ]]; then
    echo "[prepare_binaries] Unpacking ffmpeg.zip..."
    unzip -o "$FFMPEG_ZIP" -d "$MAC_BIN_DIR" >/dev/null
    chmod +x "$FFMPEG_BIN"
  else
    echo "[prepare_binaries] ERROR: $FFMPEG_BIN missing and no $FFMPEG_ZIP archive found."
    echo "  Please download a static macOS ffmpeg and place it at $FFMPEG_ZIP."
    exit 1
  fi
fi

if [[ -f "$FFMPEG_BIN" ]]; then
  ln -sf "ffmpeg" "$LEGACY_LINK"
fi
