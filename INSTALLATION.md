# PrivateAI - Installation Guide

## 🚀 Quick Start (Python Runtime - Recommended for Distribution)

This guide will help you build and install PrivateAI on a fresh PC with **zero prerequisites**. The app will automatically download and configure everything needed.

---

## 📦 Building the Installer

### Prerequisites for Building
- **Rust** (for building only): https://rustup.rs/
- **Node.js** 16+ (for building only): https://nodejs.org/
- **Python 3.8+** (will be detected/prompted during first run)

### Build Steps

```bash
# 1. Clone the repository
git clone <your-repo>
cd privateai

# 2. Install Node dependencies
npm install

# 3. Build the production app (Python runtime only)
npm run tauri build -- --features runtime-python

# The installer will be created in:
# - macOS: src-tauri/target/release/bundle/dmg/
# - Windows: src-tauri/target/release/bundle/msi/
# - Linux: src-tauri/target/release/bundle/deb/ or .appimage
```

---

## 🖥️ Installing on a Fresh PC

### What Gets Installed Automatically:
1. ✅ **Python virtual environment** (`~/.privateai-venv/`)
2. ✅ **llama-cpp-python** with GPU acceleration (Metal/CUDA)
3. ✅ **AI Model** (Gemma 2B ~1.6GB)
4. ✅ **Storage directories** (`~/PrivateAI/Models`, `~/PrivateAI/Chats`, etc.)

### First-Run Setup (User Experience):

1. **Install the app** from the .dmg, .msi, or .deb package
2. **Launch PrivateAI**
3. The setup wizard will:
   - Detect your hardware
   - Check for Python (prompts to install if missing)
   - Create a virtual environment at `~/.privateai-venv/`
   - Install llama-cpp-python with GPU support
   - Download the default AI model (Gemma 2B, ~1.6GB)
   - Configure storage in `~/PrivateAI/`

4. **Start chatting!** 🎉

---

## 🔧 Manual Python Setup (If Needed)

If the automatic installer fails, you can manually set up Python dependencies:

```bash
# Run the included installer script
python3 python/install_dependencies.py

# Or manually:
python3 -m venv ~/.privateai-venv
source ~/.privateai-venv/bin/activate  # On Windows: .privateai-venv\\Scripts\\activate
pip install --upgrade pip

# macOS (with Metal GPU):
CMAKE_ARGS="-DLLAMA_METAL=on" pip install llama-cpp-python>=0.2.90

# Linux (with CUDA):
CMAKE_ARGS="-DLLAMA_CUBLAS=on" pip install llama-cpp-python>=0.2.90

# Windows or CPU-only:
pip install llama-cpp-python>=0.2.90
```

---

## 📥 Model Download

The app automatically downloads **Gemma 2B Instruct (Q4_K_M)** during setup.

### Manual Model Download (Optional):
If you prefer a different model, download a GGUF file and place it in:
```
~/PrivateAI/Models/your-model.gguf
```

**Recommended Models:**
- [Gemma 2B Instruct](https://huggingface.co/lmstudio-community/gemma-2-2b-it-GGUF) (~1.6GB)
- [Phi-3 Mini](https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf) (~2.3GB)
- [Qwen 2.5 3B](https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF) (~2GB)

---

## 🛠️ Build Configuration

### Python-Only Runtime (Recommended for Distribution)
```bash
# Build with only Python runtime (no Ollama)
npm run tauri build -- --features runtime-python --no-default-features
```

This creates a smaller, more portable installer that:
- ✅ Works on any PC
- ✅ No external dependencies (Ollama)
- ✅ Fully self-contained
- ✅ Automatic model download

### Development Mode
```bash
# Run in dev mode
npm run tauri dev

# Or with Python runtime only
npm run tauri dev -- --features runtime-python --no-default-features
```

---

## 📂 Directory Structure (After Installation)

```
~/PrivateAI/
├── Models/              # AI models (GGUF files)
├── Chats/               # Conversation history
├── Logs/                # Application logs
├── Config/              # App configuration
└── Index/               # (Reserved for future features)

~/.privateai-venv/       # Python virtual environment
```

---

## 🔍 Troubleshooting

### App won't start
- Check logs: `~/PrivateAI/Logs/python-sidecar.log`
- Ensure Python 3.8+ is installed: `python3 --version`
- Try manual Python setup (see above)

### Model download fails
- Check internet connection
- Download manually from HuggingFace (links above)
- Place in `~/PrivateAI/Models/`

### Python dependencies fail
- Run manual install script: `python3 python/install_dependencies.py`
- Check build tools: `gcc --version` (Linux/macOS), Visual Studio (Windows)

### GPU not detected
- **macOS**: Should work automatically on M1/M2/M3
- **Linux**: Ensure CUDA toolkit is installed
- **Windows**: CPU-only by default (CUDA requires manual setup)

---

## 🎯 Testing the Installer

### On a Virtual Machine or Fresh PC:
1. Install the .dmg/.msi/.deb package
2. Launch PrivateAI
3. Follow the setup wizard
4. Verify model downloads
5. Test chat functionality

### Expected First-Run Time:
- **Python setup**: 2-5 minutes
- **Model download**: 5-15 minutes (depends on internet speed)
- **Total**: ~10-20 minutes for complete setup

---

## 📋 System Requirements

**Minimum:**
- **OS**: macOS 10.15+, Windows 10+, or Linux (Ubuntu 20.04+)
- **RAM**: 4GB (8GB recommended)
- **Disk**: 5GB free space
- **Internet**: Required for first-time setup

**Recommended:**
- **RAM**: 8GB+
- **GPU**: Apple Silicon (M1/M2/M3) or NVIDIA GPU with CUDA
- **Disk**: 10GB+ for multiple models

---

## 🚢 Distribution Checklist

Before distributing the installer:

- [ ] Build with `--features runtime-python --no-default-features`
- [ ] Test on fresh VM without Python installed
- [ ] Verify automatic model download works
- [ ] Check chat functionality with downloaded model
- [ ] Test on all target platforms (macOS/Windows/Linux)
- [ ] Include this INSTALLATION.md in the release
- [ ] Sign the installer (macOS/Windows)

---

## 📞 Support

For issues or questions:
- Check logs: `~/PrivateAI/Logs/`
- GitHub Issues: [your-repo-issues-url]
- Documentation: [your-docs-url]

---

**Built with ❤️ by CaribbeanTechS**
