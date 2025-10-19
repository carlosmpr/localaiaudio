# PrivateAI Voice – Offline Audio Transcription

PrivateAI Voice is a lightweight desktop app (Tauri + Rust + web view) that runs Whisper locally, converting audio files to text without touching the internet. Everything runs 100% offline on your machine.

## ✨ Features

- **🔒 100% Offline**: No internet required - all processing happens locally
- **🎵 Universal Audio Support**: MP3, MP4, M4A, WAV, OGG, FLAC, AAC, WMA, WEBM
- **⚡ Auto-Conversion**: FFmpeg bundled - automatically converts to optimal format (16kHz mono WAV)
- **🤖 Local AI**: Uses Whisper tiny model (77MB) for fast, accurate transcription
- **🎨 Clean UI**: Minimalist Notion-style black and white interface
- **📦 No Installation Required**: FFmpeg and Whisper model are bundled - just download and run
- **🌍 Multi-Language**: Support for English, Spanish, French, German, Italian, Portuguese, and more
- **💻 Cross-Platform**: macOS, Windows, Linux

## 🚀 How It Works

1. **Select Audio File** - Drop any audio/video file (MP3, MP4, etc.)
2. **Auto-Conversion** - FFmpeg converts to 16kHz mono WAV if needed
3. **AI Transcription** - Whisper processes the audio locally
4. **Get Text** - Copy or save your transcription

### Under the Hood

```
Audio File (any format)
    ↓
FFmpeg (bundled) - converts to 16kHz mono WAV
    ↓
Whisper AI Model (bundled) - transcribes speech
    ↓
Text Output - 100% offline
```

**Tech Stack:**
- **Frontend**: HTML/CSS/JavaScript (minimalist UI)
- **Backend**: Rust + Tauri (lightweight, secure)
- **AI Model**: Whisper tiny (ggml-tiny.bin, 77MB)
- **Audio Processing**: FFmpeg (bundled, 481KB)

## 📁 Project Structure

```
privateai-voice/
├── public/                      # Frontend UI
│   ├── index.html              # Main interface
│   ├── styles.css              # Notion-style CSS
│   └── app.js                  # UI logic
├── src-tauri/
│   ├── src/
│   │   ├── main.rs             # Tauri app entry point
│   │   └── transcription.rs    # Whisper + FFmpeg integration
│   ├── tauri.conf.json         # App configuration & bundling
│   └── Cargo.toml              # Rust dependencies
├── Models/
│   └── voice/
│       └── ggml-tiny.bin       # Whisper AI model (bundled)
└── binaries/
    └── macos/
        └── ffmpeg-aarch64-apple-darwin  # FFmpeg binary (bundled)
```

## 🛠️ Development Setup

### Prerequisites

- **Node.js** / npm (for building frontend)
- **Rust toolchain** with Cargo ([rustup.rs](https://rustup.rs))
- **Tauri CLI**: `cargo install tauri-cli`
- **macOS 11+**, Windows 10+, or modern Linux
- **FFmpeg** (development only): `brew install ffmpeg` (macOS)

### Download Whisper Model

```bash
# Download the Whisper tiny model
cd Models/voice
curl -L -o ggml-tiny.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin
```

### Run Development Server

```bash
npm install
npm run tauri:dev
```

The app will open with hot-reload enabled. Changes to frontend files reload instantly, Rust changes trigger rebuild.

## 📦 Building for Production

### Build Installers

```bash
npm run tauri:build
```

This creates platform-specific installers in `src-tauri/target/release/bundle/`:
- **macOS**: `.dmg` and `.app`
- **Windows**: `.msi` installer
- **Linux**: `.AppImage` and `.deb`

### What Gets Bundled

The production build automatically includes:
- ✅ Whisper model (`Models/voice/ggml-tiny.bin`) - 77MB
- ✅ FFmpeg binary (`binaries/macos/ffmpeg-aarch64-apple-darwin`) - 481KB
- ✅ All frontend assets (HTML/CSS/JS)

**Total app size: ~78MB** - Everything users need, zero external dependencies!

### Cross-Platform Builds

For Windows/Linux, add FFmpeg binaries to:
```
binaries/
├── macos/ffmpeg-aarch64-apple-darwin
├── windows/ffmpeg-x86_64-pc-windows-msvc.exe
└── linux/ffmpeg-x86_64-unknown-linux-gnu
```

Update `tauri.conf.json` to bundle all platforms.

## 🎯 Usage

### Basic Workflow

1. **Launch App** - Double-click the installed app
2. **Choose File** - Click "Choose file" and select your audio
   - Supports: MP3, MP4, M4A, WAV, OGG, FLAC, AAC, WMA, WEBM
   - Videos work too (extracts audio automatically)
3. **Select Language** (optional) - Choose from 10+ languages or use auto-detect
4. **Transcribe** - Click the button and wait (typically 1-2 minutes for 3-min audio)
5. **Copy/Export** - Copy to clipboard or save the text

### What Happens Automatically

- **Non-WAV files**: Auto-converted to 16kHz mono WAV using FFmpeg
- **Stereo audio**: Auto-converted to mono
- **Wrong sample rate**: Auto-resampled to 16kHz
- **Temp files**: Auto-cleaned up after transcription

## ⚙️ Configuration

### Change Whisper Model

Want better accuracy? Use a larger model:

1. Download model from [Whisper.cpp models](https://huggingface.co/ggerganov/whisper.cpp)
2. Replace `Models/voice/ggml-tiny.bin`
3. Update path in `src-tauri/src/transcription.rs:119`

**Model sizes:**
- `tiny` (77MB) - Fast, good for most use cases
- `base` (142MB) - Better accuracy
- `small` (466MB) - High accuracy
- `medium` (1.5GB) - Very high accuracy
- `large` (2.9GB) - Best accuracy (slower)

### Customize UI

Edit `public/styles.css` to change colors, fonts, or layout. The current theme is minimalist black and white inspired by Notion.

## 🔧 Troubleshooting

### "Model not found" error
- Ensure `Models/voice/ggml-tiny.bin` exists
- Check file size is ~77MB (not corrupted)

### "FFmpeg failed" error
- Verify `binaries/macos/ffmpeg-aarch64-apple-darwin` exists and is executable
- Try `chmod +x binaries/macos/ffmpeg-aarch64-apple-darwin`

### Transcription is inaccurate
- Use 16kHz mono WAV for best results
- Try a larger Whisper model (base, small, medium)
- Specify the correct language instead of auto-detect

### App is slow
- Whisper tiny is optimized for speed
- Larger models (base, small) are slower but more accurate
- Consider GPU acceleration (requires different Whisper build)

## 📋 Packaging & Distribution

### macOS

```bash
# Build
npm run tauri:build

# Sign (optional but recommended)
codesign --force --deep --sign "Developer ID Application: Your Name" "src-tauri/target/release/bundle/macos/PrivateAI Voice.app"

# Notarize (for distribution outside App Store)
xcrun notarytool submit "src-tauri/target/release/bundle/dmg/PrivateAI Voice_0.1.0_aarch64.dmg" \
  --apple-id "your@email.com" \
  --team-id "TEAMID" \
  --password "app-specific-password" \
  --wait
```

### Windows

- Code-sign the `.msi` installer for Windows SmartScreen
- Use a certificate from a trusted CA

### Linux

- Both `.AppImage` (universal) and `.deb` (Debian/Ubuntu) are created
- Consider `.rpm` for Fedora/RHEL users

## 🎨 Customization

### Product Name & Icons

Edit `src-tauri/tauri.conf.json`:
```json
{
  "package": {
    "productName": "Your App Name",
    "version": "1.0.0"
  },
  "tauri": {
    "bundle": {
      "identifier": "com.yourcompany.yourapp",
      "icon": [
        "icons/32x32.png",
        "icons/128x128.png",
        "icons/icon.icns",
        "icons/icon.ico"
      ]
    }
  }
}
```

### Add More Languages

Edit `public/index.html` to add language options:
```html
<option value="hi">Hindi</option>
<option value="ar">Arabic</option>
```

Full list: [Whisper supported languages](https://github.com/openai/whisper#available-models-and-languages)

## 📝 License

This project uses:
- **Whisper** - MIT License (OpenAI)
- **FFmpeg** - LGPL/GPL (see FFmpeg license)
- **Tauri** - MIT/Apache 2.0

Ensure compliance with all licenses when distributing.

## 🙏 Credits

- **Whisper** by OpenAI - Speech recognition AI
- **whisper.cpp** by ggerganov - C++ implementation
- **FFmpeg** - Audio processing
- **Tauri** - Desktop app framework

---

**Made with ❤️ for offline, privacy-focused AI transcription**
