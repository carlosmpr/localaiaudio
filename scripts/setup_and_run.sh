#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

log() {
  printf "\n[%s] %s\n" "$(date +"%H:%M:%S")" "$*"
}

ensure_command() {
  local cmd="$1"
  local install_hint="$2"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    log "Missing dependency: ${cmd}"
    log "Install hint: ${install_hint}"
    exit 1
  fi
}

log "=========================================="
log "PrivateAI Setup and Installation Script"
log "=========================================="

VARIANT="${1:-both}"
log "Selected runtime variant: ${VARIANT}"

log "Checking toolchain prerequisites..."
ensure_command node "Install Node.js LTS from https://nodejs.org/"
ensure_command npm "Install Node.js LTS (bundled npm)."
ensure_command cargo "Install Rust using https://rustup.rs/"

PYTHON_BIN="${PRIVATE_AI_PYTHON:-python3}"
if command -v "${PYTHON_BIN}" >/dev/null 2>&1; then
  log "Python runtime detected: $(${PYTHON_BIN} --version 2>/dev/null)"
else
  log "Python runtime (${PYTHON_BIN}) not found. The optional llama-cpp sidecar requires Python 3."
fi

log "Installing npm dependencies..."
cd "${REPO_ROOT}"
npm install

log "Verifying Tauri configuration..."
TAURI_CONFIG="${REPO_ROOT}/src-tauri/tauri.conf.json"
if [[ ! -f "${TAURI_CONFIG}" ]]; then
  log "ERROR: Tauri configuration not found at ${TAURI_CONFIG}."
  log "The Tauri project files are missing. This should not happen."
  exit 1
fi

log "Tauri configuration found ✓"

log "Building Rust backend (this may take a few minutes on first run)..."
cd "${REPO_ROOT}"

log ""
log "=========================================="
log "Starting PrivateAI Application"
log "=========================================="
log ""
log "The app will:"
log "  1. Scan your hardware"
log "  2. Check for Ollama installation"
log "  3. Guide you through setup if needed"
log ""
log "If Ollama is not installed, you'll see an 'Install Ollama' button"
log "After installation, you'll need to pull a model (e.g., phi3:mini)"
log ""
log "Launching Tauri app..."
log ""

case "${VARIANT}" in
  ollama)
    npm run tauri:dev:ollama
    ;;
  python)
    npm run tauri:dev:python
    ;;
  both)
    npm run tauri:dev
    ;;
  *)
    log "Unknown variant '${VARIANT}'. Use 'ollama', 'python', or omit for combined dev mode."
    exit 1
    ;;
esac
