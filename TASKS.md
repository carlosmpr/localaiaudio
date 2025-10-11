# Implementation Tasks

## Phase 1 -- MVP Chat with Fixed Model
- [x] Define a hardware scan stub that returns canned specs for early testing.
- [x] Provide an HTTP-friendly handler for the stubbed hardware scan.
- [x] Integrate Ollama runtime bootstrap (assume default model `phi3:mini`).
- [x] Build desktop shell (Tauri) with first-run wizard + chat UI scaffold.
- [ ] Persist chats locally under `~/PrivateAI/Chats`.

## Phase 2 -- Auto-detect and Model Installer
- [ ] Implement cross-platform hardware detection.
- [ ] Create model catalog JSON and recommendation algorithm.
- [ ] Automate Ollama and model installation with progress and checksum verification.
- [ ] Add configuration writer for `~/PrivateAI/Config/app.json`.
- [x] Introduce optional Python (llama-cpp) runtime toggle with sidecar orchestration.
- [ ] Provide dedicated build workflows for Ollama-only and Python-only installers (UI + packaging).

## Phase 3 -- UX Polish and Storage
- [ ] Refine Chat UI (history sidebar, settings panel, theming, streaming polish).
- [ ] Persist chats via Tauri-side storage service (JSONL + config integration).
- [ ] Implement local logs, index folder, and optional SQLite search.
- [ ] Add update mechanism for the app and manual model refresh controls.
- [ ] Harden privacy controls (no telemetry, explicit prompts for any external connection).

## Phase 4 -- Optional Enhancements
- [ ] Offline RAG integration over user documents.
- [ ] Vision model support.
- [ ] Voice input and output pipeline.
- [ ] Multi-user profile support.
- [ ] Custom model import workflow for `.gguf` and `.ggml` assets.

## Cross-Cutting
- [ ] Security review (encryption at rest, sandboxing, update channels).
- [ ] QA test matrix across Windows, macOS, and Linux, including fallbacks.
- [ ] Packaging automation (CI/CD, signing, notarization, release checks).
