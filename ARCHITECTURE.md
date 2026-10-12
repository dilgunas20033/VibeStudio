# Architecture

This document describes what exists today and the boundaries later phases build on.
Sections marked **planned** describe intended design, not implemented code.

## System overview

```
 Browser (React + TypeScript)                       Python backend (FastAPI)
 ┌──────────────────────────────┐   HTTP /api/*    ┌──────────────────────────────┐
 │ components/  UI              │ ───────────────▶ │ api/       routes, HTTP errors │
 │ store/       Zustand state   │   (Vite proxy    │ services/  business logic      │
 │ api/         typed client    │    in dev)       │ schemas/   Pydantic contracts  │
 │ audio/       Tone.js engine  │                  │ db/        SQLAlchemy models   │
 └──────────────────────────────┘                  └──────────────┬───────────────┘
                ▲                                                 │
                │ npm run gen:types                               ▼
        shared/project.schema.json  ◀── scripts/export_schema.py  SQLite / PostgreSQL
```

The backend is a modular monolith. A separate processing worker with a job queue is
**planned** for the first long-running workloads (audio analysis, rendering, AI generation).

## Subsystem boundaries

| Subsystem                  | Location                     | Status                   |
| -------------------------- | ---------------------------- | ------------------------ |
| Frontend UI                | `frontend/src/components`    | Phase 0 shell            |
| Application state          | `frontend/src/store`         | Project state            |
| API client                 | `frontend/src/api`           | Implemented              |
| Audio playback engine      | `frontend/src/audio`         | Implemented (Phase 1)    |
| Project editing operations | `frontend/src/project`       | Implemented (Phase 1)    |
| Project templates          | `backend/app/services/templates.py` | Implemented (Phase 1) |
| Sequencing / MIDI engine   | frontend + backend           | Basic playback; MIDI I/O planned |
| Beat generation            | `backend/app/generation`     | Implemented (Phase 2)    |
| MIDI export                | `backend/app/services/midi.py` | Implemented (Phase 2)  |
| Audio assets (uploads)     | `backend/app/services/assets.py` | Implemented (Phase 3) |
| Melody transcription       | `backend/app/transcription`  | Implemented (Phase 3)    |
| Beatbox transcription      | `backend/app/transcription/beatbox.py` | Implemented (Phase 4) |
| Recorder (browser)         | `frontend/src/audio/recorder.ts` | Implemented (Phase 3) |
| Conversational AI editing  | backend                      | Planned, Phase 8         |
| Vocal analysis / DSP       | `backend/app/dsp` + worker   | Planned, Phases 3, 4, 7  |
| Backend API                | `backend/app/api`            | Implemented              |
| Persistence                | `backend/app/services`, `db` | Implemented              |
| Import / export            | backend                      | Planned, Phases 1, 2, 10 |
| Desktop / plugin           | separate packages            | Planned, Phases 11 to 13 |

Rules that keep these separate:

- UI components never call `fetch` directly. They go through the store, which uses `api/client.ts`.
- Route handlers translate HTTP to and from service calls. Business rules live in `services/`.
- The project document is plain data. Audio engines, AI and DSP read it and produce new
  documents or edit commands. They never hold the canonical copy.

## Project document (schema v1)

Defined in `backend/app/schemas/project.py`. It is the single source of truth for a song.

```
ProjectDocument
├── schemaVersion: 1
├── id, name, bpm, key {root, mode}, timeSignature {numerator, denominator}
├── tracks[]     id, name, kind (instrument|drums|audio), role, color,
│                instrument {type, preset, params}, mixer {volumeDb, pan, mute, solo},
│                effects[] {id, type, enabled, params}
├── patterns[]   id, name, lengthBeats, notes[] {id, pitch, startBeat, durationBeats, velocity}
├── clips[]      id, trackId, patternId | assetId, startBeat, lengthBeats, offsetBeats
├── sections[]   id, name, startBeat, lengthBeats
├── assets[]     id, name, uri (asset://…), sha256, sampleRate, channels, durationSeconds
└── aiHistory[]  id, createdAt, prompt, summary
```

Design properties:

- **Stable ids on every entity.** AI edit commands (Phase 8) target tracks, notes and
  sections by id rather than by position.
- **Time in beats.** Changing tempo never rewrites note data.
- **Patterns separate from clips.** A pattern is reusable content. A clip places it on the
  timeline, the way FL Studio separates patterns from the playlist.
- **Validated integrity.** Duplicate ids and dangling references, such as a clip pointing to a
  deleted track, are rejected on every save.
- **Safe asset references.** Asset URIs must be `asset://` paths without `..`. A document
  can never point at an arbitrary file on the host.
- **Engine-specific params are open maps.** `instrument.params` and `effect.params` hold
  scalar values only. Each engine validates its own params.
- **camelCase on the wire,** snake_case in Python.

### Versioning and migration

- `schemaVersion` is stored in every document. The backend refuses versions newer than it
  supports.
- `app/services/migrations.py` upgrades older documents step by step when they are loaded.
- Database table changes use Alembic migrations in `backend/alembic/versions`.

### Shared contract

`npm run gen:schema` exports the Pydantic model to `shared/project.schema.json` and generates
`frontend/src/types/project.generated.ts`. A backend test fails if the exported file drifts
from the model. CI fails if the generated TypeScript drifts from the schema. API envelope
types in `frontend/src/types/api.ts` are hand-written and mirror `backend/app/schemas/api.py`.

## Persistence

Tables: `projects` holds the current document and revision number. `project_revisions` keeps
a snapshot per save, pruned to the newest `VIBESTUDIO_MAX_REVISIONS_PER_PROJECT`.

Saving uses optimistic concurrency. The client sends `baseRevision`. If another save happened
first, the server answers `409 Conflict` with `currentRevision`, and the client keeps its local
edits and offers to reload.

Loading an old revision puts it in the editor as unsaved changes. Nothing is overwritten
until the user saves, which creates a new revision. History is never rewritten.

## HTTP API

| Method | Path                                    | Purpose                              |
| ------ | --------------------------------------- | ------------------------------------ |
| GET    | `/api/health`                           | Backend and database status          |
| GET    | `/api/schema/project`                   | JSON Schema of the project document  |
| GET    | `/api/projects`                         | Project summaries, newest first      |
| POST   | `/api/projects`                         | Create a project from a template (`empty`, `starter`, `demo`) |
| GET    | `/api/projects/{id}`                    | Current document and revision        |
| PUT    | `/api/projects/{id}`                    | Save a new revision                  |
| DELETE | `/api/projects/{id}`                    | Delete a project and its revisions   |
| GET    | `/api/projects/{id}/revisions`          | Revision list                        |
| GET    | `/api/projects/{id}/revisions/{n}`      | One revision's document              |
| POST   | `/api/generate/plan`                    | Read a generation request into a plan (creates nothing) |
| POST   | `/api/generate`                         | Generate a new project from a description and settings |
| POST   | `/api/export/midi`                      | Standard MIDI File of a posted document (optionally some tracks) |
| POST   | `/api/assets?name=&kind=`               | Upload audio as the raw body; validated and stored immutably |
| GET    | `/api/assets/{id}` and `/{id}/audio`    | Asset metadata and the original file |
| POST   | `/api/transcribe/melody`                | Transcribe a stored recording into notes (monophonic) |
| POST   | `/api/transcribe/beatbox`               | Transcribe a stored beatbox recording into classified drum hits |

Interactive docs are served at http://127.0.0.1:8000/docs while the backend runs.

## Audio engine (Phase 1)

```
 projectStore (document) ──useEngineSync──▶ AudioEngine.sync(doc)
                                                 │
 transportStore (play/stop/seek, playhead) ──────┤
                                                 ▼
 audio/index.ts  lazy-loads ─▶ toneEngine.ts (live)      render.ts (offline WAV)
                                      │                        │
                                      └──── graph.ts: ProjectGraph ────┘
                                             │ per track: Voice → Channel(vol, pan, mute) → master
                                             │ master: Volume(-3 dB) → Limiter(-0.5 dB) → output
                                             ▼
                          schedule.ts (pure): collectEvents(doc), audibleTracks(tracks)
                          instruments.ts: synthesized drum and synth voices per preset
```

- **`AudioEngine` interface** (`audio/types.ts`). The UI depends only on this. A native
  desktop engine can implement it later.
- **Pure scheduling** (`audio/schedule.ts`). Turns clips and patterns into absolute note
  events in beats, and applies mute and solo rules. Fully unit-tested without Web Audio.
- **One graph for live and offline** (`audio/graph.ts`). The exported WAV goes through
  exactly the nodes you hear. `sync(doc)` is incremental. It rebuilds a track's voice only when
  its instrument changes, refreshes note events and mixer values, and disposes removed tracks.
- **Timing.** Tone.js Parts on the Transport, with positions in ticks (`PPQ` = 192).
  Durations convert from beats to seconds at trigger time.
- **Lazy loading.** Tone.js loads on the first Play, preview or export, which keeps it out of
  the initial bundle. Browsers also require a user gesture to start audio.
- **Playhead.** `transportStore` reads the engine position on each animation frame. Only
  small components subscribe to it, such as the playhead line and position display.
- **Resource cleanup.** Removed tracks dispose their Part, voice and channel. Closing or
  switching projects clears the graph. The metronome disposes when switched off.

### Phase 1 project model in use

Each track has one pattern and one clip from beat 0 spanning the loop. The loop length is the
end of the last clip. Drum tracks hold one-step notes at General MIDI pitches. Synth tracks
hold arbitrary notes. The schema already supports many clips per track and audio clips.
The editing UI for them comes in Phase 5.

### Editing operations

`frontend/src/project/edit.ts` holds pure, immutable edits: add/remove track, toggle step,
add/remove note, set mixer, and set pattern or loop length. UI components never build
document fragments themselves. The Phase 8 AI edit commands should map onto this layer, then
move server-side for validation.

## Beat generation (Phase 2)

```
GenerationRequest (prompt + optional settings)
   │
   ├─ interpret.py   keyword rules  ──┐   (default, offline, deterministic)
   ├─ llm.py         Claude (opt-in) ─┤── PromptHints  (same schema either way)
   │                                  ▼
   └─ resolve.py   user setting > prompt hint > genre/mood default ── GenerationPlan
                                                                         │ (+ sources, warnings, seed)
                                                                         ▼
                      composer.py (procedural-v1, seeded) ── ProjectDocument
                         progression → voiced chords (pad/keys)
                                     → bass on roots (808 locked to kick)
                                     → motif melody (lead) / arpeggio (pluck)
                         genre drum grooves (fills, swing, rolls)
                         sections → clips; one pattern per (instrument, section type)
```

- **Model adapters stay outside editing logic.** The LLM only ever returns `PromptHints`, a
  small validated settings object. It never writes notes or touches project data.
- **Honest labelling.** The plan records `interpreter` (`rules` or `llm`, plus the model) and
  `composer: "procedural-v1"`. The UI shows both. Unsupported or approximated requests
  become `warnings` (for example, strings become a pad).
- **Determinism.** Same plan and seed give the same song. Each component draws from its own
  seeded RNG (`seed:melody:lead:hook`), so changing one instrument's settings doesn't
  reshuffle the others.
- **LLM call.** It uses the Anthropic SDK with `client.beta.messages.create`, a JSON-schema
  structured output, `effort: low`, and server-side `fallbacks: "default"`. It has a 30 s
  timeout and one retry. Any failure, including a refusal, `max_tokens` or invalid values,
  falls back to the keyword rules with a visible warning.
- **Generation is synchronous** in the request handler. It takes under a second
  procedurally. Model-based composition (Phase 9) should move to the background job queue.

## Editing arranged songs

Generated songs have several clips per track, one per section. `uiStore.focusBeat` is the
position the editors work at. Clicking a clip or a section in the ruler sets it. The channel
rack and piano roll edit the pattern of the clip under `focusBeat` (`clipAt`). Patterns can be
shared by several clips, such as every hook, and the editors show the usage count. Tracks
with no clip in a section offer "+ Add pattern here" (`addSectionClip`).

## MIDI export

`services/midi.py` expands clips the same way as `schedule.ts` (`expand_events`). Tests
compare note counts and timing. The file has a conductor track with tempo, time signature
and section markers, then one track per project track. Drums use channel 10 with GM notes.
Synths get a GM program (bass 39, lead 82, pad 89, pluck 47, keys 5, in 1-based numbering).

## Humming to MIDI (Phase 3)

```
Browser                                   Backend
MediaRecorder (raw voice: no AGC/NS/EC)
  → decode + OfflineAudioContext → mono 22.05 kHz WAV
  → POST /api/assets (raw body) ───────────▶ probe with libsndfile, limits, sha256
                                             data/assets/ab/<sha>.wav (immutable) + assets row
  → POST /api/transcribe/melody ───────────▶ pYIN → gate → tuning → octave repair
                                             → segment → notes (sec, conf) + tempo + key + curve
review (all client-side, instant):
  detectedToBeats(notes, bpm, grid, strength, transpose, minConfidence, excluded)
  → Preview (engine.previewNotes) / Download MIDI
  → addMelodyTrack(doc, …)  or  POST /api/generate {melody, bpm, prompt}
                                             → key from melody → harmonize() → compose()
```

- **Seconds on the server, beats on the client.** The backend returns timing in seconds.
  The UI converts with the chosen tempo and grid, so tempo, grid and octave changes are
  instant and need no re-upload.
- **Confidence travels with the notes.** `MidiNote.confidence` is set for transcribed notes
  and cleared when the user edits a note, so the piano roll keeps marking unchecked
  detections.
- **Asset storage.** Content-addressed storage means identical uploads share one file. Every
  upload still gets its own asset id. Generated or edited projects reference recordings
  through `asset://audio/<id>` URIs, which the schema validator restricts.

## Beatbox to drums (Phase 4)

```
take (shared recorder slice) → asset → POST /api/transcribe/beatbox
   onset_strength(dB STFT) → peaks → refine to attack → noise-floor gate
   → features (low/mid/high energy, centroid, flatness, decay) → rule scores → cluster vote
   → hits [{time, drum, confidence, velocity}] + tempo
review (client): hitsToBeats(hits, bpm, grid, strength, overrides, mapping)
   → previewDrums / Download MIDI / addDrumTracks / POST /api/generate {drums, mode}
```

- **One recorder for every take.** `store/recorderSlice.ts` holds permission, timer, meter,
  the 60 s cap, decode, upload and retake. Hum and Beatbox each add their own analysis step
  and review state. `components/hum/TakeRecorder.tsx` renders any store built on the slice.
- **Corrections are client state.** Per-hit overrides and the class-to-sound mapping are
  applied in `project/drums.ts`. The server's transcription is never edited, so "retake" or
  reverting a correction is always exact.
- **Expansion stays in the composer.** `user_drum_notes` adapts the user's groove per
  section (keep or expand). Everything else (bass on the kick, harmony, arrangement) is
  shared with prompt-only generation.

## Configuration

Settings come from environment variables, documented in `.env.example`. Variables prefixed
`VIBESTUDIO_` are server-side only. Only `VITE_*` variables reach the browser bundle, so
secrets must never use that prefix.
