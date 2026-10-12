"""Keyword-rule prompt interpreter.

Deterministic and offline. It recognises a vocabulary of genre, mood, tempo, key,
instrument and intensity words. It does not understand language: anything outside the
vocabulary is ignored. The LLM interpreter (llm.py) produces the same PromptHints when
configured.
"""

import re

from app.generation.params import InstrumentName, Mood, PromptHints

FLATS = {"Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#", "Cb": "B", "Fb": "E"}

# Order matters: more specific phrases first.
GENRE_WORDS: list[tuple[str, str]] = [
    (r"\bdrill\b", "drill"),
    (r"\btrap\b", "trap"),
    (r"\b(boom[ -]?bap|90s|old[ -]?school|golden era)\b", "boombap"),
    (r"\b(lo-?fi|chillhop|study beats?)\b", "lofi"),
    (r"\b(house|techno|edm|dance|club|four on the floor)\b", "house"),
    (r"\bpop\b", "pop"),
    (r"\b(hip[ -]?hop|rap)\b", "boombap"),
]
GENRE_APPROXIMATIONS: list[tuple[str, str, str]] = [
    (r"\b(r&b|rnb|r and b|soul)\b", "pop", "R&B is not a dedicated style yet; used pop rules."),
    (r"\b(phonk)\b", "trap", "Phonk is not a dedicated style yet; used trap rules."),
    (
        r"\b(afrobeats?|amapiano)\b",
        "house",
        "Afrobeats is not a dedicated style yet; used house rules.",
    ),
]

MOOD_WORDS: list[tuple[str, Mood]] = [
    (r"\b(dark|evil|sinister|menacing|eerie|haunting|gloomy|grim)\b", "dark"),
    (r"\b(sad|emotional|melanchol\w*|heartbreak\w*|nostalgic|lonely|pain\w*)\b", "emotional"),
    (r"\b(aggressive|angry|hard[- ]hitting|rage|violent|grimy)\b", "aggressive"),
    (r"\b(happy|uplifting|bright|summer\w*|euphoric|joyful|feel[- ]good|positive)\b", "uplifting"),
    (r"\b(chill|relaxed|calm|smooth|mellow|laid[- ]back|cozy|jazzy)\b", "chill"),
    (r"\b(dreamy|spacey|spacy|ethereal|atmospheric|ambient|floaty|cosmic)\b", "dreamy"),
]

HIGH_ENERGY = r"\b(energetic|high[- ]energy|hype|bouncy|intense|hard|banger|aggressive|fast)\b"
LOW_ENERGY = r"\b(chill|calm|minimal|soft|mellow|relaxed|low[- ]energy|slow|gentle|sleepy)\b"

INSTRUMENT_WORDS: list[tuple[str, InstrumentName, str | None]] = [
    (r"\b808s?\b|\bbass(line)?s?\b|\bsub\b", "bass", None),
    (r"\b(lead|synth lead|melody|melodies|synths?|hook melody)\b", "lead", None),
    (r"\b(pads?|atmospher\w*|textures?|ambien\w*|drones?)\b", "pad", None),
    (r"\b(plucks?|arps?|arpeggi\w*|bells?)\b", "pluck", None),
    (r"\b(keys|rhodes|chords|electric piano)\b", "keys", None),
    (r"\bpianos?\b", "keys", "Piano is approximated by the synth keys instrument."),
    (r"\b(strings?|violins?|orchestra\w*)\b", "pad", "Strings are approximated by a synth pad."),
    (r"\b(guitars?)\b", "pluck", "Guitar is approximated by a synth pluck."),
    (
        r"\b(flutes?|choir|vocal chops?|horns?|brass|sax\w*)\b",
        "lead",
        "{word} is approximated by a synth lead.",
    ),
    (r"\bkicks?\b", "kick", None),
    (r"\bsnares?\b", "snare", None),
    (r"\bclaps?\b", "clap", None),
    (r"\b(hi-?hats?|hats)\b", "hihat", None),
    (r"\bopen hats?\b", "openhat", None),
    (r"\b(perc|percussion|rims?|shakers?|congas?)\b", "perc", None),
]
DRUM_KIT: list[InstrumentName] = ["kick", "snare", "clap", "hihat", "openhat", "perc"]


def _find(pattern: str, text: str) -> re.Match[str] | None:
    return re.search(pattern, text, flags=re.IGNORECASE)


def _parse_key(text: str) -> tuple[str | None, str | None]:
    m = re.search(
        r"\b(?:in\s+(?:the\s+key\s+of\s+)?|key\s+(?:of\s+)?)?([A-G])\s?(#|♯|b|♭|sharp|flat)?"
        r"\s?(major|minor|maj|min|m)\b",
        text,
    )
    if not m:
        # "#" is not a word character, so use a lookahead rather than \b after the accidental.
        m2 = re.search(r"\b(?:in|key of)\s+([A-G])(#|b)?(?![\w#])", text)
        if not m2:
            return None, None
        root, acc, mode = m2.group(1), m2.group(2) or "", None
    else:
        root, acc, mode = m.group(1), m.group(2) or "", m.group(3)
    acc = {"♯": "#", "sharp": "#", "♭": "b", "flat": "b"}.get(acc.lower(), acc)
    name = root + acc
    name = FLATS.get(name, name)
    if name in ("E#", "B#"):
        name = {"E#": "F", "B#": "C"}[name]
    norm_mode = None
    if mode:
        norm_mode = "major" if mode.lower() in ("major", "maj") else "minor"
    return name, norm_mode


def interpret_rules(prompt: str) -> PromptHints:
    text = prompt.strip()
    lower = text.lower()
    h = PromptHints()
    notes: list[str] = []

    for pattern, genre in GENRE_WORDS:
        if _find(pattern, lower):
            h.genre = genre  # type: ignore[assignment]
            break
    if h.genre is None:
        for pattern, genre, note in GENRE_APPROXIMATIONS:
            if _find(pattern, lower):
                h.genre = genre  # type: ignore[assignment]
                notes.append(note)
                break

    for pattern, mood in MOOD_WORDS:
        if _find(pattern, lower):
            h.mood = mood
            break

    high, low = _find(HIGH_ENERGY, lower), _find(LOW_ENERGY, lower)
    if high and not low:
        h.energy = 0.8
    elif low and not high:
        h.energy = 0.35
    elif high and low:
        h.energy = 0.6

    if m := re.search(r"\b(\d{2,3}(?:\.\d+)?)\s*bpm\b", lower):
        bpm = float(m.group(1))
        if 40 <= bpm <= 220:
            h.bpm = bpm
        else:
            notes.append(f"{m.group(1)} BPM is outside the supported 40-220 range; ignored.")

    root, mode = _parse_key(text)
    h.key_root, h.key_mode = root, mode  # type: ignore[assignment]

    # Units must be spelled out: "808s" and "90s" are not durations.
    if m := re.search(r"\b(\d{1,3})\s*(?:seconds?|secs?)\b", lower):
        h.duration_seconds = min(300.0, max(8.0, float(m.group(1))))
    elif m := re.search(r"\b(\d(?:\.\d)?)\s*(?:minutes?|mins?)\b", lower):
        h.duration_seconds = min(300.0, max(8.0, float(m.group(1)) * 60))
    if _find(r"\b(full song|full track|whole song|complete song|arrangement)\b", lower):
        h.structure = "full"
    elif _find(r"\b(loop|loops|sample pack|short loop)\b", lower):
        h.structure = "loop"
    elif _find(r"\b(short song|short track|snippet)\b", lower):
        h.structure = "short"

    include: list[InstrumentName] = []
    for pattern, inst, note in INSTRUMENT_WORDS:
        if m := _find(pattern, lower):
            if inst not in include:
                include.append(inst)
            if note:
                notes.append(note.format(word=m.group(0).capitalize()))
    if _find(r"\b(no|without)\s+drums\b|\bdrumless\b", lower):
        h.exclude = list(DRUM_KIT)
        include = [i for i in include if i not in DRUM_KIT]
    # "no hi-hats", "without 808": exclude whatever instrument the following words name.
    for m in re.finditer(r"\b(?:no|without)\s+([a-z0-9\-]+(?:\s[a-z\-]+)?)", lower):
        phrase = m.group(1)
        for pattern, inst, _ in INSTRUMENT_WORDS:
            if _find(pattern, phrase) and inst not in h.exclude:
                h.exclude.append(inst)
                if inst in include:
                    include.remove(inst)
    h.include = include

    if _find(r"\b(simple|minimal|sparse|stripped)\b", lower):
        h.complexity = 0.3
        h.melodic_complexity = 0.3
    elif _find(r"\b(complex|intricate|busy|detailed|technical)\b", lower):
        h.complexity = 0.8
        h.melodic_complexity = 0.75
    if _find(
        r"\b(rolling|fast|skippy|crazy)\s+(hi-?)?hats\b|\bhat rolls?\b|\bpunchy\b|\bhard drums\b",
        lower,
    ):
        h.drum_intensity = 0.8
    if _find(r"\b(soft|light|gentle)\s+drums\b", lower):
        h.drum_intensity = 0.3
    if _find(r"\b(heavy|distorted|big|booming|hard|deep)\s+(808s?|bass)\b", lower):
        h.bass_intensity = 0.85
    if _find(r"\b(dreamy|catchy|memorable)\s+(lead|melody|hook)\b", lower):
        h.melodic_complexity = h.melodic_complexity or 0.55

    if _find(r"\bfuturistic\b", lower):
        notes.append("“Futuristic” has no specific rule yet; it doesn't change the sound.")
    if _find(r"\b(slide|slides|sliding|glide)\b", lower):
        notes.append("808 slides (pitch glides) are not supported by the engine yet.")
    if _find(r"\b(vocals?|singing|rapper)\b", lower) and not _find(r"\bvocal chops?\b", lower):
        notes.append("Vocals are recorded in the vocal studio (Phase 6); none were generated.")
    if _find(r"\b(\d+/\d+|waltz|triplet feel|6/8|3/4)\b", lower):
        notes.append("Generated beats are 4/4 for now.")

    h.notes = notes
    return h
