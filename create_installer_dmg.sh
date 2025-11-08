#!/bin/bash
set -euo pipefail

APP_PATH="src-tauri/target/release/bundle/macos/PrivateAI Voice.app"
APP_NAME="$(basename "$APP_PATH")"
DMG_NAME="PrivateAI_Voice_Installer.dmg"
VOLUME_NAME="PrivateAI Voice Installer"
TMP_DMG="tmp_${DMG_NAME}"
TMP_DIR=""
ENTITLEMENTS_FILE="${ENTITLEMENTS_FILE:-src-tauri/entitlements.plist}"
SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-${APPLE_CODESIGN_IDENTITY:-}}"
TEAM_ID="${APPLE_TEAM_ID:-K9QY5WRT2J}"
NOTARY_PROFILE="${NOTARYTOOL_PROFILE:-}"

log() {
  echo "[mac-dist] $*"
}

require_binary() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "Missing required command: $1"
    exit 1
  fi
}

require_binary codesign
require_binary hdiutil

if [[ -z "$SIGNING_IDENTITY" ]]; then
  cat <<'EOF'
Missing signing identity.
Export APPLE_SIGNING_IDENTITY (or APPLE_CODESIGN_IDENTITY) with the exact name
shown by `security find-identity -v -p codesigning`, e.g.

  export APPLE_SIGNING_IDENTITY="Developer ID Application: Carlos Polanco (K9QY5WRT2J)"

Then re-run this script.
EOF
  exit 1
fi

if [[ ! -d "$APP_PATH" ]]; then
  log "macOS app bundle not found at $APP_PATH. Run \`npm run tauri build\` first."
  exit 1
fi

if [[ ! -f "$ENTITLEMENTS_FILE" ]]; then
  log "Entitlements file missing at $ENTITLEMENTS_FILE"
  exit 1
fi

sign_app() {
  log "Signing app bundle with identity: $SIGNING_IDENTITY"
  codesign --deep --force --options runtime --entitlements "$ENTITLEMENTS_FILE" \
    --sign "$SIGNING_IDENTITY" "$APP_PATH"
  codesign --verify --deep --strict --verbose=2 "$APP_PATH"
}

sign_dmg() {
  log "Signing DMG..."
  codesign --force --sign "$SIGNING_IDENTITY" "$DMG_NAME"
  codesign --verify --verbose "$DMG_NAME"
}

notarize_and_staple() {
  local notarized=0

  if [[ -n "$NOTARY_PROFILE" ]]; then
    require_binary xcrun
    log "Submitting DMG to notarytool profile: $NOTARY_PROFILE"
    xcrun notarytool submit "$DMG_NAME" --keychain-profile "$NOTARY_PROFILE" --wait
    notarized=1
  elif [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]]; then
    require_binary xcrun
    log "Submitting DMG to Apple notarization service..."
    xcrun notarytool submit "$DMG_NAME" \
      --apple-id "$APPLE_ID" \
      --team-id "$TEAM_ID" \
      --password "$APPLE_APP_SPECIFIC_PASSWORD" \
      --wait
    notarized=1
  else
    log "Skipping notarization (set NOTARYTOOL_PROFILE or APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD to enable)."
  fi

  if [[ $notarized -eq 1 ]]; then
    require_binary xcrun
    log "Stapling notarization ticket..."
    xcrun stapler staple "$DMG_NAME"
  fi
}

cleanup() {
  [[ -n "${TMP_DMG:-}" && -f "$TMP_DMG" ]] && rm -f "$TMP_DMG"
  [[ -n "${TMP_DIR:-}" && -d "$TMP_DIR" ]] && rm -rf "$TMP_DIR"
}
trap cleanup EXIT

sign_app

TMP_DIR=$(mktemp -d)
log "Using temp dir: $TMP_DIR"

cp -R "$APP_PATH" "$TMP_DIR/"
ln -s /Applications "$TMP_DIR/Applications"

CONTENT_SIZE_KB=$(du -sk "$TMP_DIR" | cut -f1)
BUFFER_KB=$((200 * 1024))
DMG_SIZE_KB=$((CONTENT_SIZE_KB + BUFFER_KB))
log "Content size: $((CONTENT_SIZE_KB / 1024)) MB; provisioning DMG size: $((DMG_SIZE_KB / 1024)) MB"

hdiutil create -srcfolder "$TMP_DIR" -volname "$VOLUME_NAME" -fs HFS+ \
  -fsargs "-c c=64,a=16,e=16" -format UDRW -size ${DMG_SIZE_KB}k "$TMP_DMG"

MOUNT_INFO=$(hdiutil attach -readwrite -noverify -noautoopen "$TMP_DMG")
MOUNT_DIR=$(echo "$MOUNT_INFO" | egrep '^/dev/' | sed 1q | awk '{print $3}')

if [[ -z "$MOUNT_DIR" ]]; then
  log "Failed to determine mount point:"
  echo "$MOUNT_INFO"
  exit 1
fi

log "Mounted at: $MOUNT_DIR"

osascript <<OSA || true
   tell application "Finder"
     tell disk "$VOLUME_NAME"
           open
           set current view of container window to icon view
           set toolbar visible of container window to false
           set statusbar visible of container window to false
           set the bounds of container window to {400, 100, 900, 440}
           set theViewOptions to the icon view options of container window
           set arrangement of theViewOptions to not arranged
           set icon size of theViewOptions to 100
           set position of item "$APP_NAME" of container window to {125, 180}
           set position of item "Applications" of container window to {375, 180}
           update without registering applications
           delay 2
     end tell
   end tell
OSA

if [[ -n "$MOUNT_DIR" ]]; then
  hdiutil detach "$MOUNT_DIR"
fi

hdiutil convert "$TMP_DMG" -format UDZO -imagekey zlib-level=9 -o "$DMG_NAME"

sign_dmg
notarize_and_staple

log "Created DMG:"
ls -lh "$DMG_NAME"
