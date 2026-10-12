"""LLM interpreter tests with a fake client. No network calls, no API key needed."""

import json
from types import SimpleNamespace

import pytest

from app.config import get_settings
from app.generation import llm
from app.generation.llm import HINTS_SCHEMA, InterpreterUnavailable, interpret_llm
from app.generation.params import GenerationRequest
from app.generation.resolve import resolve_plan

GOOD = {
    "genre": "trap", "mood": "dreamy", "energy": 0.7, "bpm": 142, "keyRoot": "F#",
    "keyMode": "minor", "structure": "short", "durationSeconds": None, "include": ["pad", "lead"],
    "exclude": [], "complexity": None, "drumIntensity": 0.9, "bassIntensity": None,
    "melodicComplexity": 0.6, "title": "Neon Orbit", "notes": ["Pitch slides are not supported."],
}  # fmt: skip


class FakeMessages:
    def __init__(self, text=None, stop_reason="end_turn", error=None):
        self.text, self.stop_reason, self.error, self.calls = text, stop_reason, error, []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        content = [SimpleNamespace(type="text", text=self.text)] if self.text is not None else []
        return SimpleNamespace(stop_reason=self.stop_reason, content=content, model=kwargs["model"])


def test_parses_structured_output_and_sends_expected_request():
    fake = FakeMessages(json.dumps(GOOD))
    hints, model = interpret_llm("spacey trap", client=fake)
    assert hints.genre == "trap" and hints.key_root == "F#" and hints.title == "Neon Orbit"
    assert model == "claude-opus-5-5"
    call = fake.calls[0]
    assert call["output_config"]["format"]["schema"] is HINTS_SCHEMA
    assert call["fallbacks"] == "default"
    assert call["betas"] == ["server-side-fallback-2026-07-01"]
    assert call["messages"] == [{"role": "user", "content": "spacey trap"}]


def test_schema_lists_every_property_as_required():
    assert set(HINTS_SCHEMA["required"]) == set(HINTS_SCHEMA["properties"])
    assert HINTS_SCHEMA["additionalProperties"] is False


@pytest.mark.parametrize(
    "fake",
    [
        FakeMessages(json.dumps(GOOD), stop_reason="refusal"),
        FakeMessages(json.dumps(GOOD), stop_reason="max_tokens"),
        FakeMessages(None),
        FakeMessages("not json"),
        FakeMessages(json.dumps({**GOOD, "bpm": 999})),  # out of range: Pydantic rejects
        FakeMessages(error=RuntimeError("network down")),
    ],
)
def test_failures_raise_unavailable(fake):
    with pytest.raises(InterpreterUnavailable):
        interpret_llm("x", client=fake)


def test_resolver_uses_llm_when_configured(monkeypatch):
    monkeypatch.setattr(get_settings(), "llm_provider", "anthropic")
    import app.generation.resolve as resolve

    hints = llm.PromptHints.model_validate(GOOD)
    monkeypatch.setattr(resolve, "interpret_llm", lambda prompt: (hints, "claude-opus-5-5"))
    plan = resolve_plan(GenerationRequest(prompt="spacey trap", seed=1))
    assert plan.interpreter == "llm" and plan.interpreter_model == "claude-opus-5-5"
    assert plan.title == "Neon Orbit" and plan.bpm == 142


def test_resolver_falls_back_to_rules_with_warning(monkeypatch):
    monkeypatch.setattr(get_settings(), "llm_provider", "anthropic")
    import app.generation.resolve as resolve

    def boom(prompt):
        raise InterpreterUnavailable("Anthropic API key missing or invalid.")

    monkeypatch.setattr(resolve, "interpret_llm", boom)
    plan = resolve_plan(GenerationRequest(prompt="dark trap at 150 bpm", seed=1))
    assert plan.interpreter == "rules" and plan.bpm == 150
    assert any("API key" in w for w in plan.warnings)


def test_client_uses_configured_key_and_timeout(monkeypatch):
    import anthropic
    from pydantic import SecretStr

    captured = {}

    class FakeAnthropic:
        def __init__(self, **kwargs):
            captured.update(kwargs)
            self.beta = SimpleNamespace(messages=FakeMessages(json.dumps(GOOD)))

    monkeypatch.setattr(anthropic, "Anthropic", FakeAnthropic)
    monkeypatch.setattr(get_settings(), "anthropic_api_key", SecretStr("sk-test"))
    hints, _ = interpret_llm("trap")
    assert hints.genre == "trap"
    assert captured == {"api_key": "sk-test", "timeout": 30.0, "max_retries": 1}
