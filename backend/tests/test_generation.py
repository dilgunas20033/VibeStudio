from collections import Counter

import pytest

from app.generation.composer import compose
from app.generation.interpret import interpret_rules
from app.generation.params import GenerationRequest
from app.generation.resolve import resolve_plan
from app.generation.theory import pitch_in_key
from app.schemas.project import ProjectDocument
from app.services.midi import expand_events

SPEC_PROMPT = (
    "Make me a dark futuristic melodic trap beat at 145 BPM with spacey synthesizers, a dreamy "
    "lead melody, heavy distorted 808s, punchy kicks, rolling hi-hats, and atmospheric "
    "background textures. Make it emotional but energetic."
)


def generate(**kw) -> tuple:
    req = GenerationRequest(**{"seed": 1, **kw})
    plan = resolve_plan(req)
    return plan, compose(plan, req.prompt)


def by_role(doc: ProjectDocument) -> dict:
    return {t.role: t for t in doc.tracks}


# --- interpretation ---------------------------------------------------------------------


def test_spec_prompt_is_read_correctly():
    h = interpret_rules(SPEC_PROMPT)
    assert (h.genre, h.mood, h.bpm) == ("trap", "dark", 145)
    assert h.energy == 0.8
    assert {"bass", "lead", "pad", "kick", "hihat"} <= set(h.include)
    assert h.bass_intensity == 0.85 and h.drum_intensity == 0.8
    assert h.duration_seconds is None  # "808s" is not "808 seconds"
    assert any("Futuristic" in n for n in h.notes)


@pytest.mark.parametrize(
    "prompt, expected",
    [
        ("90s boom bap in Bb minor", {"genre": "boombap", "key_root": "A#", "key_mode": "minor"}),
        ("lofi in F#, 2 minutes", {"genre": "lofi", "key_root": "F#", "duration_seconds": 120}),
        ("happy house in C major, full song", {"key_mode": "major", "structure": "full"}),
        ("drill beat, 45 seconds", {"genre": "drill", "duration_seconds": 45}),
        ("chill and calm", {"mood": "chill", "energy": 0.35}),
        ("rnb slow jam", {"genre": "pop"}),
    ],
)  # fmt: skip
def test_rule_interpreter_vocabulary(prompt, expected):
    h = interpret_rules(prompt)
    for field, value in expected.items():
        assert getattr(h, field) == value, field


def test_exclusions_and_approximations():
    h = interpret_rules("lofi with piano and strings, no hi-hats and without drums")
    assert "hihat" in h.exclude and "kick" in h.exclude
    assert "keys" in h.include and "pad" in h.include
    assert any("Piano" in n for n in h.notes) and any("Strings" in n for n in h.notes)


def test_out_of_range_bpm_is_reported_not_used():
    h = interpret_rules("trap at 900 bpm")
    assert h.bpm is None and any("900" in n for n in h.notes)


# --- resolution -------------------------------------------------------------------------


def test_user_settings_override_prompt_and_sources_are_recorded():
    plan = resolve_plan(
        GenerationRequest(prompt="dark trap at 145 bpm", bpm=90, genre="lofi", seed=3)
    )
    assert plan.bpm == 90 and plan.genre == "lofi" and plan.mood == "dark"
    assert plan.sources["bpm"] == "user" and plan.sources["mood"] == "prompt"
    assert plan.sources["keyRoot"] == "default"
    assert plan.interpreter == "rules" and plan.composer == "procedural-v1"


def test_duration_sets_length():
    plan = resolve_plan(GenerationRequest(prompt="trap", bpm=120, duration_seconds=60, seed=1))
    assert plan.bars == 32  # 60 s at 120 BPM = 30 bars, rounded to a multiple of 4
    loop = resolve_plan(GenerationRequest(prompt="trap", bpm=120, duration_seconds=8, seed=1))
    assert loop.structure == "loop" and loop.bars == 4


def test_llm_requested_but_not_configured_falls_back_visibly():
    plan = resolve_plan(GenerationRequest(prompt="trap", interpreter="llm", seed=1))
    assert plan.interpreter == "rules"
    assert any("not configured" in w for w in plan.warnings)


# --- composition ------------------------------------------------------------------------


def test_same_seed_same_song_different_seed_different_song():
    def notes(seed):
        _, doc = generate(prompt=SPEC_PROMPT, seed=seed)
        return [(p.name, [(n.start_beat, n.pitch) for n in p.notes]) for p in doc.patterns]

    assert notes(5) == notes(5)
    assert notes(5) != notes(6)


@pytest.mark.parametrize("genre", ["trap", "drill", "boombap", "lofi", "house", "pop"])
@pytest.mark.parametrize("mood", ["dark", "uplifting", "chill"])
def test_every_genre_produces_a_valid_coherent_song(genre, mood):
    plan, doc = generate(prompt="", genre=genre, mood=mood, seed=11)
    ProjectDocument.model_validate(doc.model_dump())  # integrity: ids and references
    roles = by_role(doc)
    assert {"kick", "bass"} <= set(roles)
    # Melodic material stays in key (generation is diatonic).
    for t in doc.tracks:
        if t.kind == "instrument":
            for evs in [expand_events(doc)[t.id]]:
                assert evs, f"{t.name} never plays"
                assert all(pitch_in_key(e.pitch, plan.key) for e in evs), t.name
    # Song length matches the plan and sections tile it without gaps.
    assert sum(s.length_beats for s in doc.sections) == plan.bars * 4
    for a, b in zip(doc.sections, doc.sections[1:], strict=False):
        assert b.start_beat == a.start_beat + a.length_beats


def test_arrangement_has_variation():
    plan, doc = generate(prompt=SPEC_PROMPT, structure="full")
    names = [s.name for s in doc.sections]
    assert names == ["Intro", "Hook", "Verse", "Hook 2", "Bridge", "Hook 3", "Outro"]
    roles = by_role(doc)
    clips_at = lambda beat: {  # noqa: E731
        c.track_id for c in doc.clips if c.start_beat <= beat < c.start_beat + c.length_beats
    }
    intro, hook = clips_at(0), clips_at(doc.sections[1].start_beat)
    assert roles["kick"].id not in intro and roles["kick"].id in hook
    assert len(hook) > len(intro)
    # Hooks share patterns (edit once, change every hook); verse and hook drums differ.
    hook_kicks = {c.pattern_id for c in doc.clips if c.track_id == roles["kick"].id
                  and doc.sections[1].start_beat <= c.start_beat}  # fmt: skip
    assert len(hook_kicks) <= 3
    pats = {p.id: p for p in doc.patterns}
    lead = [c for c in doc.clips if c.track_id == roles["lead"].id]
    assert len({c.pattern_id for c in lead}) >= 2
    assert {len(pats[c.pattern_id].notes) for c in lead} != {0}


def test_bass_follows_chord_roots_and_kick_in_trap():
    plan, doc = generate(prompt=SPEC_PROMPT, structure="loop")
    roles = by_role(doc)
    events = expand_events(doc)
    kick_beats = {round(e.beat, 3) for e in events[roles["kick"].id]}
    bass = events[roles["bass"].id]
    on_kick = sum(1 for e in bass if round(e.beat, 3) in kick_beats)
    assert on_kick / len(bass) > 0.6
    assert all(28 <= e.pitch <= 52 for e in bass)


def test_house_has_four_on_the_floor_and_trap_snare_on_three():
    _, house = generate(prompt="", genre="house", structure="loop")
    kick = expand_events(house)[by_role(house)["kick"].id]
    assert [e.beat for e in kick[:4]] == [0, 1, 2, 3]
    _, trap = generate(prompt="", genre="trap", structure="loop", drum_intensity=0.3)
    snare = expand_events(trap)[by_role(trap)["snare"].id]
    assert {e.beat % 4 for e in snare} == {2.0}


def test_instrument_selection_is_respected():
    _, doc = generate(prompt=SPEC_PROMPT, instruments=["kick", "snare", "hihat", "bass", "pluck"])
    assert {t.role for t in doc.tracks} == {"kick", "snare", "hihat", "bass", "pluck"}


def test_hat_rolls_appear_at_high_intensity():
    _, doc = generate(prompt="", genre="trap", drum_intensity=1.0, structure="loop", seed=2)
    hats = expand_events(doc)[by_role(doc)["hihat"].id]
    off_grid = [e for e in hats if (e.beat * 4) % 1 > 1e-6]
    assert off_grid, "expected triplet or 32nd-note rolls"


def test_generation_is_bounded():
    _, doc = generate(prompt="", genre="trap", duration_seconds=300, bpm=220, drum_intensity=1)
    total = sum(len(p.notes) for p in doc.patterns)
    assert total < 5000 and len(doc.clips) < 200
    counts = Counter(t.role for t in doc.tracks)
    assert max(counts.values()) == 1
