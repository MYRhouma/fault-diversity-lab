"""Shared fixtures: a tiny prompt, a run config in a temporary folder, and a fake OpenRouter server on 127.0.0.1."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

PROMPT = """=== SYSTEM ===
You write Solidity.

=== USER ===
Write a counter contract.

Output file: Counter.sol
"""


@pytest.fixture
def make_config(tmp_path):
    """make_config(**overrides) -> (config dict, config path). Two models, two settings, one target, two samples."""
    prompt = tmp_path / "prompt.md"
    prompt.write_text(PROMPT)

    def make(**overrides):
        cfg = {
            "title": "test run",
            "targets": [{"id": "counter", "name": "Counter", "prompt": str(prompt), "runner": "forge",
                         "harness": str(tmp_path / "harness")}],
            "settings": {"OFF-T0.2": {"reasoning": {"enabled": False}, "temperature": 0.2},
                         "ON-HIGH": {"reasoning": {"enabled": True, "effort": "high"}}},
            "models": [{"id": "lab-a/model-one", "provider": "Prov A", "price_in": 1.0, "price_out": 2.0, "max_output": 1000},
                       {"id": "lab-b/model-two", "provider": "Prov B", "price_in": 0.5, "price_out": 1.0, "max_output": 4000}],
            "samples": 2,
            "max_tokens": 2000,
            "cap_usd": 1,
            "out_dir": str(tmp_path / "run"),
            "rate_limit_backoff_s": [0, 0],
            "connect_backoff_s": 0,
        } | overrides
        path = tmp_path / "config.json"
        path.write_text(json.dumps(cfg))
        return cfg, path

    return make


class FakeOpenRouter:
    """Answers POST /chat/completions with the queued (status, body) pairs, in order, and records each request."""

    def __init__(self):
        self.queue: list[tuple[int, dict | bytes]] = []
        self.received: list[dict] = []
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                fake.received.append(json.loads(body))
                status, answer = fake.queue.pop(0)
                data = answer if isinstance(answer, bytes) else json.dumps(answer).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}/api/v1"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def fake_openrouter():
    fake = FakeOpenRouter()
    yield fake
    fake.close()


def answer(content: str, provider: str = "Prov A", finish: str = "stop", cost: float = 0.001) -> dict:
    """A chat completion as OpenRouter returns it."""
    return {"id": "gen-1", "provider": provider, "model": "lab-a/model-one",
            "choices": [{"finish_reason": finish, "message": {"role": "assistant", "content": content}}],
            "usage": {"prompt_tokens": 50, "completion_tokens": 20, "cost": cost,
                      "completion_tokens_details": {"reasoning_tokens": 0}}}
