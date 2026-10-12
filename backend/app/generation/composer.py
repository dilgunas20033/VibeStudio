"""Procedural composer (rule-based, seeded): GenerationPlan -> editable ProjectDocument.

This is not a neural model. It encodes common production conventions per genre:
progressions per mood, voice-led chords, a bass that follows the chord roots (and the kick
for trap/drill 808s), motif-based melodies (bar 3 repeats bar 1 transposed to the chord),
genre drum grooves with fills, swing and hat rolls, and an intro/verse/hook/bridge/outro
arrangement. Every musical element ends up as ordinary tracks, patterns, clips and
sections, so the result is fully editable. Same plan + seed -> same song.
"""

import random
from dataclasses import dataclass, field

from app.generation.params import DrumsInput, GenerationPlan, InstrumentName, MelodyInput
from app.generation.theory import (
    PROGRESSIONS,
    Chord,
    degree_to_pitch,
    diatonic_chord,
    voice_chords,
)
from app.schemas.project import (
    AiPromptRecord,
    ArrangementSection,
    AudioAsset,
    Clip,
    Instrument,
    MidiNote,
    MixerSettings,
    Pattern,
    ProjectDocument,
    TimeSignature,
    Track,
    new_id,
    utcnow,
)

BAR = 4  # beats per bar; generation is 4/4
STEP = 0.25  # one sixteenth, in beats
PATTERN_BARS = 4

# (name, colour, General MIDI drum pitch or None for pitched instruments)
INSTRUMENT_INFO: dict[str, tuple[str, str, int | None]] = {
    "kick": ("Kick", "#f0596b", 36),
    "snare": ("Snare", "#f5b84a", 38),
    "clap": ("Clap", "#f58f4a", 39),
    "hihat": ("Hi-hat", "#3ecf8e", 42),
    "openhat": ("Open hat", "#2fb7a0", 46),
    "perc": ("Perc", "#4ab3f5", 37),
    "bass": ("Bass", "#8b6cff", None),
    "keys": ("Keys", "#f5d76c", None),
    "pad": ("Pad", "#6c8bff", None),
    "pluck": ("Pluck", "#ff6cb5", None),
    "lead": ("Lead", "#e46cff", None),
}
TRACK_ORDER: list[InstrumentName] = [
    "kick", "snare", "clap", "hihat", "openhat", "perc", "bass", "keys", "pad", "pluck", "lead"
]  # fmt: skip
VOLUME_DB = {
    "kick": 0.0, "snare": -3.0, "clap": -6.0, "hihat": -9.0, "openhat": -12.0, "perc": -9.0,
    "bass": -3.0, "keys": -8.0, "pad": -12.0, "pluck": -9.0, "lead": -7.0,
}  # fmt: skip


@dataclass(frozen=True)
class DrumStyle:
    kicks: list[list[int]]
    snare: list[int]
    clap: list[int]
    hat_every: int  # base hi-hat spacing in sixteenths
    rolls: bool  # trap-style hat rolls
    swing: float  # 0.5 = straight; 0.56-0.62 = MPC-style swing on off-beat eighths
    openhat: list[int]
    perc: list[int]
    hat_offbeat: bool = False  # house: closed hats on the off-beat


STYLES: dict[str, DrumStyle] = {
    "trap": DrumStyle(
        kicks=[[0, 7, 10], [0, 3, 10], [0, 6, 10, 14], [0, 10, 11], [0, 7, 8, 14]],
        snare=[8], clap=[8], hat_every=2, rolls=True, swing=0.5, openhat=[14], perc=[3, 11],
    ),
    "drill": DrumStyle(
        kicks=[[0, 11], [0, 3, 13], [0, 6, 11], [0, 10, 13]],
        snare=[8], clap=[8], hat_every=3, rolls=True, swing=0.5, openhat=[6], perc=[5, 13],
    ),
    "boombap": DrumStyle(
        kicks=[[0, 7, 10], [0, 3, 8, 10], [0, 10], [0, 6, 9]],
        snare=[4, 12], clap=[12], hat_every=2, rolls=False, swing=0.58, openhat=[14], perc=[6, 14],
    ),
    "lofi": DrumStyle(
        kicks=[[0, 7, 10], [0, 10], [0, 3, 10], [0, 9]],
        snare=[4, 12], clap=[12], hat_every=2, rolls=False, swing=0.6, openhat=[], perc=[7, 15],
    ),
    "house": DrumStyle(
        kicks=[[0, 4, 8, 12]], snare=[4, 12], clap=[4, 12], hat_every=4, rolls=False,
        swing=0.5, openhat=[2, 6, 10, 14], perc=[3, 11], hat_offbeat=True,
    ),
    "pop": DrumStyle(
        kicks=[[0, 8, 10], [0, 6, 8], [0, 7, 8, 14], [0, 3, 8]],
        snare=[4, 12], clap=[4, 12], hat_every=2, rolls=False, swing=0.5, openhat=[14], perc=[],
    ),
}  # fmt: skip

# Which instruments play in each section role (subject to what the plan includes).
DRUM_SET = {"kick", "snare", "clap", "hihat", "openhat", "perc"}

ROLE_INSTRUMENTS: dict[str, set[str]] = {
    "intro": {"pad", "keys", "pluck", "hihat"},
    "verse": {"kick", "snare", "clap", "hihat", "perc", "bass", "keys", "pad", "pluck", "lead"},
    "hook": set(INSTRUMENT_INFO),
    "bridge": {"pad", "keys", "lead", "hihat", "perc", "bass"},
    "outro": {"pad", "keys", "lead", "kick"},
    "loop": set(INSTRUMENT_INFO),
}


@dataclass
class Note:
    beat: float
    dur: float
    pitch: int
    vel: int


@dataclass
class Song:
    plan: GenerationPlan
    progression: list[Chord]
    bridge_progression: list[Chord]
    melody: MelodyInput | None = None
    drums: DrumsInput | None = None
    patterns: dict[tuple[str, str], Pattern] = field(default_factory=dict)


def _rng(plan: GenerationPlan, *parts: str) -> random.Random:
    # String seeds are hashed deterministically by random.Random (sha512), so results are
    # stable across runs and Python processes.
    return random.Random(f"{plan.seed}:{':'.join(parts)}")


def _clamp_vel(v: float) -> int:
    return max(1, min(127, round(v)))


# ---------------------------------------------------------------------------------------
# Arrangement


def harmony_bars(plan: GenerationPlan) -> int:
    """Length of the chord/bass/melody patterns: 4 bars, or the supplied melody's length."""
    return max(PATTERN_BARS, plan.melody_bars or 0)


def plan_sections(plan: GenerationPlan) -> list[tuple[str, str, int]]:
    """[(label, role, bars)] covering about plan.bars. With a melody, every melodic section
    is a whole number of melody lengths so the melody is never cut off."""
    unit = harmony_bars(plan)

    def fit(bars: int) -> int:
        return max(unit, -(-bars // unit) * unit)

    if plan.structure == "loop":
        return [("Loop", "loop", fit(plan.bars))]
    hook = fit(8)
    if plan.structure == "short":
        verse = fit(max(4, plan.bars - 8 - 2 * hook))
        return [("Intro", "intro", 4), ("Hook", "hook", hook), ("Verse", "verse", verse),
                ("Hook 2", "hook", hook), ("Outro", "outro", 4)]  # fmt: skip
    verse = fit(max(8, plan.bars - 16 - 3 * hook))
    return [("Intro", "intro", 4), ("Hook", "hook", hook), ("Verse", "verse", verse),
            ("Hook 2", "hook", hook), ("Bridge", "bridge", fit(8)), ("Hook 3", "hook", hook),
            ("Outro", "outro", 4)]  # fmt: skip


def section_instruments(plan: GenerationPlan, role: str) -> list[str]:
    allowed = ROLE_INSTRUMENTS[role] & set(plan.instruments)
    has = set(plan.instruments)
    if role == "intro" and plan.energy < 0.6:
        allowed.discard("hihat")
    if role in ("intro", "outro") and not (allowed & {"pad", "keys", "pluck", "lead"}):
        # Nothing melodic to carry the intro/outro: let the melody play there instead.
        allowed |= {"lead", "pluck"} & has
    if role == "verse" and "pluck" in has and "lead" in has:
        allowed.discard("lead")  # verse uses the pluck arp; the lead is saved for the hook
    if role == "intro" and "lead" in has and "pluck" in has:
        allowed.discard("pluck")
    if role == "verse" and "snare" in has:
        allowed.discard("clap")  # clap layers in on hooks only
    if plan.drum_mode == "keep" and role == "verse":
        allowed |= DRUM_SET & has  # keep mode: the verse plays every beatboxed drum
    m = plan.melody_instrument
    if m is not None:
        # The user's melody is the hook. It sits out the intro and bridge, and plays in the
        # verse only as a variation when asked.
        if role in ("hook", "loop", "outro") or (role == "verse" and plan.melody_mode == "vary"):
            allowed.add(m)
        else:
            allowed.discard(m)
    return [i for i in TRACK_ORDER if i in allowed]


# ---------------------------------------------------------------------------------------
# Drums


def drum_notes(plan: GenerationPlan, inst: str, role: str) -> list[Note]:
    style = STYLES[plan.genre]
    rng = _rng(plan, "drum", inst, role)
    intensity = plan.drum_intensity - (0.15 if role in ("verse", "intro", "bridge") else 0.0)
    pitch = INSTRUMENT_INFO[inst][2] or 36
    notes: list[Note] = []

    def hit(bar: int, step: float, vel: float) -> None:
        beat = bar * BAR + step * STEP
        if style.swing > 0.5 and float(step).is_integer() and int(step) % 4 == 2:
            beat += (style.swing - 0.5) * 1.0  # delay the off-beat eighth
        human = rng.uniform(-6, 6) if plan.genre in ("boombap", "lofi") else rng.uniform(-3, 3)
        notes.append(Note(beat, STEP, pitch, _clamp_vel(vel + human)))

    if inst == "kick":
        a = rng.choice(style.kicks)
        b = rng.choice(style.kicks)
        if intensity > 0.65 and plan.genre in ("trap", "drill", "pop"):
            b = sorted(set(b) | {rng.choice([5, 9, 13, 15])})
        for bar in range(PATTERN_BARS):
            steps = a if bar % 2 == 0 else b
            if role == "outro":
                steps = [0]
            for s in steps:
                hit(bar, s, 112 if s == 0 else 100)
    elif inst in ("snare", "clap"):
        base = style.snare if inst == "snare" else style.clap
        for bar in range(PATTERN_BARS):
            for s in base:
                hit(bar, s, 108 if inst == "snare" else 96)
            if inst == "snare" and bar == PATTERN_BARS - 1 and intensity > 0.55 and role != "intro":
                fill = [13, 14, 15] if style.rolls else [14, 15]
                for i, s in enumerate(fill):
                    hit(bar, s, 55 + i * 15)
            elif inst == "snare" and plan.genre in ("boombap", "lofi") and rng.random() < 0.5:
                hit(bar, rng.choice([7, 10, 15]), 45)  # ghost note
    elif inst == "hihat":
        every = style.hat_every if role != "intro" else max(style.hat_every, 4)
        sixteenths = intensity > 0.55 and not style.hat_offbeat and role != "intro"
        for bar in range(PATTERN_BARS):
            roll_at = None
            if style.rolls and role != "intro" and bar % 2 == 1 and rng.random() < intensity:
                roll_at = rng.choice([12, 14])
            s = 2 if style.hat_offbeat else 0
            while s < 16:
                if roll_at is not None and s >= roll_at:
                    break
                accent = 100 if s % 4 == 0 else 78
                hit(bar, s, accent)
                if sixteenths and s % 2 == 0 and every == 2 and rng.random() < (intensity - 0.4):
                    hit(bar, s + 1, 62)
                s += every
            if roll_at is not None:
                # Triplet or 32nd-note roll up to the end of the bar, getting louder.
                div = rng.choice([3, 4])
                count = (16 - roll_at) * div // 2
                for i in range(count):
                    pos = roll_at + i * (2 / div)
                    hit(bar, pos, 60 + 40 * i / max(1, count - 1))
    elif inst == "openhat":
        for bar in range(PATTERN_BARS):
            if style.hat_offbeat or bar % 2 == 1:
                for s in style.openhat:
                    hit(bar, s, 85)
        for n in notes:
            n.dur = 0.5
    elif inst == "perc":
        for bar in range(PATTERN_BARS):
            for s in style.perc:
                if rng.random() < 0.4 + intensity * 0.5:
                    hit(bar, s, 80)
    return notes


# ---------------------------------------------------------------------------------------
# Bass and chords


def _bass_pitch(plan: GenerationPlan, chord: Chord, low: int) -> int:
    """The chord root as the lowest matching pitch at or above `low`."""
    pc = degree_to_pitch(plan.key, chord.degree, 4) % 12
    return low + (pc - low) % 12


def bass_notes(
    plan: GenerationPlan,
    chords: list[Chord],
    role: str,
    kick_steps: list[list[int]] | None = None,
) -> list[Note]:
    """Bassline on the chord roots. For 808 styles, `kick_steps` (per bar) locks the bass
    rhythm to the actual kick pattern, as producers usually do."""
    rng = _rng(plan, "bass", role)
    style = STYLES[plan.genre]
    is808 = plan.genre in ("trap", "drill")
    low = 28 if is808 else 33  # E1 for 808s, A1 for synth bass
    vel = 95 + plan.bass_intensity * 25
    notes: list[Note] = []

    for bar, chord in enumerate(chords):
        root = _bass_pitch(plan, chord, low)
        start = bar * BAR
        if role == "bridge":
            notes.append(Note(start, BAR, root, _clamp_vel(vel - 10)))
            continue
        if is808:
            kick = kick_steps[bar % len(kick_steps)] if kick_steps else rng.choice(style.kicks)
            steps = sorted(set([0, *kick]))
        elif plan.genre == "house":
            steps = [2, 6, 10, 14]
        elif plan.genre == "pop":
            steps = [
                s for s in range(0, 16, 2) if s in (0, 8) or rng.random() < plan.bass_intensity
            ]
        else:  # boombap / lofi
            steps = [0] + [s for s in rng.choice(style.kicks) if s >= 6]
        for i, s in enumerate(steps):
            end = steps[i + 1] if i + 1 < len(steps) else 16
            length = (end - s) * STEP
            if plan.genre == "house":
                length = 0.4
            elif not is808:
                length = min(length, 1.5) - 0.05
            pitch = root
            if (not is808 and i > 0 and rng.random() < 0.3) or (
                is808 and plan.bass_intensity > 0.7 and s == 14 and rng.random() < 0.6
            ):
                pitch = root + (7 if not is808 else 12)  # fifth, or an 808 octave jump
            notes.append(Note(start + s * STEP, max(STEP, length), pitch, _clamp_vel(vel)))
    return notes


def chord_notes(plan: GenerationPlan, chords: list[Chord], inst: str, role: str) -> list[Note]:
    low, high = (52, 76) if inst == "pad" else (55, 79)
    voicings = voice_chords(plan.key, chords, low, high)
    rng = _rng(plan, "chords", inst, role)
    notes: list[Note] = []
    for bar, pitches in enumerate(voicings):
        start = bar * BAR
        if inst == "pad" or plan.genre in ("trap", "drill") or role in ("intro", "outro"):
            hits = [(0.0, BAR - 0.05 if inst == "pad" else 2.0)]
            if inst == "keys" and role not in ("intro", "outro"):
                hits.append((2.0, 1.9))
        elif plan.genre == "house":
            hits = [(s * STEP, 0.35) for s in (2, 6, 10, 14)]
        elif plan.genre == "pop":
            hits = [(b, 0.8) for b in range(4)]
        else:  # boombap / lofi: long chord plus an anticipation
            hits = [(0.0, 2.75), (3.0 + rng.choice([0.0, 0.5]), 0.9)]
        for offset, dur in hits:
            for p in pitches:
                v = 72 if inst == "pad" else 84
                notes.append(Note(start + offset, dur, p, _clamp_vel(v + rng.uniform(-4, 4))))
    return notes


# ---------------------------------------------------------------------------------------
# Melody


def _chord_tone_near(chord: Chord, target: int, lo: int, hi: int) -> int:
    options = [t + 7 * o for t in chord.tones for o in range(-3, 4)]
    options = [d for d in options if lo <= d <= hi] or [lo]
    return min(options, key=lambda d: abs(d - target))


def melody_notes(plan: GenerationPlan, chords: list[Chord], role: str, inst: str) -> list[Note]:
    rng = _rng(plan, "melody", inst, role)
    density = plan.melodic_complexity * (0.6 if role in ("verse", "intro", "bridge") else 1.0)
    per_bar = max(2, min(8, round(2 + density * 6)))
    # Scale-degree range, octave 4 = degree 0 at the key's root in octave 4.
    lo, hi = (2, 12) if inst == "lead" else (0, 10)
    if role == "verse":
        lo, hi = lo - 2, hi - 3
    octave = 4

    def rhythm(n: int, cadence: bool = False) -> list[int]:
        weights = [6 if s % 4 == 0 else 3 if s % 2 == 0 else 1 for s in range(16)]
        if cadence:
            n = max(2, n - 2)
            weights = [w if s < 10 else 0 for s, w in enumerate(weights)]
        chosen = {0}
        while len(chosen) < n:
            chosen.add(rng.choices(range(16), weights=weights)[0])
        return sorted(chosen)

    r_a, r_b = rhythm(per_bar), rhythm(per_bar)
    r_end = rhythm(per_bar, cadence=True)

    def bar_degrees(onsets: list[int], chord: Chord, start: int) -> list[int]:
        degrees, prev = [], start
        for s in onsets:
            if s % 4 == 0:
                d = _chord_tone_near(chord, prev + rng.choice([-1, 0, 1]), lo, hi)
            else:
                d = prev + rng.choices([-2, -1, 1, 2], weights=[1, 3, 3, 1])[0]
                d = max(lo, min(hi, d))
            degrees.append(d)
            prev = d
        return degrees

    start = (lo + hi) // 2
    bar1 = bar_degrees(r_a, chords[0], start)
    bar2 = bar_degrees(r_b, chords[1], bar1[-1])
    shift = chords[2].degree - chords[0].degree
    if shift > 3:
        shift -= 7
    bar3 = [max(lo, min(hi, d + shift)) for d in bar1]  # motif repeat, moved to the chord
    bar4 = bar_degrees(r_end, chords[3], bar3[-1])
    bar4[-1] = _chord_tone_near(chords[3], bar4[-1], lo, hi)

    notes: list[Note] = []
    for bar, (onsets, degrees) in enumerate([(r_a, bar1), (r_b, bar2), (r_a, bar3), (r_end, bar4)]):
        for i, (s, d) in enumerate(zip(onsets, degrees, strict=True)):
            nxt = onsets[i + 1] if i + 1 < len(onsets) else 16
            dur = (nxt - s) * STEP - 0.05
            if i + 1 < len(onsets):
                dur = min(dur, 1.5)
            vel = 104 if s % 4 == 0 else 88
            notes.append(
                Note(bar * BAR + s * STEP, max(0.1, dur), degree_to_pitch(plan.key, d, octave),
                     _clamp_vel(vel + rng.uniform(-6, 6)))
            )  # fmt: skip
    return notes


def arp_notes(plan: GenerationPlan, chords: list[Chord], role: str) -> list[Note]:
    rng = _rng(plan, "arp", role)
    voicings = voice_chords(plan.key, chords, 60, 84)
    step_beats = 0.25 if plan.melodic_complexity > 0.55 else 0.5
    shape = rng.choice(["up", "updown", "down"])
    notes: list[Note] = []
    for bar, pitches in enumerate(voicings):
        seq = pitches + [pitches[0] + 12]
        if shape == "down":
            seq = seq[::-1]
        elif shape == "updown":
            seq = seq + seq[-2:0:-1]
        count = int(BAR / step_beats)
        for i in range(count):
            notes.append(
                Note(bar * BAR + i * step_beats, step_beats * 0.9, seq[i % len(seq)],
                     _clamp_vel((96 if i % 4 == 0 else 78) + rng.uniform(-5, 5)))
            )  # fmt: skip
    return notes


# ---------------------------------------------------------------------------------------
# Melody supplied by the user


def harmonize(plan: GenerationPlan, melody: MelodyInput, bars: int, sevenths: bool) -> list[Chord]:
    """Pick one diatonic chord per bar that fits the melody notes in that bar.

    Each candidate scores the melody time spent on its chord tones (strong beats count
    more), minus clashes a semitone from a chord tone, plus a nudge towards the mood's
    usual progression so the result still sounds like the requested style.
    """
    rng = _rng(plan, "harmonize")
    prior = rng.choice(PROGRESSIONS[plan.mood])
    scale_pc = [degree_to_pitch(plan.key, d, 4) % 12 for d in range(7)]
    length = (plan.melody_bars or 1) * BAR
    chords: list[Chord] = []
    for bar in range(bars):
        lo = (bar * BAR) % length
        weights: dict[int, float] = {}
        for n in melody.notes:
            a, b = max(n.start_beat, lo), min(n.start_beat + n.duration_beats, lo + BAR)
            if b <= a:
                continue
            strong = 1.5 if abs(n.start_beat - round(n.start_beat)) < 1e-6 else 1.0
            weights[n.pitch % 12] = weights.get(n.pitch % 12, 0.0) + (b - a) * strong
        total = sum(weights.values())
        suggested = prior[bar % len(prior)]
        best, best_score = suggested, -1e9
        for degree in range(7):
            tones = {scale_pc[(degree + k) % 7] for k in (0, 2, 4)}
            fit = sum(w for pc, w in weights.items() if pc in tones)
            clash = sum(
                w
                for pc, w in weights.items()
                if pc not in tones and any((pc - t) % 12 in (1, 11) for t in tones)
            )
            score = fit - 0.5 * clash
            if degree == suggested:
                score += 0.35 * total + 0.1
            if bar == 0 and degree == 0:
                score += 0.15 * total  # gently prefer starting on the home chord
            if score > best_score:
                best, best_score = degree, score
        chords.append(diatonic_chord(best, sevenths))
    return chords


def melody_pattern_notes(melody: MelodyInput, bars: int) -> list[Note]:
    """The user's notes exactly (keep mode), clipped to the melody length."""
    end = bars * BAR
    return [
        Note(n.start_beat, min(n.duration_beats, end - n.start_beat), n.pitch, n.velocity)
        for n in melody.notes
        if n.start_beat < end
    ]


def melody_variation(
    plan: GenerationPlan, melody: MelodyInput, chords: list[Chord], bars: int
) -> list[Note]:
    """Same rhythm; some weak-beat notes move to a nearby tone of that bar's chord."""
    rng = _rng(plan, "variation")
    out = []
    for n in melody_pattern_notes(melody, bars):
        on_beat = abs(n.beat - round(n.beat)) < 1e-6
        if on_beat or rng.random() < 0.35:
            out.append(n)
            continue
        chord = chords[int(n.beat // BAR) % len(chords)]
        tones = sorted(degree_to_pitch(plan.key, t, o) for t in chord.tones for o in range(2, 7))
        near = [p for p in tones if 0 < abs(p - n.pitch) <= 4]
        out.append(Note(n.beat, n.dur, rng.choice(near) if near else n.pitch, n.vel))
    return out


# ---------------------------------------------------------------------------------------
# Drums supplied by the user


def _tile(notes: list[Note], length: float, to: float) -> list[Note]:
    """Repeat a pattern of `length` beats to fill `to` beats."""
    if length <= 0:
        return notes
    out = []
    reps = int(-(-to // length))
    for r in range(reps):
        out += [
            Note(n.beat + r * length, n.dur, n.pitch, n.vel)
            for n in notes
            if n.beat + r * length < to
        ]
    return out


def user_drum_notes(
    plan: GenerationPlan, song: "Song", inst: str, variant: str, bars: int
) -> list[Note]:
    """The user's hits for one drum, adapted to the section.

    keep:   hook/loop/verse play the hits exactly; other sections follow the usual rules.
    expand: the hook adds a fill on the last bar; the verse is thinned (no off-beat hats,
            no open hats); parts the user didn't play come from the genre groove.
    """
    assert song.drums is not None
    pitch = INSTRUMENT_INFO[inst][2] or 36
    d_len = (plan.drum_bars or 1) * BAR
    hits = [h for h in song.drums.hits if h.drum == inst and h.start_beat < d_len]
    if not hits:  # a part the user didn't beatbox: generated (expand mode only)
        return _tile(drum_notes(plan, inst, variant), PATTERN_BARS * BAR, bars * BAR)
    base = [Note(h.start_beat, STEP if inst != "openhat" else 0.5, pitch, h.velocity) for h in hits]
    notes = _tile(base, d_len, bars * BAR)
    keep = plan.drum_mode == "keep"
    if variant == "outro":
        return (
            [n for n in notes if abs(n.beat % BAR) < 1e-6 and n.beat < BAR * 2]
            if inst == "kick"
            else []
        )
    if keep or variant in ("hook", "loop"):
        if not keep and inst == "hihat":
            # Expand: a sixteenth-note pickup into every second bar.
            have = {round(n.beat, 3) for n in notes}
            for bar in range(1, bars, 2):
                b = bar * BAR + 3.75
                if round(b, 3) not in have:
                    notes.append(Note(b, STEP, pitch, 62))
        if not keep and inst == "snare" and plan.drum_intensity > 0.5:
            last = (bars - 1) * BAR
            have = {round(n.beat, 3) for n in notes}
            for i, s in enumerate((13, 14, 15)):
                b = last + s * STEP
                if round(b, 3) not in have:
                    notes.append(Note(b, STEP, pitch, 55 + 15 * i))
        return notes
    if variant == "verse":
        if inst == "openhat":
            return []
        if inst == "hihat":
            return [n for n in notes if abs((n.beat * 2) % 1) < 1e-6]  # eighth notes only
        return notes
    if variant in ("intro", "bridge"):
        return notes if inst in ("hihat", "perc") else []
    return notes


# ---------------------------------------------------------------------------------------
# Assembly


def _pattern_for(song: Song, inst: str, role: str) -> Pattern:
    plan = song.plan
    variant = "hook" if role == "loop" else role
    if inst in ("lead", "pluck") and variant == "outro":
        variant = "hook"  # the outro restates the hook melody, so share its pattern
    key = (inst, variant)
    if key in song.patterns:
        return song.patterns[key]

    chords = song.bridge_progression if variant == "bridge" else song.progression
    has_lead = "lead" in plan.instruments
    length_bars = PATTERN_BARS if INSTRUMENT_INFO[inst][2] is not None else len(chords)
    confidences: dict[tuple[float, int], float] = {}
    if song.melody is not None and inst == plan.melody_instrument:
        length_bars = plan.melody_bars or PATTERN_BARS
        if variant == "verse":
            notes = melody_variation(plan, song.melody, song.progression, length_bars)
        else:
            notes = melody_pattern_notes(song.melody, length_bars)
            confidences = {
                (round(n.start_beat, 4), n.pitch): n.confidence
                for n in song.melody.notes
                if n.confidence is not None
            }
    elif INSTRUMENT_INFO[inst][2] is not None and song.drums is not None:
        length_bars = max(PATTERN_BARS, plan.drum_bars or 0)
        notes = user_drum_notes(plan, song, inst, variant, length_bars)
    elif INSTRUMENT_INFO[inst][2] is not None:
        notes = drum_notes(plan, inst, variant)
    elif inst == "bass":
        kick_steps = None
        if plan.genre in ("trap", "drill") and "kick" in section_instruments(plan, role):
            kick = _pattern_for(song, "kick", role)
            kick_steps = [
                sorted({round((n.start_beat - bar * BAR) / STEP) for n in kick.notes
                        if bar * BAR <= n.start_beat < (bar + 1) * BAR})
                for bar in range(PATTERN_BARS)
            ]  # fmt: skip
        notes = bass_notes(plan, chords, variant, kick_steps)
    elif inst in ("pad", "keys"):
        notes = chord_notes(plan, chords, inst, variant)
    elif inst == "pluck" and has_lead:
        notes = arp_notes(plan, chords, variant)
    else:  # lead, or a pluck carrying the melody
        notes = melody_notes(plan, chords, variant, inst)

    label = {"loop": "Loop", "hook": "Hook", "verse": "Verse", "intro": "Intro",
             "bridge": "Bridge", "outro": "Outro"}[variant]  # fmt: skip
    pattern = Pattern(
        id=new_id("pat"),
        name=f"{label} {_track_name(plan, inst)}",
        length_beats=length_bars * BAR,
        notes=[
            MidiNote(
                id=new_id("note"),
                pitch=n.pitch,
                start_beat=round(n.beat, 4),
                duration_beats=round(max(0.05, n.dur), 4),
                velocity=n.vel,
                confidence=confidences.get((round(n.beat, 4), n.pitch)),
            )
            for n in sorted(notes, key=lambda n: (n.beat, n.pitch))
            if 0 <= n.beat < length_bars * BAR
        ],
    )
    song.patterns[key] = pattern
    return pattern


def _track_name(plan: GenerationPlan, inst: str) -> str:
    if inst == plan.melody_instrument:
        return "Melody"
    if inst == "bass" and plan.genre in ("trap", "drill"):
        return "808"
    return INSTRUMENT_INFO[inst][0]


def compose(
    plan: GenerationPlan,
    prompt: str = "",
    melody: MelodyInput | None = None,
    assets: list[AudioAsset] | None = None,
    drums: DrumsInput | None = None,
) -> ProjectDocument:
    prog_rng = _rng(plan, "progression")
    sevenths = plan.genre in ("lofi", "boombap") or plan.mood in ("chill", "dreamy")
    degrees = prog_rng.choice(PROGRESSIONS[plan.mood])
    alt = [p for p in PROGRESSIONS[plan.mood] if p != degrees] or [degrees]
    bridge_degrees = prog_rng.choice(alt)
    if melody is not None:
        progression = harmonize(plan, melody, harmony_bars(plan), sevenths)
    else:
        progression = [diatonic_chord(d, sevenths) for d in degrees]
    song = Song(
        plan=plan,
        progression=progression,
        bridge_progression=[diatonic_chord(d, sevenths) for d in bridge_degrees],
        melody=melody,
        drums=drums,
    )

    sections = plan_sections(plan)
    used: dict[str, list[tuple[int, int, Pattern]]] = {}
    beat = 0
    doc_sections: list[ArrangementSection] = []
    for label, role, bars in sections:
        doc_sections.append(
            ArrangementSection(
                id=new_id("sec"), name=label, start_beat=beat, length_beats=bars * BAR
            )
        )
        for inst in section_instruments(plan, role):
            used.setdefault(inst, []).append((beat, bars * BAR, _pattern_for(song, inst, role)))
        beat += bars * BAR

    tracks: list[Track] = []
    clips: list[Clip] = []
    for inst in TRACK_ORDER:
        if inst not in used:
            continue
        name, color, gm = INSTRUMENT_INFO[inst]
        volume = VOLUME_DB[inst]
        if inst == "bass":
            volume += (plan.bass_intensity - 0.6) * 8
        track = Track(
            id=new_id("trk"),
            name=_track_name(plan, inst),
            kind="drums" if gm is not None else "instrument",
            role=inst,
            color=color,
            instrument=Instrument(type="drum" if gm is not None else "synth", preset=inst),
            mixer=MixerSettings(volume_db=round(max(-60.0, min(6.0, volume)), 1)),
        )
        tracks.append(track)
        for start, length, pattern in used[inst]:
            clips.append(
                Clip(id=new_id("clp"), track_id=track.id, pattern_id=pattern.id,
                     start_beat=start, length_beats=length)
            )  # fmt: skip

    built = f" around a {plan.melody_bars}-bar melody ({plan.melody_mode})" if melody else ""
    if drums:
        built += f" around a {plan.drum_bars}-bar drum pattern ({plan.drum_mode})"
    summary = (
        f"Procedural composer v1{built} ({plan.interpreter} interpretation): "
        f"{plan.genre}, {plan.mood}, "
        f"{plan.bpm:g} BPM, {plan.key.root} {plan.key.mode}, {plan.bars} bars, seed {plan.seed}."
    )
    doc = ProjectDocument(
        id=new_id("prj"),
        name=plan.title,
        bpm=plan.bpm,
        key=plan.key,
        time_signature=TimeSignature(numerator=4, denominator=4),
        tracks=tracks,
        patterns=[p for p in song.patterns.values() if p.id in {c.pattern_id for c in clips}],
        clips=clips,
        sections=doc_sections,
        assets=assets or [],
        ai_history=[
            AiPromptRecord(
                id=new_id("ai"), created_at=utcnow(), prompt=prompt[:4000], summary=summary
            )
        ],
    )
    return ProjectDocument.model_validate(doc.model_dump())
