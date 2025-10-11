# CaribbeanTechS – Private AI Assistant

Private, on-device AI that installs in one click, optimizes for your hardware, and keeps every conversation local.

## Core Promise
> Private AI -- no cloud, no data sharing. Everything runs on your machine.

## Table of Contents
- [Product Goals](#product-goals)
- [Tech Stack](#tech-stack)
- [Running the MVP](#running-the-mvp)
- [System Overview](#system-overview)
- [User Journey](#user-journey)
- [Hardware Detection](#hardware-detection)
- [Model Catalog and Recommendation Logic](#model-catalog-and-recommendation-logic)
- [Installation Workflow](#installation-workflow)
- [Chat Interface](#chat-interface)
- [Local Storage and Security](#local-storage-and-security)
- [Packaging and Distribution](#packaging-and-distribution)
- [Team Roles](#team-roles)
- [Development Milestones](#development-milestones)
- [Future Add-ons](#future-add-ons)
- [Flow Diagram](#flow-diagram)
- [License](#license)

## Product Goals

- Deliver a fully offline ChatGPT-style assistant with zero telemetry.
- Detect the user's hardware automatically and choose the best-fitting local LLM.
- Provide a smooth installer experience across Windows, macOS, and Linux.
- Persist chats, settings, and model assets locally for easy backup and portability.

## Tech Stack

### Core Choice
- Tauri (Rust + WebView) with React delivers a small, secure, cross-platform binary and installer surface.
- Rust backend commands manage native operations, while the WebView hosts the ChatGPT-style UI.

### Desktop App and UI
- React drives the conversational interface; Svelte stays an option for lighter builds.
- Tailwind CSS accelerates theming, dark mode, and layout consistency.
- JSONL files hold chat transcripts; SQLite via `tauri-plugin-sql` powers optional search.

### Hardware Scan and Orchestration
- Rust commands use `sysinfo` plus OS-specific helpers (WMI, `system_profiler`, `lspci`, `nvidia-smi`) to profile CPU, GPU, RAM, and disk.
- Model selection consults the curated catalog JSON (minimums vs. optimal specs) to recommend the best fit.
- Process orchestration starts and health-checks Ollama on `http://localhost:11434`.

### LLM Runtime and Model Delivery
- Ollama provides the local inference runtime with native installers per OS.
- First-run workflow silently installs Ollama, then calls `/api/pull` to download the recommended model while streaming progress.
- Networking binds to `127.0.0.1` to preserve offline privacy.
- Optional Python sidecar (Version 2) loads GGUF models via `llama-cpp-python`, giving a daemon-free alternative for bundled installers.

### Installers, Updates, and Signing
- Windows bundles ship as MSI (WiX under the hood) or optional MSIX with EV code signing.
- macOS builds target DMG, notarized with Apple Developer ID; Tauri updater handles delta releases.
- Linux outputs AppImage or `.deb`, packaging dependencies and preflight checks.
- App auto-updates ride the Tauri updater service; models update on demand through the UI.
- Dual editions supported via feature flags and configs: `npm run tauri:build:ollama` for the native Ollama installer, `npm run tauri:build:python` for the llama-cpp Python sidecar.

### Background Service Hardening (Optional)
- Windows can register a helper service or rely on per-user startup.
- macOS LaunchAgents and Linux systemd user units keep Ollama available across sessions.

### Privacy, Logging, and Diagnostics
- Default posture is zero telemetry; any future collection requires explicit opt-in.
- Local rotating logs (Rust `tracing`) capture diagnostics; an in-app screen exposes summaries and copyable reports.
- Encryption at rest leverages OS keychains plus libsodium when user passphrases are enabled.

### Optional Add-ons
- Local RAG uses embedded Qdrant or SQLite vectors with Ollama embeddings.
- Vision support targets `llama3.2-vision`; voice features rely on Whisper or faster-whisper.
- Custom model import accepts `.gguf` and `.ggml` packages dropped into the Models folder.

### Platform Notes
- macOS prioritizes Metal/MPS acceleration with native Ollama builds.
- Windows detects CUDA vs. DirectML and falls back to CPU if needed.
- Linux balances CUDA when present and keeps CPU-only mode ready, bundling OpenCL or libc++ where required.

### Team Skills Snapshot
- Rust and Tauri expertise for orchestration and installer plumbing.
- React-focused frontend talent for the chat UI.
- Release engineering covering signing, notarization, and hosted updates.
- QA capable of multi-OS validation across GPU and CPU permutations.

## Running the MVP

The current prototype focuses on backend orchestration and a lightweight local chat interface backed by stubbed services.

```bash
# Make the helper executable the first time.
chmod +x scripts/setup_and_run.sh

# Launch the combined dev build (both runtimes available).
bash scripts/setup_and_run.sh

# Launch the Ollama-only edition.
bash scripts/setup_and_run.sh ollama

# Launch the Python llama.cpp sidecar edition.
bash scripts/setup_and_run.sh python
```

> The helper script expects a full Tauri project at `src-tauri/`. If those files are not present yet, it will stop after provisioning the installer workspace.

> The execution sandbox used for development may block opening listening ports; if you encounter permission errors, run the command outside the restricted environment. The server serves `public/index.html`, offering a two-pane interface with hardware info and a stubbed chat.

Running inside the desktop shell launches a first-run wizard that:
- Detects local hardware and prepares the `~/PrivateAI` directory tree.
- Checks for a native Ollama installation (installing silently when missing).
- Starts the Ollama service, pulls the selected model, and saves configuration.
- Opens the chat interface bound directly to Ollama’s REST API.
- Optionally starts an embedded Python sidecar (llama-cpp) when the **Python llama.cpp sidecar** runtime is selected.

### Runtime options

- **Ollama (default):** Full integration with the native daemon, streamed responses, and automatic model pulls.
- **Python sidecar (Version 2):** Runs GGUF models via `llama-cpp-python` without requiring Ollama.
  1. Install the dependencies listed in `python/requirements.txt` (preferably inside a virtualenv).
  2. Download a GGUF model (e.g., `gemma-1b-it-q4_0.gguf`) into `~/PrivateAI/Models`.
  3. Choose **Python llama.cpp sidecar** in the wizard; the app will start the sidecar and verify health.
  See `python/README.md` for detailed instructions and environment variables.

## System Overview

| Component               | Responsibilities                                                   |
| ----------------------- | ------------------------------------------------------------------ |
| Installer and Scanner   | Detect operating system and hardware, install prerequisites, verify resources. |
| Model Manager           | Map specs to a curated catalog and download the best model.        |
| Runtime Engine (Ollama) | Serve local inference on `localhost:11434`.                        |
| App Controller          | Orchestrate setup, start and stop services, updates, and logging.  |
| Chat UI                 | Provide a ChatGPT-style interface with history, streaming, and settings. |
| Local Storage Layer     | Store chats, configs, logs, and cached models under `~/PrivateAI/`. |

## User Journey

1. **Download Installer**
2. **System Scan** -- Collect OS, RAM, GPU, VRAM, disk, and network status.
3. **Model Recommendation** -- Display recommended model with option to override.
4. **Install Ollama and Model** -- Download dependencies, show progress, verify checksums.
5. **Verification and Setup Complete** -- Validate services and write config.
6. **Launch Chat UI** -- Start the local server and open the desktop client.
7. **Auto-save Chats** -- Persist conversations as JSONL under `~/PrivateAI/Chats`.

## Hardware Detection

The scanner matches user systems with compatible models by collecting:

- Operating system (Windows, macOS, or Linux)
- CPU vendor and core count
- GPU vendor and VRAM capacity
- Total RAM
- Free disk space
- Network availability

Example output:

```json
{
  "os": "Windows 11",
  "ram_gb": 16,
  "gpu": "NVIDIA RTX 3060",
  "vram_gb": 8,
  "disk_free_gb": 150
}
```

## Model Catalog and Recommendation Logic

| Model            | Min RAM | GPU VRAM | Disk | Use Case          |
| ---------------- | ------- | -------- | ---- | ----------------- |
| phi3:mini        | 6 GB    | --       | 3 GB | Lightweight chat  |
| llama3.1:8b      | 12 GB   | 6 GB     | 5 GB | Balanced default  |
| deepseek-r1:7b   | 16 GB   | 8 GB     | 6 GB | Reasoning focus   |
| llama3.1:70b     | 32 GB   | 24 GB    | 40 GB | Power user mode |

The selector scores every model by meeting minimum requirements, preferring optimal matches, and prioritizing higher-quality options within the device's limits.

## Installation Workflow

1. **Install Ollama**
   - Download if missing and perform a silent install.
   - Start the Ollama service.
2. **Download Recommended Model**
   - Stream with progress reporting and checksum validation.
   - Cache model artifacts under `~/PrivateAI/Models`.
3. **Configure Application**
   - Write config to `~/PrivateAI/Config/app.json`.
   - Prepare folder tree:

```
~/PrivateAI/
├── Chats/
├── Config/
├── Models/
├── Logs/
└── Index/
```

## Chat Interface

- ChatGPT-style layout with sidebar history and markdown rendering.
- Streaming responses, code block formatting, and model switcher.
- "Open Chats Folder" shortcut and settings modal for theme, privacy, and model options.
- Messages stored as JSONL lines, for example:

```json
{"role":"user","content":"Explain RAG."}
{"role":"assistant","content":"RAG retrieves documents and answers with grounded context."}
```

## Local Storage and Security

- JSONL per conversation with optional SQLite index for search.
- Optional encryption at rest via the local keychain or OS-provided vault.
- Application runs offline by default and prompts the user before any external connection.
- No telemetry; licenses are shown before model downloads.

## Packaging and Distribution

| Platform | Format        | Notes                                      |
| -------- | ------------- | ------------------------------------------ |
| Windows  | `.msi` / `.exe` | Bundle Ollama installer and runtime dependencies. |
| macOS    | `.dmg`        | Signed and notarized build.                |
| Linux    | `.AppImage` / `.deb` | Include preflight dependency checks. |

Updates: optional auto-update for the application; manual model updates via the Settings screen.

## Team Roles

| Role                 | Responsibilities                                                   |
| -------------------- | ------------------------------------------------------------------ |
| Product Designer     | UX flows, copy, installer screens.                                 |
| Frontend Developer   | Desktop UI, chat rendering, settings, and interaction polish.      |
| Backend/Infra Dev    | Hardware scan, Ollama orchestration, configuration management.     |
| DevOps               | Build and sign installers, manage update channels and CI/CD.       |
| QA                   | Cross-platform testing and fallback validation.                    |

## Development Milestones

| Phase | Deliverable                                   | Duration |
| ----- | --------------------------------------------- | -------- |
| 1     | MVP with fixed model and basic chat           | 2 weeks  |
| 2     | Automated detection and installer flow        | +1 week  |
| 3     | Polished UX, local storage, update mechanisms | +2 weeks |
| 4     | Optional enhancements (RAG, encryption, voice, vision) | Ongoing |

## Future Add-ons

- Offline RAG over local documents.
- Vision model support (for example, llama3.2-vision).
- Local voice input and output pipeline.
- Multi-user profiles.
- Custom model import for `.gguf` and `.ggml` formats.

## Development Notes

- Early backend work includes a stubbed hardware scanner at `src/hardware/hardwareScanStub.js`, returning canned specs while real detection is under development.
- The stub feeds an HTTP-compatible handler at `src/api/hardwareHandler.js`, allowing quick integration with a prototype server.
- `src/installer/runInstaller.js` orchestrates the stubbed hardware scan, storage layout creation, runtime bootstrap, and config writing for local testing.
- `src/ollama/ollamaBootstrap.js` simulates Ollama installation, service start, and model pulls while real integrations are pending.
- `python/sidecar.py` hosts the Version 2 llama-cpp runtime; the Tauri shell can start/stop this sidecar when the Python backend is selected.
- The Tauri shell (`src-tauri/src`) exposes commands for setup and chat, and `public/app.js` drives the first-run wizard with streaming responses directly from Ollama.

## Flow Diagram

```
+---------------------------+
|       App Installer       |
+-------------+-------------+
              |
              v
+---------------------------+
|      Hardware Scanner     |
+-------------+-------------+
              |
              v
+---------------------------+
|   Model Selector Engine   |
+-------------+-------------+
              |
              v
+---------------------------+
| Install Ollama and Model  |
+-------------+-------------+
              |
              v
+---------------------------+
|   Start Local Server      |
|     (localhost:11434)     |
+-------------+-------------+
              |
              v
+---------------------------+
|    Chat UI (Desktop)      |
+-------------+-------------+
              |
              v
+---------------------------+
|   Save Chats Locally      |
|    ~/PrivateAI/Chats      |
+---------------------------+
```

## License

TBD -- evaluate licensing for bundled models and open source dependencies.
