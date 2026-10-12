# Testing

Run before committing:

```bash
npm run check      # lint + typecheck + backend and frontend tests + production build
npm run test:e2e   # real-browser tests with audio and MIDI checks (~1.5 min)
```

## Backend (pytest)

```bash
npm run test:backend
```

Each API test gets a fresh in-memory SQLite database (`tests/conftest.py`).

| File                         | Covers |
| ---------------------------- | ------ |
| `tests/test_schema.py`       | Document validation: defaults, camelCase, dangling references, duplicate ids, value ranges, unsafe asset URIs, schema-version migration, shared schema file up to date |
| `tests/test_generation.py`   | Keyword interpreter vocabulary (the spec's example prompt, keys, sharps/flats, durations, exclusions, approximations); precedence and sources; duration to bars; composer musical properties across 6 genres × 3 moods (in key, sections tile, intro/hook variation, shared hook patterns, 808 locked to kick, house four-on-the-floor, trap snare on 3, hat rolls); seed determinism; instrument selection; size bounds |
| `tests/test_llm.py`          | Claude interpreter with a fake client: request shape (structured-output schema, `fallbacks`, effort), refusal / max_tokens / empty / invalid JSON / out-of-range / network errors all raise, key and timeout passed to the SDK, resolver uses the LLM when configured and falls back with a warning |
| `tests/test_midi_and_generate_api.py` | MIDI matches playback events exactly (count and tick timing), drums on channel 10, tempo, section markers, single-track export; `/api/generate` creates a normal editable project; `/api/generate/plan` creates nothing; validation; `/api/export/midi` headers and errors |
| `tests/test_transcription.py` | Synthetic hums (`tests/hum_synth.py`) with known notes: exact transcription, onset timing, confidence, tuning offset, key, tempo; robustness across tempo, articulation, noise and detune; octave-glitch repair; silence and noise; resampling; tempo/key helpers |
| `tests/test_assets_and_hum_api.py` | Upload stores an immutable content-addressed file (and sanitises names); dedup; serving; bad, empty, too-long and too-large uploads; transcription endpoint; beat built around a melody (key from melody, notes kept exactly with confidence, recording kept, chords fit the melody); vary mode and keys instrument; long melodies fit whole sections |
| `tests/test_beatbox.py`      | Synthetic beatboxing (`tests/beatbox_synth.py`): exact transcription and timing of a boom-bap groove; robustness across 75-140 BPM and −50 to −35 dB noise; a very noisy room; silence; the API endpoint; generation keep mode (groove played exactly) and expand mode (groove kept, parts and fills added, whole repeats); endpoint with source asset and validation |
| `tests/test_projects_api.py` | CRUD, revisions, 409 conflicts, invalid documents not persisted, id mismatch, 404s, oversized bodies, templates (starter tracks, empty, demo is playable and in key, time signature respected, unknown template rejected) |

## Frontend unit and component tests (Vitest)

```bash
npm run test:frontend
# watch mode, from frontend/:
npm run test:watch
```

jsdom has no Web Audio, so these tests cover logic and UI wiring. Real audio is covered by
the end-to-end test below.

| File                             | Covers |
| -------------------------------- | ------ |
| `src/project/edit.test.ts`       | Music helpers (bars, positions, note names, scales). Add/remove track without dangling references, step toggling at GM pitches, note add/remove with clamping, mixer clamping, non-destructive pattern resize, loop resize |
| `src/audio/schedule.test.ts`     | Event timing, pattern repetition across clips, ignoring notes past the pattern end, cutting at the clip end, edits changing the schedule, mute and solo rules |
| `src/audio/wav.test.ts`          | WAV header, channel interleaving, clipping, peak level |
| `src/store/projectStore.test.ts` | Create/open, dirty tracking, save, conflicts keep local edits, loading old revisions, unreachable backend, delete |
| `src/project/edit.test.ts` (multi-section) | `clipAt`, editing only the focused section's pattern, adding a pattern to a silent section, shared-pattern counts, `sectionAt` |
| `src/components/generator/GeneratePanel.test.tsx` | Preview sends only non-Auto settings and creates nothing; plan card shows sources, notes and interpreter; Generate opens the project; sections in the ruler; section-focused step editing; "+ Add pattern here"; error display |
| `src/project/quantize.test.ts`   | Seconds to beats, grid snapping and strength, confidence filter, exclusions, transposition, monophony (overlaps and collisions), note editing (move, transpose, quantize, remove, confidence cleared), melody tracks keep confidence and the source asset |
| `src/components/hum/HumPanel.test.tsx` | With a mocked microphone: record, upload, transcribe and review; exclude and restore a note; octave and instrument; preview; create a project (key from melody); piano-roll select, ↑ and Delete; build a beat (request body); microphone errors |
| `src/store/projectStore.test.ts` (dirty) | Unsaved-changes detection ignores key order |
| `src/project/drums.test.ts`      | Hits to beats (snap, merge duplicates), corrections and sound mapping, grid off, class cycling, pattern length, drum tracks with GM pitches and the source asset |
| `src/components/beatbox/BeatboxPanel.test.tsx` | With a mocked microphone: record, upload, detect; click-to-correct; remap a class; grid preview; preview plays two passes; create a project (one track per sound, in the channel rack); build a beat (request body) |
| `src/App.test.tsx`               | With a mocked engine: program kick steps, Play syncs the document, mute while playing reaches the engine, stop, save persists notes and mute. Tempo clear and retype. Add and delete tracks |

## End-to-end (Playwright, real browser)

```bash
npm run test:e2e
# use Chrome instead of Edge:
PW_CHANNEL=chrome npm run test:e2e
```

This starts its own backend on port 8001, with a throwaway SQLite file in the system temp
folder, and a Vite server on port 5174. Your dev servers and data are not touched. It uses
an installed Edge (default) or Chrome. Nothing is downloaded.

`e2e/generate.spec.ts` (Phase 2) generates the spec's example prompt with a fixed seed against
the real backend. It checks the preview, the generated tracks and sections, playback, a
hook-section edit, the piano roll, the MIDI export (format, tempo, markers, per-track note
counts, drum channel), and the whole-song WAV (length for the tempo, non-silent, unclipped).
Then it saves.

`e2e/hum.spec.ts` (Phase 3) records from a fake microphone that plays
`e2e/fixtures/hum-twinkle.wav`. It checks that the 14 detected notes have the right pitch
names, the key is C major and the tempo is 100 (or half or double). Then it previews,
creates a project, corrects a note with the keyboard, saves, builds a beat around the
melody, plays it, and checks the MIDI export repeats the melody. Regenerate the fixture
with `backend/.venv/Scripts/python backend/scripts/make_hum_fixture.py`.

`e2e/beatbox.spec.ts` (Phase 4) runs in the `beatbox` Playwright project, whose fake
microphone plays `e2e/fixtures/beatbox-boombap.wav`. It checks all 32 hits are classified
correctly and the tempo is 90 (or half or double). It then corrects a hit, remaps open hats
to claps, previews, creates five drum tracks, edits a step in the channel rack, plays,
saves, expands the groove into a beat, and checks the MIDI kick is on channel 10.

`e2e/milestone.spec.ts` (Phase 1) checks the following in one flow:

1. The backend is connected. A demo-beat project is created.
2. Play starts the AudioContext ("Audio running") and the playhead moves. Stop resets it.
3. Export WAV gives stereo 44.1 kHz audio of the right length for the tempo, non-silent and
   below clipping.
4. Muting every track renders digital silence.
5. With only the kick unmuted at 70 BPM, the render is still audible, longer, and quieter.
6. Adding a kick step marks the project unsaved. Saving clears that.
7. After a browser reload, the reopened project keeps its tempo, steps and mute states.
8. In the piano roll, clicking the grid adds a note and clicking the note removes it.
9. The reopened project plays again, with no console errors during the run.

Screenshots are saved to `frontend/test-results/` (gitignored).

## Database migrations

```bash
cd backend
.venv/Scripts/python -m alembic upgrade head   # macOS/Linux: .venv/bin/python
.venv/Scripts/python -m alembic check
```

## Manual check: the first milestone

1. Run `npm run dev` and open http://localhost:5173.
2. Type a name, choose **Demo beat**, and press **Create**.
3. Press **Play** or Space. You should hear drums, an 808 and a lead.
4. While it plays, click steps in the channel rack. Mute and solo tracks, move volume
   sliders, change BPM. Each change is audible right away.
5. Open the **Piano roll** tab, pick a synth track, and click the grid to add notes.
6. Press **Save** or Ctrl+S, reload the page, reopen the project and press Play.
7. Open **Export** and choose Audio (WAV) or MIDI. Play or import the file.

## Manual check: text to beat

1. Open the **AI Beat Generator** tab and describe a beat, for example "dark trap at 145 BPM with heavy 808s and a dreamy lead".
2. Press **Preview** to see how it was read and where each value came from.
3. Press **Generate beat**, then Play. Click sections in the ruler, or clips, to edit those parts.
4. Export MIDI and import it into FL Studio. Each instrument arrives on its own track.

## Manual check: humming

1. Open **Hum Melody** and press **Record**. Allow the microphone, hum a short tune
   ("da da da" works best), then press **Stop**.
2. Check the detected notes. Amber dashed notes are uncertain. Click a note to leave it out.
   Adjust tempo (÷2 or ×2), grid, octave and instrument, then press **Preview**.
3. **Create a project with this melody**, then fix notes in the piano roll: click to
   select, arrows to move, Delete to remove, Quantize to tidy.
4. Back in **Hum Melody**, describe a style and press **Build a beat around it**.

## Manual check: beatboxing

1. Open **Beatbox**, press **Record**, beatbox a simple groove ("b" kick, "k" or "psh"
   snare, "t" or "ts" hats), then press **Stop**.
2. Check the markers on the waveform. Click any marker to change its class. Use **Sounds**
   to swap kit sounds, and **Preview** to hear it.
3. **Create a project with this groove** to edit it in the channel rack, or describe a style
   and press **Build a beat around it**.

## Adding audio tests later

Prefer rendering over UI assertions. Use `renderLoopWav` in the browser and check sample data
in Node with `e2e/wav.ts`. Future checks from the spec include effect bypass, stem alignment
and sample-rate handling.
