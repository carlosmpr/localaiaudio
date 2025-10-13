#!/bin/bash
set -e

APP_PATH="src-tauri/target/release/bundle/macos/PrivateAI.app"
DMG_NAME="PrivateAI_Installer.dmg"
VOLUME_NAME="PrivateAI Installer"
TMP_DMG="tmp_${DMG_NAME}"

# Create temporary directory
TMP_DIR=$(mktemp -d)
echo "Using temp dir: $TMP_DIR"

# Copy app to temp directory
cp -R "$APP_PATH" "$TMP_DIR/"

# Create symbolic link to Applications
ln -s /Applications "$TMP_DIR/Applications"

# Create temporary DMG
hdiutil create -srcfolder "$TMP_DIR" -volname "$VOLUME_NAME" -fs HFS+ \
    -fsargs "-c c=64,a=16,e=16" -format UDRW -size 1g "$TMP_DMG"

# Mount the temporary DMG
MOUNT_DIR=$(hdiutil attach -readwrite -noverify -noautoopen "$TMP_DMG" | \
    egrep '^/dev/' | sed 1q | awk '{print $3}')

echo "Mounted at: $MOUNT_DIR"

# Set window position and icon size
echo '
   tell application "Finder"
     tell disk "'$VOLUME_NAME'"
           open
           set current view of container window to icon view
           set toolbar visible of container window to false
           set statusbar visible of container window to false
           set the bounds of container window to {400, 100, 900, 440}
           set theViewOptions to the icon view options of container window
           set arrangement of theViewOptions to not arranged
           set icon size of theViewOptions to 100
           set position of item "PrivateAI.app" of container window to {125, 180}
           set position of item "Applications" of container window to {375, 180}
           update without registering applications
           delay 2
     end tell
   end tell
' | osascript || true

# Unmount
hdiutil detach "$MOUNT_DIR"

# Convert to compressed DMG
hdiutil convert "$TMP_DMG" -format UDZO -imagekey zlib-level=9 -o "$DMG_NAME"

# Clean up
rm -f "$TMP_DMG"
rm -rf "$TMP_DIR"

echo "Created: $DMG_NAME"
ls -lh "$DMG_NAME"
