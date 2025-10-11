# Option C – Embedded llama.cpp Runtime

This third delivery option removes both Ollama *and* Python from the dependency chain.  
Instead, the Tauri backend links directly against `llama.cpp`, so the installer ships a self-contained
inference engine that loads GGUF models on launch.

## Why choose this?

- **Single binary:** No separate daemon or interpreter. Users install once and everything just works.
- **Consistent footprint:** You control the exact llama build (Metal/CUDA/DirectML/CPU) per platform.
- **Lower friction:** No prompts to install Python or Ollama; the bundled runtime handles everything.

## Architecture Overview

```
┌───────────────────────────────────────────────────┐
│                 Tauri (Rust + WebView)            │
│  ┌───────────────┐  ┌──────────────────────────┐  │
│  │ Hardware Scan │  │ Model Catalog & Download │  │
│  └─────┬─────────┘  └────────────┬─────────────┘  │
│        │                         │                │
│  ┌─────▼─────────┐  ┌────────────▼─────────────┐  │
│  │ llama.cpp FFI │◄─┤  Model Loader & Runtime  │  │
│  └─────┬─────────┘  └────────────┬─────────────┘  │
│        │                         │                │
│  ┌─────▼─────────┐  ┌────────────▼─────────────┐  │
│  │ Streaming API │  │ Chats / Config Persistence│ │
│  └─────┬─────────┘  └────────────┬─────────────┘  │
│        │                         │                │
│  ┌─────▼─────────┐               │                │
│  │ React / UI    │───────────────┘                │
└───────────────────────────────────────────────────┘
```

## Key Tasks

1. **Embed llama.cpp**
   - Use `llama-cpp-rs` or a custom FFI build to compile llama.cpp directly into the Rust backend.
   - Provide per-platform build flags (Metal, CUDA, DirectML, CPU fallback).

2. **Model management**
   - Extend the shared `model_catalog.json` with GGUF URLs + checksums.
   - Implement a Rust downloader that stores files under `~/PrivateAI/Models/`, with resume + SHA-256 verification.
   - Surface progress/events to the Tauri front-end.

3. **Inference pipeline**
   - Expose a Tauri command `chat_with_model` that:
     1. Loads (or reuses) the GGUF model.
     2. Streams tokens via `emit` to the front-end.
     3. Supports stop/tokens limits/context resets.

4. **GPU/HW detection**
   - Reuse the hardware scan to decide whether to initialize llama.cpp with GPU offloading.
   - Allow users to toggle GPU/CPU in settings.

5. **Installer output**
   - Build with `npm run tauri:build --features runtime-embedded` (see TODO below).
   - The generated DMG/MSI/AppImage contains the compiled llama runtime and no external dependencies.

## Testing Checklist

- [ ] macOS (Intel + Apple Silicon) – verify Metal or CPU fallback.
- [ ] Windows (NVIDIA vs. non-NVIDIA) – verify CUDA/DirectML options.
- [ ] Linux – verify CUDA and CPU builds; ensure required shared libs are bundled.
- [ ] First-run wizard downloads GGUF, loads model, streams chat.
- [ ] Chat persistence/timeouts behave the same as other editions.

## TODO to wire this option fully

- [ ] Add `runtime-embedded` feature flag in `Cargo.toml`.
- [ ] Vendor or submodule `llama.cpp` and compile via `build.rs`.
- [ ] Create `src-tauri/src/embedded_runtime.rs` with load/chat helpers.
- [ ] Extend the wizard UI to show “Embedded llama.cpp” choice when this build is active.
- [ ] Create `src-tauri/tauri.embedded.conf.json` and matching `npm run tauri:build:embedded`.
- [ ] Update documentation/quickstart with installer commands for this edition.

Once those pieces land, you’ll have three fully isolated installers:

1. **Ollama Edition** – native daemon, streamed REST.
2. **Python Edition** – llama-cpp sidecar using Python.
3. **Embedded Edition** – llama.cpp linked directly, no external runtime.
