# VibeStudio

VibeStudio is an AI-first digital audio workstation. The goal is one editable production
environment where you can describe, hum, beatbox, generate, edit, record, mix and export
music. Generated music stays editable as tracks, patterns and notes rather than a single
flattened audio file.

**Current status: Phase 4 done.** VibeStudio is a working browser DAW where you can:

- **Describe a beat** and get an editable, multi-section project: drums, bass, chords and
  melody on separate tracks.
- **Hum a melody,** review and correct the detected notes, and build a beat around it.
- **Beatbox a groove,** fix any misheard hits, and turn it into drum tracks or a full beat.
- **Edit** any section in the channel rack and piano roll, play it, and export WAV or MIDI.

The music is written by a rule-based procedural composer. Prompts are read by keyword rules,
or optionally by Claude. Humming is transcribed with pYIN pitch tracking. See
[ROADMAP.md](ROADMAP.md) and [PROGRESS.md](PROGRESS.md).

## Requirements

| Tool    | Version                  |
| ------- | ------------------------ |
| Node.js | 20.19+ or 22.12+ (tested on 24) |
| npm     | 10+                      |
| Python  | 3.11+                    |
| Docker  | Optional, only for the PostgreSQL stack |
| Edge or Chrome | For the end-to-end test (`npm run test:e2e`) |

## Quick start

```bash
npm run setup   # installs everything, creates .env and the local database
npm run dev     # starts the API on :8000 and the web app on :5173
```

Open http://localhost:5173. The status bar at the bottom shows whether the backend is
connected. Press Ctrl+C in the terminal to stop both servers.

### Generate a beat

1. Open the **AI Beat Generator** tab, describe a beat, and press **Generate beat**.
2. Press **Play**. Click a section in the ruler, or a clip, to edit that part in the channel
   rack or piano roll.
3. Use **Export** for WAV audio or MIDI for FL Studio.

To let Claude read prompts instead of the keyword rules, set these in `.env` and restart the
backend. Calls are billed to your Anthropic account.

```bash
VIBESTUDIO_LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

### Hum a melody

1. Open **Hum Melody**, press **Record**, hum, then press **Stop**.
2. Review the detected notes. Uncertain ones are amber. Adjust tempo, grid and octave, then **Preview**.
3. **Create a project with this melody** to edit it in the piano roll, or describe a style
   and press **Build a beat around it**.

The first transcription after starting the backend takes a few extra seconds while the
pitch tracker compiles.

### Beatbox a groove

1. Open **Beatbox**, press **Record**, beatbox, then press **Stop**.
2. Click any hit marker to change its sound, and set which kit sound each class plays.
3. **Create a project with this groove**, or describe a style and **Build a beat around it**.

### Program a beat by hand

1. In the left panel, type a name, choose **Demo beat**, and press **Create**.
2. Press **Play** or Space. You'll hear drums, an 808 and a lead looping.
3. Click steps in the **Channel rack**. Use **M** to mute, **S** to solo, and the sliders for
   volume. Change **BPM**. All changes are heard immediately.
4. Open **Piano roll**, pick a synth track, and click the grid to add notes. Click a note to
   delete it.
5. **Save** (Ctrl+S), reload the page, reopen the project, and play it again.
6. **Export WAV** renders the loop to a file.

Choose **Starter kit** to start from empty patterns, or use **+ Add track** for more drums or
synths.

`npm run setup` is safe to re-run. It creates `backend/.venv`, installs Python and Node
dependencies, copies `.env.example` to `.env` if missing, and applies database migrations.

## Common commands

All commands run from the repository root.

| Command                | What it does                                                 |
| ---------------------- | ------------------------------------------------------------ |
| `npm run dev`          | Backend (with auto-reload) and frontend together             |
| `npm run dev:backend`  | Backend only, at http://127.0.0.1:8000 (API docs at `/docs`) |
| `npm run dev:frontend` | Frontend only                                                |
| `npm test`             | Backend (pytest) and frontend (Vitest) tests                 |
| `npm run test:e2e`     | Real-browser test with audio checks (uses installed Edge)    |
| `npm run lint`         | Ruff, oxlint and Prettier checks                             |
| `npm run format`       | Auto-format Python and TypeScript                            |
| `npm run typecheck`    | TypeScript strict type check                                 |
| `npm run check`        | Lint, typecheck, tests and production build: run before committing |
| `npm run migrate`      | Apply database migrations                                    |
| `npm run gen:schema`   | Regenerate the shared project schema and frontend types      |

## Repository layout

```
backend/            FastAPI app (Python)
  app/api/          HTTP routes
  app/schemas/      Pydantic models, including the versioned project document
  app/services/     Business logic (persistence, migrations, templates, MIDI export)
  app/generation/   Text-to-beat: prompt interpreters, plan resolver, procedural composer
  app/transcription/ Humming to notes: pYIN pitch tracking, segmentation, tempo and key
  app/db/           SQLAlchemy models and session
  alembic/          Database migrations
  scripts/          Developer scripts (schema export)
  tests/            pytest suite
frontend/           React + TypeScript + Vite app
  src/api/          Typed API client
  src/audio/        Audio engine: Tone.js graph, instruments, scheduling, WAV export
  src/project/      Pure project editing operations and music helpers
  src/store/        Zustand state (project, transport, UI)
  src/hooks/        Engine sync and keyboard shortcuts
  e2e/              Playwright browser tests
  src/components/   UI components (generator/ holds the AI Beat Generator)
  src/types/        API types and the generated project document types
shared/             JSON Schemas shared by backend and frontend (project, generation)
scripts/            Cross-platform setup and dev helpers
```

## Database

Local development uses SQLite at `backend/data/vibestudio.db`, so Docker is not required.
To use PostgreSQL instead, set `VIBESTUDIO_DATABASE_URL` in `.env`:

```bash
VIBESTUDIO_DATABASE_URL=postgresql+psycopg://vibestudio:vibestudio@localhost:5432/vibestudio
```

## Docker (optional)

```bash
docker compose up --build
```

This starts PostgreSQL, the backend and the frontend dev server on the same ports. The Compose
file has not yet been run in this environment because Docker was not installed. Treat it as
unverified until someone runs it.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): subsystems, data model, interfaces
- [ROADMAP.md](ROADMAP.md): every phase and feature, with status
- [PROGRESS.md](PROGRESS.md): what is done, known issues, next steps
- [DECISIONS.md](DECISIONS.md): architectural decisions and their reasons
- [TESTING.md](TESTING.md): how to run and extend the tests
