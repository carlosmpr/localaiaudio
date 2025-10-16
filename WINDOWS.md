# Building PrivateAI for Windows

This guide explains how to build and run PrivateAI on Windows.

## Prerequisites

### 1. Install Rust

```powershell
# Using winget (Windows Package Manager)
winget install Rustlang.Rust.MSVC

# OR download from: https://rustup.rs/
```

**Important:** Install the **MSVC** toolchain (not GNU). This is required for Tauri.

### 2. Install Node.js

```powershell
# Using winget
winget install OpenJS.NodeJS

# OR download from: https://nodejs.org/
```

### 3. Install Visual Studio Build Tools

Tauri requires C++ build tools:

```powershell
# Using winget
winget install Microsoft.VisualStudio.2022.BuildTools

# OR download from: https://visualstudio.microsoft.com/downloads/
```

During installation, select:
- ✅ **Desktop development with C++**
- ✅ **Windows 10 SDK** (or Windows 11 SDK)

### 4. Install WebView2 Runtime

Most Windows 11 systems already have this, but if needed:

```powershell
winget install Microsoft.EdgeWebView2Runtime

# OR download from: https://developer.microsoft.com/microsoft-edge/webview2/
```

## Building the Application

### Step 1: Clone/Copy the Project

If you're transferring from macOS:
1. Copy the entire `privateai` folder to your Windows PC
2. Or clone from Git repository

### Step 2: Install Dependencies

Open **PowerShell** or **Command Prompt** and navigate to the project:

```powershell
cd path\to\privateai
npm install
```

### Step 3: Build for Windows

```powershell
npm run tauri build
```

This will:
- Compile the Rust backend
- Bundle the frontend
- Include the llama3.2-1b.gguf model (automatically downloaded if not present)
- Create Windows installers

### Build Output

After successful build, you'll find installers in:

```
src-tauri\target\release\bundle\
├── nsis\
│   └── PrivateAI_0.1.0_x64-setup.exe    # NSIS installer (recommended)
└── msi\
    └── PrivateAI_0.1.0_x64_en-US.msi    # MSI installer
```

**Recommended:** Use the `.exe` installer for easier installation.

## Development Mode

To run in development mode with hot reload:

```powershell
npm run tauri dev
```

This starts the app without building installers (faster for testing).

## Model Information

The app uses an **embedded runtime** with:
- **Model:** Llama 3.2 1B Instruct (llama3.2-1b.gguf)
- **Size:** ~1.2 GB
- **Location (bundled):** Included in the app bundle
- **Location (downloaded):** `%USERPROFILE%\PrivateAI\Models\`

The model will be:
1. First, try to use the bundled model (recommended)
2. If not bundled, check `%USERPROFILE%\PrivateAI\Models\`
3. If missing, download automatically on first run

## System Requirements

### Minimum:
- **OS:** Windows 10 (version 1809+) or Windows 11
- **RAM:** 4 GB (8 GB recommended for better performance)
- **Disk:** 2 GB free space
- **Processor:** x64 architecture (Intel or AMD)

### Recommended:
- **RAM:** 8 GB or more
- **Disk:** 5 GB free space for conversations and logs
- **GPU:** Not required, but any modern CPU works

## Context Window Sizes

The app automatically adjusts based on available RAM:

| System RAM | Context Window |
|-----------|----------------|
| 16 GB+    | 120,000 tokens |
| 8-16 GB   | 60,000 tokens  |
| 4-8 GB    | 30,000 tokens  |

## Automatic Context Management

The app now includes **automatic context management**:

✅ **Never crashes** - automatically trims old messages when approaching limit
✅ **Infinite conversations** - keeps only recent messages that fit in context
✅ **Smart trimming** - maintains 75% of context limit for optimal performance
✅ **Transparent** - no user confirmations needed

This works exactly like Claude - the conversation can continue indefinitely!

## First Run Setup

1. **Install** the app using the `.exe` or `.msi` installer
2. **Launch** PrivateAI from Start Menu or Desktop
3. **Setup Wizard** runs automatically:
   - Detects hardware
   - Creates storage folders in `%USERPROFILE%\PrivateAI\`
   - Loads embedded model (or downloads if needed)
   - Launches chat interface

## Storage Locations

All app data is stored in:
```
%USERPROFILE%\PrivateAI\
├── Chats\          # Conversation history
├── Config\         # App configuration
├── Models\         # AI models (if downloaded)
├── Logs\           # Application logs
└── Index\          # Search index (future feature)
```

To reset the app, delete the `Config\app.json` file.

## Troubleshooting

### Build Errors

**Error: "MSVC not found"**
```
Solution: Install Visual Studio Build Tools with C++ workload
```

**Error: "Failed to build native modules"**
```
Solution: Ensure Rust MSVC toolchain is installed:
  rustup toolchain install stable-x86_64-pc-windows-msvc
  rustup default stable-x86_64-pc-windows-msvc
```

**Error: "WebView2 not found"**
```
Solution: Install WebView2 Runtime:
  winget install Microsoft.EdgeWebView2Runtime
```

### Runtime Errors

**App won't start:**
1. Check Windows Event Viewer for error details
2. Check logs: `%USERPROFILE%\PrivateAI\Logs\privateai.log`
3. Try deleting `%USERPROFILE%\PrivateAI\Config\app.json` and restart

**Model loading fails:**
1. Verify model file exists: `%USERPROFILE%\PrivateAI\Models\llama3.2-1b.gguf`
2. Check file size: should be ~1.2 GB
3. Re-download if corrupted

**Context overflow errors:**
- The app now handles this automatically
- If you see errors, try starting a new conversation
- Check that auto-cleanup is enabled (default)

## Performance Tips

1. **Close background apps** to free RAM
2. **Use SSD** for faster model loading
3. **Disable antivirus scanning** for `%USERPROFILE%\PrivateAI\` folder
4. **Increase virtual memory** if RAM is low (Windows Settings > System > About > Advanced system settings)

## Building for Distribution

To create a portable/distributable version:

```powershell
# Build release version
npm run tauri build

# The .exe installer can be distributed
# Users just need to run it - no dependencies required
```

The installer bundles everything needed except system prerequisites (WebView2, which most Windows 11 systems have).

## Comparing with macOS Build

| Feature | Windows | macOS |
|---------|---------|-------|
| Installer | `.exe` / `.msi` | `.dmg` / `.app` |
| Build time | ~3-5 min | ~2-4 min |
| Model location | `%USERPROFILE%\PrivateAI\Models\` | `~/PrivateAI/Models/` |
| Context size | Up to 120k tokens | Up to 120k tokens |
| GPU acceleration | CPU only | Metal (Apple Silicon) |

## Advanced: Custom Build Options

### Build with specific target

```powershell
# For x64 Windows (default)
npm run tauri build -- --target x86_64-pc-windows-msvc

# For ARM64 Windows (experimental)
npm run tauri build -- --target aarch64-pc-windows-msvc
```

### Debug build

```powershell
npm run tauri build -- --debug
```

### Skip bundling (faster iteration)

```powershell
cargo build --release --manifest-path=src-tauri/Cargo.toml
```

## Support & Issues

If you encounter issues:
1. Check `%USERPROFILE%\PrivateAI\Logs\privateai.log`
2. Review Windows Event Viewer
3. Open an issue on GitHub with:
   - Windows version
   - Error logs
   - Steps to reproduce

## Next Steps

After building:
1. ✅ Test the installer
2. ✅ Verify model loads correctly
3. ✅ Test chat functionality
4. ✅ Try long conversations (automatic context management)
5. ✅ Check markdown rendering and code highlighting

Enjoy your private, offline AI assistant! 🚀
