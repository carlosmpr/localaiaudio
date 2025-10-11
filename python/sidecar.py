#!/usr/bin/env python3
"""
Minimal llama-cpp-powered sidecar used by the Tauri desktop app.

The server exposes two endpoints:
  - GET  /health  → {"status": "ok"}
  - POST /chat    → {"reply": "<assistant response>"}

Requests to /chat must include JSON:
  { "prompt": "Hello", "system": "... optional ..." }
"""

import argparse
import json
import os
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Optional

try:
    from llama_cpp import Llama
except ImportError as exc:  # pragma: no cover - environment specific
    Llama = None  # type: ignore
    IMPORT_ERROR = exc
else:
    IMPORT_ERROR = None

DEFAULT_SYSTEM_PROMPT = (
    "You are PrivateAI, a local-first assistant that never sends data to the cloud. "
    "Answer succinctly, focusing on helpful and factual responses."
)


class LlamaEngine:
    """Simple wrapper around llama-cpp to provide thread-safe chat completions."""

    def __init__(self, model_path: str, ctx_size: int, gpu_layers: int) -> None:
        if Llama is None:
            raise RuntimeError(
                "llama-cpp-python is not installed. "
                "Install dependencies with `pip install -r python/requirements.txt`."
            ) from IMPORT_ERROR

        if not os.path.exists(model_path):
            raise FileNotFoundError(
                f"Model GGUF not found at {model_path}. "
                "Download a compatible model (e.g., gemma-1b) and update the path."
            )

        threads = max(1, int(os.getenv("PRIVATE_AI_LLAMA_THREADS", os.cpu_count() or 1)))

        self._llm = Llama(
            model_path=model_path,
            n_ctx=ctx_size,
            n_threads=threads,
            n_gpu_layers=gpu_layers,
        )
        self._lock = threading.Lock()
        self.model_path = model_path

    def _prepare_messages(
        self,
        prompt: str,
        system: Optional[str],
        messages: Optional[list],
    ) -> list:
        if messages:
            prepared = []
            has_system = any(
                isinstance(m, dict) and m.get("role") == "system" for m in messages
            )
            if not has_system:
                prepared.append(
                    {"role": "system", "content": system or DEFAULT_SYSTEM_PROMPT}
                )
            for msg in messages:
                if isinstance(msg, dict) and "role" in msg and "content" in msg:
                    prepared.append({
                        "role": msg.get("role"),
                        "content": msg.get("content"),
                    })
            return prepared

        return [
            {"role": "system", "content": system or DEFAULT_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ]

    def chat(
        self,
        prompt: str,
        system: Optional[str] = None,
        messages: Optional[list] = None,
    ) -> str:
        prepared = self._prepare_messages(prompt, system, messages)
        with self._lock:
            result = self._llm.create_chat_completion(messages=prepared)
        choice = result["choices"][0]
        message = choice.get("message")

        if isinstance(message, dict):
            content = message.get("content", "")
            if isinstance(content, list):
                content = "".join(
                    part.get("text", "") if isinstance(part, dict) else str(part)
                    for part in content
                )
            elif not isinstance(content, str):
                content = str(content)
        elif isinstance(message, str):
            content = message
        else:
            content = choice.get("text", "")

        if not isinstance(content, str) or not content.strip():
            raise RuntimeError("Empty response from llama.cpp runtime.")

        return content.strip()

    def chat_stream(
        self,
        prompt: str,
        system: Optional[str] = None,
        messages: Optional[list] = None,
    ):
        """Stream chat completion tokens as they are generated."""
        prepared = self._prepare_messages(prompt, system, messages)
        with self._lock:
            stream = self._llm.create_chat_completion(messages=prepared, stream=True)

        for chunk in stream:
            if not chunk or "choices" not in chunk or not chunk["choices"]:
                continue

            delta = chunk["choices"][0].get("delta", {})
            content = delta.get("content")

            if isinstance(content, list):
                for part in content:
                    if isinstance(part, dict):
                        text = part.get("text")
                        if text:
                            yield text
            elif isinstance(content, str):
                if content:
                    yield content

            finish = chunk["choices"][0].get("finish_reason")
            if finish:
                break


class RequestHandler(BaseHTTPRequestHandler):
    server_version = "PrivateAISidecar/0.1"

    @property
    def engine(self) -> LlamaEngine:
        return self.server.engine  # type: ignore[attr-defined]

    def log_message(self, fmt: str, *args) -> None:  # pragma: no cover
        return  # Silence default logging

    def _write_json(self, payload, status=HTTPStatus.OK) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # pragma: no cover - thin wrapper
        if self.path.rstrip("/") == "/health":
            self._write_json(
                {
                    "status": "ok",
                    "model": getattr(self.engine, "model_path", "unknown"),
                }
            )
        else:
            self.send_error(HTTPStatus.NOT_FOUND, "Unknown endpoint")

    def do_POST(self) -> None:  # pragma: no cover - thin wrapper
        path = self.path.rstrip("/")

        if path not in ["/chat", "/chat/stream"]:
            self.send_error(HTTPStatus.NOT_FOUND, "Unknown endpoint")
            return

        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else b"{}"

        try:
            payload = json.loads(body.decode("utf-8"))
        except json.JSONDecodeError:
            self._write_json({"error": "Invalid JSON payload"}, status=HTTPStatus.BAD_REQUEST)
            return

        prompt = (payload.get("prompt") or "").strip()
        system_prompt = (payload.get("system") or "").strip() or None

        if not prompt:
            self._write_json({"error": "Missing prompt"}, status=HTTPStatus.BAD_REQUEST)
            return

        chat_messages = payload.get("messages") if isinstance(payload.get("messages"), list) else None

        # Handle streaming
        if path == "/chat/stream":
            try:
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "keep-alive")
                self.end_headers()

                for token in self.engine.chat_stream(prompt, system=system_prompt, messages=chat_messages):
                    event_data = json.dumps({"token": token})
                    self.wfile.write(f"data: {event_data}\n\n".encode("utf-8"))
                    self.wfile.flush()

                # Send done event
                self.wfile.write(b"data: {\"done\": true}\n\n")
                self.wfile.flush()
            except Exception as exc:  # pragma: no cover - runtime errors
                error_data = json.dumps({"error": str(exc)})
                self.wfile.write(f"data: {error_data}\n\n".encode("utf-8"))
                self.wfile.flush()
            return

        # Handle non-streaming
        try:
            reply = self.engine.chat(prompt, system=system_prompt, messages=chat_messages)
        except Exception as exc:  # pragma: no cover - runtime errors
            self._write_json({"error": f"Generation failed: {exc}"}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        self._write_json({"reply": reply})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="PrivateAI python sidecar")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind.")
    parser.add_argument("--port", type=int, default=32121, help="Port to bind.")
    parser.add_argument(
        "--model",
        dest="model_path",
        default=os.environ.get("PRIVATE_AI_MODEL_PATH"),
        help="Path to GGUF model file.",
    )
    parser.add_argument(
        "--ctx",
        dest="context",
        type=int,
        default=int(os.environ.get("PRIVATE_AI_CONTEXT_LENGTH", "4096")),
        help="Context window (tokens).",
    )
    parser.add_argument(
        "--gpu-layers",
        dest="gpu_layers",
        type=int,
        default=int(os.environ.get("PRIVATE_AI_GPU_LAYERS", "0")),
        help="Number of GPU layers to offload (use >0 for CUDA/Metal builds).",
    )
    return parser.parse_args()


def run() -> None:  # pragma: no cover - entry point
    args = parse_args()

    if not args.model_path:
        raise SystemExit(
            "No model path supplied. Use --model /path/to/model.gguf "
            "or set PRIVATE_AI_MODEL_PATH."
        )

    engine = LlamaEngine(
        model_path=args.model_path,
        ctx_size=args.context,
        gpu_layers=args.gpu_layers,
    )

    server = HTTPServer((args.host, args.port), RequestHandler)
    server.engine = engine  # type: ignore[attr-defined]

    print(
        f"[PrivateAI python sidecar] Serving on http://{args.host}:{args.port} "
        f"using model {engine.model_path}",
        flush=True,
    )

    try:
        server.serve_forever()
    except KeyboardInterrupt:  # pragma: no cover
        print("Shutting down sidecar.")
    finally:
        server.server_close()


if __name__ == "__main__":  # pragma: no cover
    run()
