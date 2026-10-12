# Progress

## Current status

**Phase 4 (beatbox to drums) is complete and verified in a real browser.** Waiting for direction
on Phase 5 (advanced DAW editing).

Last updated: 2026-10-12.

| Phase | Status |
| ----- | ------ |
| 0. Foundation | ✅ Done |
| 1. DAW foundation | 🟡 Vertical slice done. Pan UI, velocity editing, note dragging, rename and reorder still open |
| 2. Text-to-beat | ✅ Done. The Claude interpreter is untested against the live API |
| 3. Humming-to-MIDI | ✅ Done. Tested with a synthetic hum, not yet with a real voice |
| 4. Beatbox-to-drums | ✅ Done. Tested with synthetic beatboxing, not yet with a real beatboxer |

## Phase 4: what was built

- **Beatbox transcription** (`backend/app/transcription/beatbox.py`, `POST /api/transcribe/beatbox`).
  - Onsets come from spectral flux on a dB spectrogram, so quiet, bright hi-hats count as much
    as loud kicks. Each onset is refined to the steepest level rise, because hats decay in
    about 20 ms.
  - A level gate works against the room's noise floor, not against the loudest hit.
  - Each hit is measured for band energies, spectral centroid, flatness and decay (to −10 dB).
    Rule scores give kick, snare, hi-hat, open hat or perc.
  - Similar-sounding hits are clustered so the same mouth sound gets the same class. Hits that
    are clearly one class keep their own label.
  - Each hit gets a confidence and a velocity. Tempo uses the shared estimator.
- **A beat around a drum pattern.** Generation accepts `drums` (hits in beats) in two modes:
  - **Keep:** the hook and verse play the groove exactly.
  - **Expand:** the groove stays, and the hook gains open-hat accents, the genre's perc,
    sixteenth hi-hat pickups and a snare fill. The verse thins the hats to eighth notes.
  - The 808 still locks to your kick in trap and drill. The recording is kept in the project.
- **Beatbox panel.**
  - It uses the same recorder as Hum (now a shared store slice and component).
  - The waveform has a colour-coded marker per hit (K/S/C/H/O/P). Clicking a marker cycles
    its class, including "ignore", and uncertain hits are dashed.
  - A drum-grid preview of the quantized pattern sits under the waveform.
  - Settings: tempo (÷2 and ×2), grid, snap strength, and "Sounds" (which kit sound each
    detected class plays).
  - Actions: Preview (the groove twice on the kit), Download MIDI, add as drum tracks or
    create a project (one "BB" track per sound, opened in the channel rack), and "Build a beat
    around it" (expand or keep).

## Phase 3: what was built

- **Audio assets** (`backend/app/services/assets.py`, `api/assets.py`, migration 0002).
  - Uploads are raw request bodies, validated by actually decoding them with libsndfile.
  - Accepted formats are WAV, FLAC, OGG and MP3, mono or stereo, 8-192 kHz.
  - Limits are 25 MB and 120 s. Sizes are checked while streaming.
  - Files are stored immutably at `data/assets/<sha[:2]>/<sha256>.<ext>`. Client file names
    never become paths.
- **Melody transcription** (`backend/app/transcription`).
  - The pipeline is pYIN pitch tracking, a voicing and energy gate, tuning-offset correction,
    and octave-error repair.
  - Notes are segmented on pitch changes, voicing gaps and articulation dips.
  - Each note gets a confidence (voicing probability × pitch stability) and a velocity.
  - Tempo is estimated by grid fitting, with a half/double-time alternative. Key is estimated
    with Krumhansl-Schmuckler.
  - The output includes a pitch curve for display. `POST /api/transcribe/melody`.
- **A beat around a melody.** The Phase 2 composer accepts a melody.
  - The key comes from the melody unless you set one.
  - Chords are harmonized bar by bar to fit the melody notes, nudged towards the mood's
    progression.
  - Sections are whole multiples of the melody length.
  - The melody plays in hooks and the outro, exactly as given in keep mode. Vary mode adds a
    verse variation.
  - The composer's own lead stays out of the way. The recording is referenced in
    `project.assets`.
- **Hum Melody panel.**
  - Recording has microphone selection, a level meter with a clipping warning, and a timer.
  - Each take shows a waveform, with playback and retake.
  - The review shows a mini piano roll with the sung pitch curve and confidence colouring.
    Clicking a note leaves it out.
  - Review settings: tempo (with ÷2 and ×2), grid, snap strength, a hide-below-confidence
    filter, octave shift and instrument.
  - Actions: Preview, Download MIDI, "Add as a track" or "Create a project", and "Build a beat
    around it" (keep or vary).
- **Piano roll correction tools.** Click selects (Shift or Ctrl adds), double-click deletes.
  Arrows move by the grid, ↑↓ transpose, Shift+↑↓ moves an octave, `[` `]` change length,
  Delete removes, and Ctrl+A selects all. A Quantize button works on the selection or all
  notes. Uncertain notes are dashed amber until edited. The range grows to fit the notes.
- **Schema.** `MidiNote.confidence` was added as optional and nullable. This is additive, so
  the schema stays at version 1. Generation requests accept a `melody`.

## Verified

| Check | Result |
| ----- | ------ |
| Backend tests (pytest) | 120 passed |
| Frontend tests (Vitest) | 50 passed |
| Browser tests (Playwright, Edge) | 4 passed: Phase 1 milestone, Phase 2 generation, Phase 3 hum, Phase 4 beatbox |
| Ruff, oxlint, Prettier, strict typecheck, build | Clean |
| Alembic upgrade and check | Clean (new `assets` table) |

The transcriber was swept over 90 synthetic hums of "Twinkle Twinkle". The sweep covered
70-160 BPM, gaps from legato (18 ms) to detached, detune of ±35 cents, and noise from -35 to
-22 dB. **89 of 90 came out exactly right**, and the remaining one had a single extra note.
Tests also check the tuning estimate, octave-glitch repair, rejection of silence and noise,
and resampling.

In the browser test, Edge's fake microphone played the synthetic hum through the real
pipeline (MediaRecorder, WAV, upload, pYIN):
- All 14 notes were detected with the right pitch names, each with ≥ 93% confidence.
- The key was C major and the tempo 100 BPM.
- A note was then corrected in the piano roll and the project saved.
- A beat was built around the melody (C major, with Melody and 808 tracks), played, and
  exported to MIDI. The melody track holds whole repeats of the 14 notes.

Phase 4 beatbox measurements on synthetic takes of a two-bar boom-bap groove (kick, snare,
hats, open hat; ±15 ms timing jitter), sweeping 75-140 BPM:

| Room noise | Takes with every hit found and correctly classified |
| ---------- | --------------------------------------------------- |
| −50 dB     | 19 / 20 |
| −40 dB     | 20 / 20 |
| −35 dB     | 19 / 20 |
| −30 dB (very hissy) | 14 / 20 (misses or doubled hits; the hits found are classified correctly) |

In the browser test, the fake microphone played a four-bar take through the real pipeline:
- All 32 hits were detected and classified correctly, at 90 BPM.
- A hit was corrected and the open hats were remapped to claps. The result became five
  drum tracks, which were edited in the channel rack, played and saved.
- The groove was then expanded into a full beat and exported to MIDI.

## Not verified

- **A real human voice.** Real humming and beatboxing have breath, drift and sounds the
  synthetic takes only approximate. Expect more uncertain results, and use the correction tools.
- **The Claude interpreter against the live API** (Phase 2). No credentials on this machine.
- **Listening by a person, FL Studio import, docker-compose, GitHub Actions, macOS, Linux,
  Firefox and Safari.**

## Known issues and limitations

- **Beatbox classes are heuristic.** The classes are kick, snare, hi-hat, open hat and perc.
  Claps and rimshots are not told apart from snares; use the click-to-correct markers or the
  Sounds mapping. Very noisy rooms (around −30 dB hiss) cause missed or doubled hits.
- **The first beatbox hit is treated as the downbeat,** as with humming.

- **Monophonic only.** Chords or two voices at once will not transcribe.
- **Tempo from humming is approximate.** Half and double time are inherently ambiguous; use
  ÷2 and ×2. Recording to a click (to know the tempo exactly) is not built yet.
- **The melody starts on bar 1.** A pickup note before the downbeat is treated as the
  downbeat.
- **The first transcription after the backend starts takes about 5 s more** while numba
  compiles pYIN. Later ones take about 1-2 s for a 10 s take, and they run in the request.
- **Hum takes are not playable as audio clips on the timeline.** They are stored and
  referenced. Audio clip playback arrives with the vocal studio (Phase 6).
- **Notes can't be dragged with the mouse yet** (Phase 5). Keyboard editing covers moving,
  transposing and resizing.
- **librosa 1.x requires Python 3.12.** The project uses librosa 0.11 on Python 3.11.
- **Earlier phases' limitations still apply.** For example, procedural composition, no
  undo/redo, and the harmless Tone.js warning.

## Next: Phase 5, advanced DAW editing

Drag, resize and duplicate clips on the timeline. Drag and resize notes in the piano roll,
and edit velocity. Undo/redo, section editing, track grouping, basic automation, more
keyboard shortcuts, a better waveform display, more instruments, and improved saving. This
also covers the Phase 1 leftovers: pan control, rename, recolour and reorder tracks.
