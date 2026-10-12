"""Optional LLM prompt interpreter (Anthropic Claude).

The model only reads the user's description and returns PromptHints as JSON; it never
writes notes or touches project data. Composition stays in composer.py. Disabled unless
VIBESTUDIO_LLM_PROVIDER=anthropic, so nobody is billed by accident. The key comes from
ANTHROPIC_API_KEY in the environment or .env; otherwise the SDK uses its own sources (such
as an `ant auth login` profile).
"""

import json
import logging
from typing import Any, Protocol

from pydantic import ValidationError

from app.config import get_settings
from app.generation.params import DRUMS, GENRES, MELODIC, MOODS, PromptHints
from app.generation.theory import NOTE_NAMES

log = logging.getLogger(__name__)


class InterpreterUnavailable(Exception):
    """The LLM could not produce usable hints. The caller falls back to keyword rules."""


class MessagesClient(Protocol):
    """The slice of anthropic.Anthropic().beta.messages we use (lets tests inject a fake)."""

    def create(self, **kwargs: Any) -> Any: ...


def _nullable(schema: dict) -> dict:
    return {"anyOf": [schema, {"type": "null"}]}


_INSTRUMENT = {"type": "string", "enum": [*DRUMS, *MELODIC]}
_UNIT = _nullable({"type": "number"})

# Structured-output schema. The API does not enforce numeric ranges, so values are
# validated again with PromptHints (Pydantic) after parsing.
HINTS_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "genre": _nullable({"type": "string", "enum": list(GENRES)}),
        "mood": _nullable({"type": "string", "enum": list(MOODS)}),
        "energy": _UNIT,
        "bpm": _nullable({"type": "number"}),
        "keyRoot": _nullable({"type": "string", "enum": list(NOTE_NAMES)}),
        "keyMode": _nullable({"type": "string", "enum": ["major", "minor"]}),
        "structure": _nullable({"type": "string", "enum": ["loop", "short", "full"]}),
        "durationSeconds": _nullable({"type": "number"}),
        "include": {"type": "array", "items": _INSTRUMENT},
        "exclude": {"type": "array", "items": _INSTRUMENT},
        "complexity": _UNIT,
        "drumIntensity": _UNIT,
        "bassIntensity": _UNIT,
        "melodicComplexity": _UNIT,
        "title": _nullable({"type": "string"}),
        "notes": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "genre", "mood", "energy", "bpm", "keyRoot", "keyMode", "structure", "durationSeconds",
        "include", "exclude", "complexity", "drumIntensity", "bassIntensity",
        "melodicComplexity", "title", "notes",
    ],
    "additionalProperties": False,
}  # fmt: skip

SYSTEM_PROMPT = """You read a music producer's description of a beat and translate it into \
settings for a procedural beat composer. Return only what the description implies; use null \
for anything it doesn't mention so the app can apply its own defaults.

Available settings:
- genre: trap, drill, boombap (also general hip-hop), lofi, house (also EDM/dance), pop \
(also R&B). Pick the closest; if it is only an approximation, say so in notes.
- mood: dark, emotional, uplifting, chill, aggressive, dreamy.
- energy, complexity, drumIntensity, bassIntensity, melodicComplexity: 0 to 1.
- bpm: 40-220. keyRoot uses sharps (A#, not Bb). keyMode: major or minor.
- structure: loop (a few bars), short (about 30 bars), full (intro, verses, hooks, bridge, \
outro). durationSeconds: 8-300.
- include / exclude instruments: kick, snare, clap, hihat, openhat, perc, bass (808 or synth \
bass), lead, pad, pluck, keys. Map other instruments to the closest one and say so in notes \
(e.g. strings -> pad, piano -> keys, guitar -> pluck).
- title: a short song title (2-5 words) that fits the description.
- notes: short, plain sentences about requests the composer cannot honour: anything other \
than 4/4, vocals, pitch slides, sampling, specific artists' sounds."""


def interpret_llm(prompt: str, client: MessagesClient | None = None) -> tuple[PromptHints, str]:
    """Return (hints, model id). Raises InterpreterUnavailable on any failure."""
    settings = get_settings()
    model = settings.llm_model
    if client is None:
        try:
            import anthropic

            key = settings.anthropic_api_key
            client = anthropic.Anthropic(
                api_key=key.get_secret_value() if key else None,
                timeout=settings.llm_timeout_seconds,
                max_retries=1,
            ).beta.messages
        except Exception as e:  # missing credentials raise at construction or first call
            raise InterpreterUnavailable(f"Anthropic client unavailable: {e}") from e

    try:
        response = client.create(
            model=model,
            max_tokens=16000,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
            output_config={
                "effort": "low",
                "format": {"type": "json_schema", "schema": HINTS_SCHEMA},
            },
            # Re-run on Anthropic's recommended model if a safety classifier declines.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except Exception as e:
        raise InterpreterUnavailable(_describe_error(e)) from e

    if response.stop_reason == "refusal":
        raise InterpreterUnavailable("The model declined to interpret this description.")
    if response.stop_reason == "max_tokens":
        raise InterpreterUnavailable("The model's answer was cut off.")
    text = next((b.text for b in response.content if getattr(b, "type", None) == "text"), None)
    if text is None:
        raise InterpreterUnavailable("The model returned no text.")
    try:
        hints = PromptHints.model_validate(json.loads(text))
    except (json.JSONDecodeError, ValidationError) as e:
        raise InterpreterUnavailable(f"The model's settings were invalid: {e}") from e
    log.info(
        "llm interpretation ok (model=%s, request=%s)", model, getattr(response, "_request_id", "?")
    )
    return hints, getattr(response, "model", model)


def _describe_error(e: Exception) -> str:
    try:
        import anthropic
    except ImportError:
        return str(e)
    if isinstance(e, anthropic.AuthenticationError):
        return "Anthropic API key missing or invalid."
    if isinstance(e, anthropic.PermissionDeniedError):
        return "Anthropic API key lacks permission for this model."
    if isinstance(e, anthropic.NotFoundError):
        return "Configured LLM model was not found."
    if isinstance(e, anthropic.RateLimitError):
        return "Anthropic rate limit reached. Try again shortly."
    if isinstance(e, anthropic.APITimeoutError):
        return "The LLM request timed out."
    if isinstance(e, anthropic.APIStatusError):
        return f"Anthropic API error {e.status_code}."
    if isinstance(e, anthropic.APIConnectionError):
        return "Could not reach the Anthropic API."
    log.exception("unexpected LLM error")
    return f"LLM error: {e}"
