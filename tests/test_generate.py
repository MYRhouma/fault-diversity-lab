"""Generator: the plan (ids, worst case, checks) and the send path against a fake OpenRouter server on 127.0.0.1."""

from __future__ import annotations

import json
import socket

import httpx
import pytest
from conftest import answer

from fdlab import generate
from fdlab.generate import build_plan, main, safe_id

CODE = "```solidity\npragma solidity ^0.8.20;\ncontract Counter {}\n```"
ONE = "counter/model-one/OFF-T0.2/s01"


# ---- plan --------------------------------------------------------------------------------------------------------

def test_plan_ids_order_and_body(make_config):
    cfg, _ = make_config()
    plan = build_plan(cfg)
    assert plan.errors == []
    ids = [r.id for r in plan.requests]
    assert len(ids) == 2 * 2 * 1 * 2 == len(set(ids))
    assert ONE in ids and "counter/model-two/ON-HIGH/s02" in ids
    assert all(r.sample == 1 for r in plan.requests[:4])  # sample-major: every s01 before any s02
    r = next(r for r in plan.requests if r.id == ONE)
    assert r.body["provider"] == {"order": ["Prov A"], "only": ["Prov A"], "allow_fallbacks": False,
                                  "require_parameters": True}
    assert r.body["temperature"] == 0.2 and r.body["reasoning"] == {"enabled": False}
    assert [m["role"] for m in r.body["messages"]] == ["system", "user"]
    assert r.output_file == "Counter.sol"
    assert r.variant_path.parts[-5:] == ("counter", "model-one", "OFF-T0.2", "s01", "Counter.sol")


def test_worst_case_uses_the_effective_max_tokens(make_config):
    cfg, _ = make_config()
    plan = build_plan(cfg)
    r = next(r for r in plan.requests if r.id == ONE)
    chars = sum(len(m["content"]) for m in r.body["messages"])
    assert r.max_tokens == 1000 and r.capped  # max_output 1000 < max_tokens 2000
    assert r.worst_usd == pytest.approx((chars / 2.5 * 1.0 + 1000 * 2.0) / 1e6)
    two = next(r for r in plan.requests if r.label == "model-two")
    assert two.max_tokens == 2000 and not two.capped


def test_skip_settings_and_null_override(make_config):
    cfg, _ = make_config()
    cfg["models"][0]["skip_settings"] = ["ON-HIGH"]
    cfg["models"][1]["settings"] = {"OFF-T0.2": None}
    assert {(r.label, r.setting) for r in build_plan(cfg).requests} == {("model-one", "OFF-T0.2"), ("model-two", "ON-HIGH")}


def test_plan_errors(make_config):
    cfg, _ = make_config()
    cfg["models"][0]["provider"] = "TBD"
    cfg["models"][1]["label"] = "model-tbd/x"
    cfg["settings"]["BAD"] = {"seed": 1}
    errors = " | ".join(build_plan(cfg).errors)
    assert "provider is TBD" in errors and "contains '/'" in errors and "unknown fields ['seed']" in errors


def test_plan_mode_opens_no_connection(make_config, monkeypatch, capsys):
    _, path = make_config()

    def refuse(*args, **kwargs):
        raise AssertionError("plan mode tried to open a network connection")

    monkeypatch.setattr(httpx.Client, "__init__", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)
    monkeypatch.setattr(socket.socket, "connect", refuse)
    assert main([str(path)]) == 0
    assert "plan only: nothing was sent" in capsys.readouterr().out


def test_demo_config_is_never_sent(make_config, monkeypatch, capsys):
    _, path = make_config(demo=True)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(httpx.Client, "__init__", lambda *a, **k: (_ for _ in ()).throw(AssertionError("network")))
    assert main([str(path), "--send", "--cap", "0.5", "--no-key-check"]) == 2
    assert "demo config" in capsys.readouterr().out


def test_send_needs_key_and_cap(make_config, monkeypatch):
    _, path = make_config()
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    assert main([str(path), "--send", "--cap", "0.5"]) == 2
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    assert main([str(path), "--send"]) == 2
    assert main([str(path), "--send", "--cap", "5"]) == 2  # above the config's cap_usd


# ---- send ----------------------------------------------------------------------------------------------------------

@pytest.fixture
def send(make_config, fake_openrouter, monkeypatch):
    """send(*answers, cap=0.5) -> (status of ONE, its record). Only ONE is in the plan."""
    cfg, path = make_config(base_url=fake_openrouter.url)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(generate.time, "sleep", lambda s: None)

    def run(*answers, cap=0.5):
        fake_openrouter.queue.extend(answers)
        main([str(path), "--send", "--cap", str(cap), "--no-key-check", "--only", ONE, "--jobs", "1"])
        record = cfg["out_dir"] + f"/requests/{safe_id(ONE)}.json"
        try:
            rec = json.loads(open(record).read())
        except FileNotFoundError:
            rec = None
        return rec, fake_openrouter

    run.out_dir = cfg["out_dir"]
    return run


def test_ok_answer_writes_record_raw_bytes_and_variant(send):
    rec, fake = send((200, answer(CODE)))
    assert rec["status"] == "ok" and rec["cost_usd"] == 0.001 and rec["total_cost_usd"] == 0.001
    assert len(fake.received) == 1 and fake.received[0]["provider"]["only"] == ["Prov A"]
    raw = open(f"{send.out_dir}/{rec['attempts'][0]['raw_file']}", "rb").read()
    assert json.loads(raw) == answer(CODE)
    assert open(f"{send.out_dir}/{rec['variant_file']}").read() == "pragma solidity ^0.8.20;\ncontract Counter {}\n"
    events = [json.loads(x)["event"] for x in open(f"{send.out_dir}/events.jsonl")]
    assert events[:2] == ["planned", "start"] and events[-1] == "end"


def test_done_request_is_never_sent_again(send):
    send((200, answer(CODE)))
    rec, fake = send()
    assert len(fake.received) == 1 and rec["status"] == "ok" and len(rec["attempts"]) == 1


def test_truncated_answer_keeps_no_variant(send):
    rec, _ = send((200, answer(CODE, finish="length")))
    assert rec["status"] == "truncated" and rec["variant_file"] is None


def test_429_is_retried_and_not_billed(send):
    rec, fake = send((429, {"error": {"message": "rate limited"}}), (200, answer(CODE)))
    assert len(fake.received) == 2
    assert [a["status"] for a in rec["attempts"]] == ["rate_limited", "ok"]
    assert rec["attempts"][0]["sent"] is False and rec["total_cost_usd"] == 0.001


def test_server_error_needs_review_and_blocks_the_id(send):
    rec, fake = send((500, {"error": {"message": "upstream"}}))
    assert rec["status"] == "needs_review"
    rec, fake = send()  # a second run must not send it again
    assert len(fake.received) == 1 and rec["status"] == "needs_review"


def test_provider_mismatch_is_kept_but_not_used(send):
    rec, _ = send((200, answer(CODE, provider="Someone Else")))
    assert rec["status"] == "provider_mismatch" and rec["variant_file"] is None


def test_existing_variant_file_is_never_overwritten(send, tmp_path):
    variant = tmp_path / "run" / "variants" / "counter" / "model-one" / "OFF-T0.2" / "s01" / "Counter.sol"
    variant.parent.mkdir(parents=True)
    variant.write_text("// written before\n")
    rec, _ = send((200, answer(CODE)))
    assert rec["status"] == "needs_review" and variant.read_text() == "// written before\n"


def test_cap_stops_before_sending(send):
    rec, fake = send((200, answer(CODE)), cap=0.0001)
    assert rec is None and fake.received == []
    events = [json.loads(x)["event"] for x in open(f"{send.out_dir}/events.jsonl")]
    assert "stop_cap" in events
