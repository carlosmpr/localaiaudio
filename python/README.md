# Python Sidecar (Version 2 Runtime)

The Version 2 runtime swaps Ollama for an embedded Python process that loads GGUF
models via `llama-cpp-python`. The Tauri UI launches this script as a sidecar and
communicates with it over `http://127.0.0.1:32121`.

## 1. Install Python dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate  # .venv\Scripts\activate on Windows
pip install --upgrade pip
pip install -r python/requirements.txt
```

If you plan to use GPU acceleration, install the appropriate wheel from the
[`llama-cpp-python` documentation](https://github.com/abetlen/llama-cpp-python#installation).

## 2. Download a model (example: Gemma 1B)

Place a GGUF model under `~/PrivateAI/Models`. The default configuration looks
for:

```
~/PrivateAI/Models/gemma-1b-it-q4_0.gguf
```

You can adjust the filename or pass a custom path when starting the sidecar.

## 3. Launching manually (optional)

```bash
python python/sidecar.py \
  --model ~/PrivateAI/Models/gemma-1b-it-q4_0.gguf \
  --port 32121
```

Visit `http://127.0.0.1:32121/health` to confirm the service is ready.

## 4. Using the Tauri app

1. Run `bash scripts/setup_and_run.sh` (or `npm run tauri dev`).
2. In the first-run wizard, select **“Python llama.cpp sidecar”** as the runtime.
3. The app will start the Python sidecar automatically, verify health, and open
   the chat interface.

## Environment variables

| Variable                     | Description                                    |
| ---------------------------- | ---------------------------------------------- |
| `PRIVATE_AI_PYTHON`          | Path to the Python binary to launch.           |
| `PRIVATE_AI_MODEL_PATH`      | Default GGUF path if `--model` not provided.   |
| `PRIVATE_AI_CONTEXT_LENGTH`  | Context window (tokens). Default: 4096.        |
| `PRIVATE_AI_GPU_LAYERS`      | Layers to offload to GPU (CUDA/Metal builds).  |
| `PRIVATE_AI_LLAMA_THREADS`   | Number of CPU threads. Defaults to `os.cpu_count()`. |

The sidecar is designed to stay completely local: bound to `127.0.0.1`, no
telemetry, and no outbound requests beyond the model download step you control.
