#!/bin/bash
# Script to allow PrivateAI app to run on macOS
# Run this on the Mac where you installed the app

echo "=== PrivateAI - Allow App to Run ==="
echo ""

# Check if app exists
if [ ! -d "/Applications/PrivateAI.app" ]; then
    echo "❌ PrivateAI.app not found in /Applications/"
    echo "Please drag the app to Applications first."
    exit 1
fi

echo "Removing quarantine attributes..."
xattr -cr /Applications/PrivateAI.app

echo "✅ Quarantine removed!"
echo ""
echo "Now you can open the app by:"
echo "  1. Right-click PrivateAI.app in Applications"
echo "  2. Select 'Open' from the menu"
echo "  3. Click 'Open' in the dialog"
echo ""
echo "Or run: open /Applications/PrivateAI.app"
