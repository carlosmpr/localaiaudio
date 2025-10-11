# PrivateAI - Quick Start Guide

## Prerequisites

Before running the app, ensure you have:

1. **Node.js** (v18 or later) - https://nodejs.org/
2. **Rust** - https://rustup.rs/
3. **macOS** (you're on macOS based on the system info)

## Installation & First Run

### Step 1: Run the Setup Script

```bash
chmod +x scripts/setup_and_run.sh

# Default: combined dev build (both runtimes exposed)
bash scripts/setup_and_run.sh

# Ollama-only build
bash scripts/setup_and_run.sh ollama

# Python sidecar build
bash scripts/setup_and_run.sh python
```

This script will:
- ✓ Check for Node.js, npm, and Rust
- ✓ Install npm dependencies
- ✓ Verify Tauri configuration
- ✓ Build the Rust backend (first time takes 5-10 minutes)
- ✓ Launch the PrivateAI desktop app

### Step 2: First Launch - What to Expect

When the app opens, you'll see:

1. **Hardware Scan** - Automatically detects your CPU, RAM, GPU, and disk
2. **Status Log** - Real-time updates on what's happening
3. **Ollama Check** - The app checks if Ollama is installed

### Step 3: Install Ollama (if needed)

If Ollama is not installed:

**Option A: Install via the App (macOS/Linux)**
- Click the "Install Ollama" button in the app
- Wait for the download and installation to complete
- **Important**: You may need to manually launch Ollama from Applications after installation

**Option B: Install Manually (Recommended for macOS)**
- Visit https://ollama.com/download
- Download Ollama for macOS
- Install and launch it
- Restart the PrivateAI app

**For macOS Users**: After installing Ollama, make sure to:
1. Open the Ollama.app from your Applications folder
2. You should see the Ollama icon in your menu bar
3. Then restart the PrivateAI app

### Step 4: Pull an AI Model

Once Ollama is running:

1. Click the "Pull Model" button
2. Enter a model name (recommendations below)
3. Wait for the download (this can take several minutes depending on model size)

**Recommended Models for First Time:**

| Model | Size | RAM Needed | Best For |
|-------|------|------------|----------|
| `phi3:mini` | ~2GB | 6GB+ | Fast, lightweight, good for testing |
| `llama3.1:8b` | ~5GB | 12GB+ | Balanced performance and quality |
| `gemma2:2b` | ~1.5GB | 4GB+ | Very fast, smaller responses |

**To pull a model**, you can also use terminal:
```bash
ollama pull phi3:mini
```

### Step 5: Start Chatting!

Once a model is pulled:
- Select the model from the dropdown (if you have multiple)
- Type your message in the chat box
- Click "Send" or press Enter
- The AI will respond using your local model!

## Troubleshooting

### "Ollama service is not running"

**Solution**:
```bash
# Start Ollama service manually
ollama serve
```

Or on macOS, launch the Ollama app from Applications.

### "Failed to pull model"

**Check**:
1. Is Ollama running? Check with: `ollama list`
2. Do you have internet? (needed for initial model download)
3. Do you have enough disk space?

### "Rust compilation errors"

**Solution**:
```bash
# Update Rust
rustup update

# Clean and rebuild
cd src-tauri
cargo clean
cd ..
bash scripts/setup_and_run.sh
```

### App won't start

**Check**:
1. All prerequisites installed?
2. Try running: `npm run tauri:dev` directly
3. Check logs in the terminal for specific errors

## Manual Commands

If you prefer to run commands manually:

```bash
# Install dependencies
npm install

# Start the web-only server (legacy MVP HTTP backend)
npm run dev

# Desktop app builds
npm run tauri:dev          # combined runtime (default features)
npm run tauri:dev:ollama   # Ollama-only edition
npm run tauri:dev:python   # Python sidecar edition

# Production installers
npm run tauri:build        # combined runtime (default features)
npm run tauri:build:ollama # Ollama installer
npm run tauri:build:python # Python installer
```

## What Gets Installed

The app creates this directory structure in your home folder:

```
~/PrivateAI/
├── Chats/      # Your conversation history (JSONL files)
├── Config/     # App configuration
├── Models/     # (Future) Custom model storage
├── Logs/       # Application logs
└── Index/      # (Future) RAG document index
```

## Privacy Notes

✓ **100% Local** - All AI processing happens on your machine
✓ **No Cloud** - No data sent to external servers (except initial model download)
✓ **Your Data** - All chats stored locally in `~/PrivateAI/Chats`
✓ **Offline Capable** - Works completely offline after setup

## Next Steps

Once you're up and running:

1. Try different models to find what works best for your hardware
2. Your chat history is automatically saved
3. Explore the status log to understand what's happening under the hood
4. Optional: test the embedded Python runtime (Version 2) by installing the dependencies in `python/README.md` and choosing the **Python llama.cpp sidecar** option in the wizard.

## Getting Help

If you encounter issues:

1. Check the Status panel in the app for error messages
2. Look at terminal output for detailed logs
3. Make sure Ollama is running: `ollama list`
4. Try restarting both Ollama and the app

## Performance Tips

- **Slower responses?** Try a smaller model (phi3:mini, gemma2:2b)
- **Have a GPU?** The app auto-detects and uses it when available
- **Low on RAM?** Stick to models under 5GB (check with `ollama list`)

---

Enjoy your private AI assistant! 🔒
