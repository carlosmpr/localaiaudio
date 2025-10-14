# PrivateAI Electron App

PrivateAI is a desktop Electron application that lets you chat with a local LLM using the [`node-llama-cpp`](https://github.com/withcatai/node-llama-cpp) bindings. The app bundles a lightweight HTTP backend, a React renderer, and Electron glue code that keeps everything working whether you run the app in development or as a packaged binary.

## What's inside

```
.
├── source/                 # Electron main + preload (CommonJS, bundled by webpack)
├── renderer/               # React UI that streams responses from the backend
├── resources/backend/      # Node HTTP server that drives node-llama-cpp
├── resources/models/       # Optional GGUF models copied into packaged builds
├── build/                  # Emitted JS bundles (main, preload, renderer)
└── dist/                   # Production artifacts created by electron-builder
```

Key behaviours:

- **Main process** (`source/main.cjs`) starts the backend, manages windows, and configures module search paths so packaged apps can still resolve `node_modules`.
- **Backend server** (`resources/backend/index.js`) exposes REST + NDJSON streaming endpoints. It dynamically loads `node-llama-cpp` using `import()` and keeps models cached in memory.
- **Renderer** (`renderer/index.jsx`) is a React chat client that streams tokens from `/api/chat`, keeps a conversation list, and falls back gracefully when the backend is still loading a model.
- **Persistent storage** lives under `~/PrivateAI` (or `PRIVATE_AI_BASE_DIR`) and mirrors conversations, models, and logs in predictable folders.

## Prerequisites

- Node.js **20 or newer** (matches the minimum requirement for `node-llama-cpp`)
- npm 9+ (ships with Node 20)
- A GGUF model file, e.g. `gemma-3-1b-it-Q4_0.gguf`
  - Place it in `resources/models/` before packaging, or
  - Set `PRIVATE_AI_MODEL_PATH=/absolute/path/to/model.gguf` when running the app

## Install dependencies

```bash
npm install
```

The install step triggers `node-llama-cpp`'s postinstall hook, which downloads the correct native binaries for your platform.

## Run in development

```bash
npm run dev
```

The script builds the main/preload/renderer bundles, launches Electron with `NODE_ENV=development`, starts the backend server, and opens the browser window. The backend listens on `http://127.0.0.1:3333` by default; you can override host/port with environment variables before invoking the script.

## Build production binaries

```bash
npm run package
```

Packaging runs the webpack build and then `electron-builder`. The configuration disables `asar` so the full `node_modules/` tree is shipped as-is; this avoids ESM resolution issues with `node-llama-cpp` and its nested dependencies. The resulting installers or standalone apps land in `dist/`.

## Model management

- During development the backend searches (in order):
  1. `PRIVATE_AI_MODEL_PATH`
  2. `resources/Models/<default model>` inside the repo
  3. `~/PrivateAI/Models/<default model>`
- When packaged, `source/main.cjs` copies any `.gguf` files from `resources/models/` into the user's application data directory (`~/Library/Application Support/PrivateAI/Models` on macOS, similar paths on Windows/Linux).
- The first successful load is cached so subsequent chats are fast. Switching models requires restarting the app or deleting the cached model file.

## ESM + CommonJS interoperability

Electron's main process is bundled as CommonJS, but `node-llama-cpp` ships only as ES modules. The backend bridges the gap by:

1. Attempting a standard dynamic `import('node-llama-cpp')` to support environments where Node's ESM resolution works out of the box.
2. Falling back to `require.resolve` + `import(pathToFileURL(...))` if the first step fails (useful inside webpacked CommonJS bundles).
3. Caching the returned module so the native bindings are initialised only once.

Because some transitive dependencies expect other packages alongside them (e.g. Octokit, lifecycle utilities), the production build keeps `node_modules/` unpacked. This trades a slightly larger bundle for predictable runtime resolution.

## Backend API (quick reference)

| Method | Path                     | Description                                   |
|--------|-------------------------|-----------------------------------------------|
| GET    | `/api/health`           | Returns model loading status and file path.   |
| GET    | `/api/conversations`    | Lists conversation summaries.                 |
| POST   | `/api/conversations`    | Creates a new empty conversation.             |
| GET    | `/api/conversations/:id`| Fetches a full conversation transcript.       |
| POST   | `/api/chat`             | Streams assistant output via NDJSON events.   |

`/api/chat` emits objects with `type` fields (`session`, `token`, `done`, `error`, etc.) so the renderer can update UI in real time.

## Environment variables

- `PRIVATE_AI_MODEL_PATH` – absolute path to a GGUF model file
- `PRIVATE_AI_BASE_DIR` – override the default storage root (`~/PrivateAI`)
- `HOST` / `PORT` – bind address for the backend server (default `127.0.0.1:3333`)
- `PRIVATE_AI_DEBUG=1` – forces DevTools to open when the main window loads

## Troubleshooting

- **Model not found**: verify the path printed in the title bar or place a `.gguf` file in `resources/models/`.
- **Missing native binaries**: re-run `npm install` after upgrading Node, or delete `node_modules/node-llama-cpp` so the postinstall hook can download fresh binaries.
- **Renderer stuck on "Waiting"**: check the backend logs in the terminal; errors bubble up with stack traces.
- **Packaging issues**: remember the build disables `asar`. If you need the archive for other reasons, you must widen `asarUnpack` to include every package `node-llama-cpp` touches.

## License

This project is currently distributed under the `UNLICENSED` license as declared in `package.json`. Update the metadata if you plan to redistribute it.
