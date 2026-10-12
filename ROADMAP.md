# Roadmap

This file tracks every phase and feature from the VibeStudio master specification. Features
are never removed or marked done without verification. Details for each feature live in the
master spec. This file tracks scope and status.

Status key: ✅ done and verified · 🟡 partial · ⬜ not started

Each phase ends at its boundary. The next phase starts only on the project owner's direction.

---

## Phase 0: Project planning and initial setup ✅

| Task                                         | Status | Notes                                              |
| -------------------------------------------- | ------ | -------------------------------------------------- |
| Inspect repository                           | ✅     | Found only two empty placeholder files             |
| Architecture proposal                        | ✅     | ARCHITECTURE.md                                    |
| Folder structure                             | ✅     |                                                    |
| React/TypeScript app                         | ✅     | Vite 8, React 19, TS strict                        |
| FastAPI backend                              | ✅     |                                                    |
| Frontend/backend communication               | ✅     | Vite proxy, typed client                           |
| Development scripts                          | ✅     | `npm run setup`, `dev`, `check`                    |
| Linting and formatting                       | ✅     | Ruff, oxlint, Prettier                             |
| Environment variables                        | ✅     | `.env.example`                                     |
| Docker development configuration            | 🟡     | Written, not run here because Docker is not installed |
| Project roadmap                              | ✅     | This file                                          |
| Versioned project schema                     | ✅     | Schema v1, shared JSON Schema, generated TS types  |
| Minimal project persistence API              | ✅     | CRUD, revisions, optimistic concurrency            |
| Installation instructions                    | ✅     | README.md                                          |
| CI                                           | 🟡     | GitHub Actions workflow written, not yet run on GitHub |

## Phase 1: Functional DAW foundation 🟡 (vertical slice done; a few items open)

| Feature                         | Status | Notes                                                        |
| ------------------------------- | ------ | ------------------------------------------------------------ |
| Main application shell          | ✅     | Top bar, collapsible project browser, timeline, bottom editor |
| Dark professional interface     | ✅     |                                                              |
| Top transport controls          | ✅     | Play/pause, stop, position, BPM, loop length, loop, metronome |
| Basic timeline                  | ✅     | Bar ruler, click to seek, clip blocks with note miniatures, playhead |
| Basic track list                | ✅     | Track headers in the timeline                                |
| Add/remove tracks               | ✅     | Six drum and four synth presets. Delete asks for confirmation |
| BPM controls                    | ✅     | Changes playback timing (verified on rendered audio)         |
| Play/pause/stop                 | ✅     | Space toggles play/pause                                     |
| Working browser audio engine    | ✅     | Tone.js behind an `AudioEngine` interface                    |
| Basic synthesizer               | ✅     | 808 bass, lead, pad, pluck (synthesized)                     |
| Basic drum sounds               | ✅     | Kick, snare, clap, hi-hat, open hat, perc (synthesized)      |
| Simple step sequencer           | ✅     | Channel rack with 1/2/4-bar patterns                         |
| Basic MIDI note playback        | ✅     | Basic piano roll: click to add, click to delete, note length, scale shading |
| Volume/mute/solo                | ✅     | Verified: muting all tracks renders silence                  |
| Save/load projects              | ✅     | Verified across a browser reload                             |
| Demo project (drums, bass, melody) | ✅  | "Demo beat" template, built and validated by the backend     |
| WAV export of the loop          | ✅     | Offline render through the live audio graph. Pulled forward from Phase 10 to make audio testable |
| Pan control in the UI           | ⬜     | Stored and applied by the engine, no UI control yet          |
| Velocity editing                | ⬜     | Notes store velocity. Editing is Phase 5                     |
| Note drag/resize in piano roll  | ⬜     | Phase 5                                                      |
| Rename / recolor / reorder tracks | ⬜   | Phase 5                                                      |

Key requirement, all verified in a real browser: Play produces sound, changing notes changes
playback, changing BPM changes timing, muting silences a track.

Done when a user can create a simple beat manually, play it, modify it, save it and reopen it.
**That flow works and has an automated browser test.** Phase 1 stays 🟡 until the owner signs
off on the slice, or asks for the remaining items above.

## Phase 2: AI text-to-beat composition ✅ (owner sign-off pending)

| Feature                     | Status | Notes |
| --------------------------- | ------ | ----- |
| Prompt input                | ✅     | AI Beat Generator panel, up to 1000 characters |
| Mood / genre / BPM / key    | ✅     | Read from the prompt, or set explicitly. Six genres, six moods |
| Other settings              | ✅     | Length, duration, energy, drum/bass/melody intensity, instruments, seed |
| Automatic settings          | ✅     | Every setting defaults to Auto. The plan shows where each value came from |
| Structured generation       | ✅     | Tracks, patterns, clips and sections. No flattened audio |
| Drum patterns               | ✅     | Genre grooves, fills, swing, trap hat rolls |
| Basslines                   | ✅     | Follow chord roots. Trap/drill 808s lock to the kick |
| Melodies                    | ✅     | Motif-based, in key, chord tones on strong beats |
| Chords                      | ✅     | Mood progressions, voice-led pads/keys, sevenths for chill styles |
| Instrument selection        | ✅     | Auto per genre, prompt words, or an explicit list. New Keys instrument |
| Basic arrangement           | ✅     | Loop / short / full: intro, hook, verse, bridge, outro with variation |
| Prompt interpretation       | ✅     | Keyword rules (default, offline). Optional Claude interpreter |
| Claude interpreter verified live | ⬜ | Tested with a fake client only. No API key on the dev machine |
| Section-aware editing       | ✅     | Click a clip or section; editors edit that section's pattern |
| MIDI export                 | ✅     | All tracks or the selected track. Drums on channel 10, section markers |
| WAV export of the whole song | ✅    | Offline render. About a minute for a 32-bar song in the test browser |
| 808 slides / pitch glides   | ⬜     | Engine has no glide yet; prompts asking for it get a note |
| Time signatures other than 4/4 | ⬜  | Generation is 4/4 only |
| Reference audio             | ⬜     | Spec setting; needs audio analysis (later phase) |
| Neural composition / audio  | ⬜     | Phase 9. The composer is procedural and labeled as such |

Done when a description creates a project with multiple working tracks that can be edited and
exported in compatible formats. **Verified by the browser test with the spec's example
prompt.**

## Phase 3: Humming-to-MIDI ✅ (owner sign-off pending)

| Feature                         | Status | Notes |
| ------------------------------- | ------ | ----- |
| Microphone recording            | ✅     | Permission handling, input selection, level meter, 60 s limit |
| Playback and retakes            | ✅     | The take plays in the panel. Retake discards it |
| Waveform                        | ✅     | Shown for each take |
| Original recording preserved    | ✅     | Stored immutably by content hash and referenced in the project |
| Pitch extraction                | ✅     | pYIN (librosa), C2-C6, with tuning-offset correction |
| Note segmentation               | ✅     | Pitch changes, voicing gaps, and articulation dips |
| Duration estimation             | ✅     |  |
| Approximate tempo estimation    | ✅     | Half/double-time ambiguity shown with ÷2 and ×2 buttons |
| Octave correction               | ✅     | Frame-level and isolated-note octave errors repaired; manual octave shift |
| Confidence display              | ✅     | Per note in the review and in the piano roll until the note is edited |
| Quantization                    | ✅     | Grid and strength in the review; Quantize button in the piano roll |
| MIDI preview                    | ✅     | Plays the reviewed notes on the chosen instrument |
| Piano-roll correction tools     | ✅     | Select, move, transpose, lengthen, delete, quantize (keyboard and buttons) |
| MIDI export                     | ✅     | "Download MIDI" in the review, and the project export |
| Instrument selection            | ✅     | Lead, pluck or keys |
| Supporting beat around melody   | ✅     | Key and chords follow the melody. Keep exactly or vary in the verse |
| Key detection                   | ✅     | Krumhansl-Schmuckler on the transcribed notes |
| Polyphonic transcription        | ⬜     | Out of scope (spec: start monophonic) |
| Learned transcription model     | ⬜     | Basic Pitch or CREPE could replace pYIN later; same output format |

Done when a user records a recognizable melody, inspects and corrects the transcription, and
hears it played by an instrument, and the melody can become the foundation of an AI-generated
beat. **Verified in the browser through a fake microphone playing a synthetic hum.** A real
voice hasn't been tested yet.

## Phase 4: Beatbox-to-drums ✅ (owner sign-off pending)

| Feature                         | Status | Notes |
| ------------------------------- | ------ | ----- |
| Beatbox recording               | ✅     | Same recorder as humming; take stored immutably |
| Transient detection             | ✅     | dB spectral-flux onsets, refined to the attack, gated against the room noise |
| Tempo estimation                | ✅     | Shared estimator; ÷2/×2 for half or double time |
| Kick/snare/hat classification   | ✅     | Also open hat and perc. Rule scores on band energy, centroid, flatness, decay, plus cluster voting |
| Drum MIDI generation            | ✅     | One drum track per sound (GM notes), or Download MIDI |
| Step sequencer                  | ✅     | Results open in the channel rack |
| Manual classification correction | ✅   | Click a hit marker to cycle kick → snare → clap → hat → open hat → perc → ignore |
| Pattern quantization            | ✅     | Grid and strength in the review |
| Drum sound replacement          | ✅     | Choose the kit sound each detected class plays (e.g. open hat plays a clap) |
| AI rhythmic expansion           | ✅     | Procedural: keep exactly, or expand (hats, open-hat accents, perc, pickups, fills, thinner verse) |
| Learned drum classifier         | ⬜     | Could replace the rules later; same output format |

Done when a user beatboxes a simple pattern and obtains a useful, editable drum sequence.
**Verified in the browser through a fake microphone playing a synthetic beatbox take.** A real
beatboxer hasn't been tested yet.

## Phase 5: Advanced DAW editing ⬜

Improved arrangement timeline · drag/drop clips · clip resizing · clip duplication · fuller
piano roll · note velocity · undo/redo · song sections · track grouping · basic automation ·
keyboard shortcuts · better waveform display · more instruments · improved project saving.
Also from the spec: grid snapping, zoom, scrolling, loop regions, section markers,
copy/paste, swing, pattern duplication, track color, rename, duplicate, reorder, routing.
Done when users can create and edit multi-section arrangements.

## Phase 6: Vocal recording studio ⬜

Import instrumentals · microphone selection · input metering · recording controls · lead
vocals · multiple takes · background vocals · ad-libs · waveforms · recording sync · clip
trimming · take playback. Later: punch-in, comping, latency calibration, monitoring effects.
Originals are preserved for non-destructive editing.
Done when a user records vocals over a beat, listens back, creates multiple vocal tracks and
saves without losing recordings.

## Phase 7: AI vocal mixer ⬜

Vocal analysis · instrumental analysis · noise reduction · EQ · de-essing · compression ·
pitch correction once a suitable implementation exists · reverb · delay · saturation · vocal
balancing · effects chains · presets (Melodic/Spacey, Aggressive Trap, Clean Studio,
Dreamy/Ambient, Robotic/Futuristic, Intimate/Emotional, custom) · editable parameters ·
level-matched A/B · processed vocal export.
AI chooses DSP parameters. A real DSP engine processes the audio.
Done when a user records or imports vocals, picks a preset, presses Auto-Mix and hears real
processed audio, can change effects, and originals stay untouched.

## Phase 8: Conversational AI editing ⬜

Project-aware assistant · typed edit commands (AddTrack, RemoveTrack, AddNotes, ModifyNotes,
ReplacePattern, ChangeInstrument, ChangeTrackVolume, AddEffect, ModifyEffect,
ChangeArrangement, DuplicateSection, RegenerateSelectedRegion) · track targeting · region
targeting · selective regeneration · effect changes · arrangement changes · preview · change
summaries · undo/redo · confirmation for destructive changes · vocal-effect editing by chat ·
project Q&A.
Done when "Keep the melody, change the drums, and make the 808 stronger" changes only those
elements, and vocal-effect requests work.

## Phase 9: Advanced music generation and production ⬜

Better composition models · higher-quality instrument rendering · neural text-to-audio where
suitable · melody variations · transitions · intelligent arrangement · style control ·
selective section generation · harmonic analysis · optional audio-to-MIDI · optional source
separation · AI mastering assistant.
Done when generated music measurably improves while staying editable.

## Phase 10: Import/export and FL Studio workflows ⬜

WAV, MP3 and MIDI import · multitrack stem import · synchronized import · sample-rate
conversion · WAV, MP3 and FLAC export · MIDI export · stem export · processed vocal export ·
portable project package · FL Studio stem workflow (Level 1) · MIDI compatibility (Level 2).
No promise of `.flp` editing.
Done when a user exports stems from FL Studio, imports them, records or mixes vocals, and
returns processed audio to FL Studio.

## Phase 11: Desktop application ⬜

Tauri packaging · Windows · macOS · native file access · local service packaging (Python
sidecar research) · audio device access · native audio engine investigation · low-latency
recording · audio interfaces · offline functionality · installers · settings.
Done when VibeStudio installs and runs without dev servers or developer dependencies.

## Phase 12: Advanced desktop DAW features ⬜

Advanced routing · aux buses · sends · sidechain · advanced automation · improved mastering ·
MIDI controllers · better instruments · low-latency effects · comping · hardware integration ·
large-session performance · native VST hosting where feasible.

## Phase 13: VibeStudio VST3 plugin for FL Studio ⬜

VST3 plugin · FL Studio compatibility · native DSP · vocal analysis · AI-assisted effect
setup · presets · instrumental reference routing · editable controls · local or remote
inference · real-time safety. No network, disk or model initialization on the audio thread.

## Phase 14: Optional product expansion ⬜

User accounts · cloud backup · multi-device access · community presets · collaboration ·
cloud GPU generation · model selection · more genres · arrangement templates · AI harmonies ·
AI doubling · personalized mix preferences · advanced mastering · mobile companion ·
commercial distribution. Secondary to a working production app.

---

## Ideas from the owner (tracked, not yet scheduled)

- **Record ideas directly on a track** (proposed 2026-10-12). Arm any track, hum or beatbox
  into it, choose what the take becomes (drums, bass, melody, chords), and describe the vibe
  in words, for the arrangement and later for the mix. The pieces are being built in order:
  hum-to-melody (Phase 3), beatbox-to-drums (Phase 4), track arming and in-sync recording
  (Phase 6), per-track effects and AI mixing (Phase 7), and describing changes in words
  (Phase 8). Plan to join them into one flow in Phase 6, once track recording exists.

---

## Cross-cutting requirements (every phase)

Real functionality, no fake controls · modularity · editability · non-destructive editing ·
honesty about AI capabilities · tests per phase (frontend, backend, audio, end-to-end) ·
performance (stable playback, no inference on audio threads) · privacy and licensing (upload
validation, size limits, safe paths, no training on user audio without consent, licensed
samples and models) · documentation kept current.
