# Possible Upgrades – Whisper Audio Transcription

## Current Status Snapshot
- Repository already contains Whisper scaffolding in `src-tauri/src/transcription.rs` with two execution paths:
  - `transcribe_with_api` posts audio to a Whisper-compatible server on `localhost:9000`.
  - `transcribe_with_embedded` (behind the `whisper-embedded` feature flag) loads a local GGML model via `whisper-rs`.
- No multi-window UI or Tauri command is currently wired for end users; front-end code does not surface transcription controls.
- Whisper model `Models/ggml-small.en.bin` is present locally but not yet bundled in release artifacts.

## Feasibility Assessment
- **Embedded Whisper**: `whisper-rs` supports GGML models (including `ggml-small.en.bin`). Builds succeed when adding the `whisper-embedded` feature and linking `whisper-rs`’ C dependencies. CPU-only; expect higher latency on large files.
- **Sidecar / API Mode**: Running `whisper.cpp` or `faster-whisper` as a service on `localhost` is compatible with the existing HTTP path. This option offloads audio conversion and allows GPU acceleration if the environment provides CUDA/Metal.
- **Multi-window Tauri UI**: Tauri 1.5 can spawn additional windows (`tauri::WindowBuilder`) with distinct HTML entry points. Adding a “Transcribe” window is feasible; keep in mind bundle size and asset shipping.
- **Plugin Path**: Packaging transcription as an internal plugin is realistic:
  - Tauri plugin exposing `start_transcription`, `list_devices`, etc.
  - Front-end registers the plugin API; allows reuse in other apps.
  - Alternatively, publish a companion CLI that the main app shells out to.
- **Shipping as separate app**: If audio features inflate the installer (models + FFMPEG), consider a separate “PrivateAI Voice” distribution sharing licensing/backend infrastructure but avoiding bloat for text-only customers.

## Suggested Upgrade Steps
1. **Gatekeep the feature**  
   - Expose a settings toggle (or license entitlement) to enable transcription.  
   - Decide whether Whisper ships to all users or only premium tiers; update bundle resources and license prompts accordingly.

2. **Model packaging**  
   - Add `Models/ggml-small.en.bin` (or a smaller alternative such as `ggml-base.en.bin`) to `tauri.conf.json` bundle resources so installers include it.  
   - Document RAM/CPU requirements; small model still needs ~1.5 GB RAM to run comfortably.

3. **Audio preprocessing**  
   - Embedded workflow currently assumes 16 kHz mono WAV. Integrate `hound` or `symphonia` to transcode arbitrary inputs (MP3, M4A) into the format Whisper expects.  
   - On macOS/Windows, consider bundling `ffmpeg` (or prompting the user for an existing system binary) for consistent decoding.

4. **Tauri window & commands**  
   - Register a `transcription` Tauri command that dispatches to either API or embedded mode based on user settings.  
   - Build a dedicated window (or modal) with recorder controls, upload button, and transcription output using the existing state management pattern in `public/app.js`.

5. **Performance & UX**  
   - Stream partial transcripts to the UI for long recordings.  
   - Surface progress indicators; Whisper can take minutes on CPU-only machines.  
   - Allow users to select model size (tiny/base/small) and language hints.

6. **Plugin Viability**  
   - Abstract current Rust logic into a `localai_whisper` crate exposing a clean interface.  
   - Wrap the crate in a Tauri plugin (`tauri::plugin!`) so other Tauri apps (or future product SKUs) can reuse it.  
   - Define plugin API endpoints: `load_model`, `transcribe_file`, `transcribe_microphone`, `cancel_transcription`.

7. **Distribution Strategy**  
   - If Whisper becomes optional, publish two installers: core (text-only) and voice-enabled.  
   - Alternatively, load models on-demand post-activation to reduce initial download size while keeping a single SKU.

8. **Compliance & Licensing**  
   - Update EULA / privacy policy to cover audio capture and storage.  
   - Offer clear retention settings (auto-delete, local storage locations) to reassure privacy-conscious users.

## Open Considerations
- **GPU Acceleration**: For performance, integrate `faster-whisper` (OpenVINO/CUDA) as an optional backend. Evaluate packaging implications (binary size, device support).  
- **Microphone Capture**: Front-end needs WebRTC or Web Audio API support for recording; Tauri allows streaming mic input to Rust via `tauri-plugin-autostart` or custom IPC.  
- **Background Tasks**: Long transcriptions should avoid blocking the main thread; leverage Tokio tasks and emit progress events to the front-end.  
- **Future Plugin Marketplace**: Establish an internal plugin registry so the Whisper module can be toggled per customer, aligning with the broader app-locking strategy documented in `DEPLOYMENT_DISTRIBUTION_PLAN.md`.

## Summary
Whisper integration is technically viable with existing code. The main effort lies in completing the UI flow, bundling the model, and polishing audio preprocessing. Building it as a reusable plugin positions the team to ship an optional voice add-on or a standalone “LocalAI Voice” experience without duplicating core logic.
