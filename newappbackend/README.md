# newappbackend

Minimal proof-of-concept server that loads a local GGUF model through
[node-llama-cpp](https://node-llama-cpp.withcat.ai/guide/) and exposes a tiny
web UI for manual testing.

## Prerequisites

- Node.js 18+ (Node 20 recommended).
- A GGUF model on disk (for example `gemma-3-1b-it-Q4_0.gguf` already bundled
  elsewhere in this repository).

The server looks for a model in this order:

1. `PRIVATE_AI_MODEL_PATH` environment variable (absolute or relative path).
2. `newappbackend/Models/gemma-3-1b-it-Q4_0.gguf`
3. `~/PrivateAI/Models/gemma-3-1b-it-Q4_0.gguf`
   (or `${PRIVATE_AI_BASE_DIR}/Models/...` if that variable is set).

Place a compatible model at one of those locations before starting the server.

## Install

```bash
cd newappbackend
npm install
```

The first install downloads the prebuilt llama.cpp binaries for your platform.

## Run

```bash
npm start
```

The server listens on <http://127.0.0.1:3333>. Open that URL to access the full
chat experience with conversation history, streaming responses, and adjustable
generation settings. Use `PORT` / `HOST` environment variables to change the
bind address, if needed.

The `GET /api/health` endpoint reports whether a model path has been resolved.
The first chat request triggers the actual model load.

## Notes

- Conversations are persisted under `~/PrivateAI/Chats`, so history survives
  restarts. Each chat request streams JSON lines (`application/x-ndjson`), which
  the UI renders token-by-token.
- Extend `server/index.js` / `public/main.js` to explore advanced features such
  as function calling, embeddings, custom chat wrappers, or richer tooling—
  all without introducing extra frameworks.
