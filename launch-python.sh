#!/bin/bash
# Launch PrivateAI with Python runtime

export PRIVATE_AI_PYTHON="$HOME/.privateai-venv/bin/python"
export PRIVATE_AI_MODEL_PATH="$HOME/PrivateAI/Models/gemma3-1b.gguf"

echo "Starting PrivateAI with Python runtime..."
echo "Python: $PRIVATE_AI_PYTHON"
echo "Model: $PRIVATE_AI_MODEL_PATH"

source "$HOME/.cargo/env"
npm run tauri:dev:python
