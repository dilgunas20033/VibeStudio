# Architectural decisions

Each entry records what was decided, why, and what would make us revisit it.

## D-001: Web first, packaged with Tauri later

**Decision.** Build the shared UI as a React + TypeScript web app. Package it with Tauri in
Phase 11.
**Why.** Fast iteration and testing now. Tauri can wrap the same frontend later.
**Caveat.** Tauri does not provide low-latency audio, device management or VST hosting. Those
need a native audio engine, likely Rust or JUCE/C++, behind the audio-engine interface.

## D-002: Modular monolith backend

**Decision.** One FastAPI app with internal modules for API, services, schemas and db. A
separate worker process is added when the first long-running job lands.
**Why.** The project is early. Microservices would add deployment cost with no benefit yet.

## D-003: SQLite by default, PostgreSQL supported

**Decision.** Default `DATABASE_URL` is a local SQLite file. PostgreSQL works by changing
one variable, and docker-compose provides it.
**Why.** Development works on a clean machine without Docker, which was not installed here.
Alembic migrations run in batch mode so they work on both databases.
**Revisit** when we need concurrent writers or Postgres-only features. Production deployments
should use PostgreSQL.

## D-004: Project stored as a validated document plus revision snapshots

**Decision.** Store each project as one JSON document that is fully validated by Pydantic on
every write. Keep a snapshot table for revisions. Do not normalize notes and clips into rows yet.
**Why.** The whole project is loaded and saved as a unit by the editor and the audio engine.
Cross-entity integrity (dangling references, duplicate ids) is checked in one validator. Full
snapshots make undo across sessions and AI-edit revert trivial.
**Trade-off.** Every save writes the full document, and revisions duplicate data.
**Revisit** when documents grow past roughly 1 MB, or when server-side queries over notes are
needed. Candidates: per-entity tables, or storing patches between revisions.

## D-005: Optimistic concurrency on save

**Decision.** Saves must include `baseRevision`. A stale save returns 409 instead of
overwriting.
**Why.** Two tabs, or a future AI job, must never silently clobber user work.

## D-006: One schema source, generated TypeScript types

**Decision.** Pydantic is the source of truth. It exports `shared/project.schema.json`, and
`json-schema-to-typescript` generates frontend types. Tests and CI catch drift.
**Why.** The project document is the most important contract in the system, and hand-synced
copies drift.

## D-007: Time in beats, patterns separate from clips

**Decision.** Notes and clips use beat positions. Patterns hold notes. Clips place patterns
or audio assets on tracks.
**Why.** Tempo changes don't rewrite data, patterns are reusable, and the model maps
directly to MIDI export and to FL Studio's pattern/playlist workflow.

## D-008: Tooling choices

- **Vite 8, React 19, TypeScript strict** with `noUncheckedIndexedAccess`.
- **Tailwind CSS v4** through the Vite plugin. Design tokens are in `src/index.css`.
- **Zustand** for state. It is small and works outside React, which the audio engine needs.
- **oxlint** for frontend linting, because it ships with the current Vite template and is fast.
  **Prettier** for formatting.
- **Ruff** for Python lint and format. **pytest** for backend tests, **Vitest** with Testing
  Library for frontend tests.
- **concurrently** at the root runs both dev servers with one command.
- **Tone.js 15.1.22** (the stable release) is pinned exactly. See D-010.
- **Playwright** drives the installed Edge or Chrome for end-to-end tests, with no browser download. See D-014.

## D-009: Only VITE_* variables reach the browser

**Decision.** Server settings use the `VIBESTUDIO_` prefix and are never exposed to the client.
**Why.** Exposing a broad prefix to Vite would leak future API keys into the JavaScript bundle.

## D-010: Tone.js behind an AudioEngine interface

**Decision.** Use Tone.js for Phase 1 synthesis and scheduling, wrapped by our own
`AudioEngine` interface and `ProjectGraph`. Keep scheduling math in pure functions.
**Why.** Tone.js gives a reliable transport, synths and offline rendering today. The
interface keeps it replaceable by a native engine (D-001). Pure scheduling keeps timing
logic testable.

## D-011: Synthesized instruments only, for now

**Decision.** Every built-in sound is synthesized: membrane, noise and metal synths for drums,
poly synths for bass, lead, pad and pluck.
**Why.** There are no sample licensing questions, nothing to download, and they work offline.
The spec says sampled instruments are not an MVP prerequisite.
**Revisit** when adding properly licensed sample kits.

## D-012: Master headroom and a safety limiter

**Decision.** The master bus runs at -3 dB into a limiter at -0.5 dB.
**Why.** Stacked tracks at 0 dB clip easily. The limiter is a safety net, not a loudness
tool, and the end-to-end test checks the demo peaks well below full scale.

## D-013: Templates built by the backend

**Decision.** Starter and demo projects are built and validated server-side in
`templates.py`.
**Why.** The template runs through the same validation as any save, has tests for musical
coherence (bass and lead stay in key), and becomes the base for Phase 2 generation, which
will also run server-side.
**Trade-off.** Preset names and drum pitches are listed in both `templates.py` and
`frontend/src/project/presets.ts`. Keep them in sync until presets move into the shared
schema.

## D-014: Verify audio by rendering it

**Decision.** Add WAV export of the loop in Phase 1, earlier than the Phase 10 export work.
The browser test renders through the real graph and checks sample data: non-silent, correct
length for the tempo, silent when muted, below clipping.
**Why.** "Play must actually play audio" can't be checked by UI tests alone. Rendering gives
an objective check, and users get a working export.

## D-015: UI owns transport state

**Decision.** `transportStore.status` is set by user actions. The animation-frame loop only
reads the position.
**Why.** Tone starts the transport slightly in the future, so its own state reads "stopped"
for the first frames after Play. Trusting it caused the UI to stop itself. The browser test
caught this.

## D-016: Interpretation and composition are separate stages

**Decision.** Prompt reading produces `PromptHints`. Merging produces a `GenerationPlan`.
A composer turns the plan into a document. Each stage has one input and one output type.
**Why.** The spec requires model adapters independent from editing logic. An LLM, keyword
rules, or later humming and reference-audio analysis can all feed the same plan. A neural
composer can replace the procedural one without touching the UI.

## D-017: A procedural composer first, clearly labelled

**Decision.** Phase 2 composition is rule-based and seeded (`procedural-v1`).
**Why.** It produces valid, editable, coherent structure today, with no GPU and no licensing
questions. It also defines the target format a learned model must emit later. The spec asks
for valid structures first and honest labels.
**Revisit** in Phase 9, with model candidates evaluated against the same plan format.

## D-018: The LLM is opt-in and only reads the prompt

**Decision.** `VIBESTUDIO_LLM_PROVIDER` defaults to `none`. With `anthropic`, Claude
(`claude-opus-5-5`, low effort) returns hints through structured outputs, validated again
by Pydantic.
**Why.** No surprise bills. It works offline by default. The model's output is a small,
validated settings object, not free text applied to the project. Server-side fallbacks
handle classifier refusals. Every failure degrades to keyword rules with a visible note.

## D-019: Patterns are shared across same-type sections

**Decision.** The composer writes one pattern per instrument per section type. Hook 1,
Hook 2 and Hook 3 play the same pattern.
**Why.** This matches how producers work in FL Studio: edit the hook once and every hook
changes. It also keeps documents small.
**Trade-off.** Some users will expect sections to be independent. The editors show "used N×".
A "make unique" action is a follow-up.

## D-020: MIDI is written by the backend

**Decision.** MIDI export posts the current, possibly unsaved, document to
`/api/export/midi`. The backend writes the file with `mido`.
**Why.** `mido` is mature and well tested. Keeping file formats server-side lets the desktop
app and the future FL Studio workflows reuse the same code. Clip expansion mirrors the
frontend scheduler, and tests check they match.

## D-021: Pinned SDK versions at least two weeks old

**Decision.** `anthropic==1.8.0` and `mido==1.3.3` are pinned exactly.
**Why.** Newer `anthropic` releases were days old when added. Pinning avoids pulling
unreviewed releases. Upgrade deliberately.

## D-022: pYIN for monophonic humming

**Decision.** Use librosa's pYIN plus rule-based segmentation, rather than a learned model
(Basic Pitch, CREPE) for now.
**Why.** pYIN is established and made for single voices. It gives per-frame voicing
probabilities, which become per-note confidence. It needs no GPU or model weights, and its
licence is permissive (ISC). It was exact on 89 of 90 synthetic takes. A learned model can
replace it behind the same output format.
**Version note.** librosa 1.x requires Python 3.12. The project stays on 3.11 with librosa 0.11.

## D-023: Raw-body uploads, validated by decoding

**Decision.** `POST /api/assets` takes the audio as the raw request body, with name and kind
as query parameters, not multipart.
**Why.** There's no extra dependency (python-multipart), the size limit can be enforced
while streaming, and validating by decoding rejects anything that isn't real audio,
whatever its extension or Content-Type claims.

## D-024: Immutable, content-addressed audio storage

**Decision.** Files are named by their SHA-256 and never modified. Metadata lives in an
`assets` table (migration 0002).
**Why.** The spec requires non-destructive editing and preserved originals. Paths derived
from hashes can't be steered by client file names. S3-compatible storage can replace the
local directory without changing ids or URIs.

## D-025: Note confidence as an optional schema field

**Decision.** `MidiNote.confidence: float | null` was added without bumping
`schemaVersion`.
**Why.** It's additive with a null default, so every v1 document still validates. Keeping it
on the note, not only in the review, lets uncertainty survive into the project until the
user confirms each note.

## D-026: Quantization in the browser

**Decision.** The backend returns detected notes in seconds. The frontend
(`project/quantize.ts`) converts them to beats with the chosen tempo, grid, strength,
octave and filters.
**Why.** Review controls respond instantly, with no round trips and no re-transcription.
The conversion is a pure function with unit tests.

## D-027: Fake-microphone browser tests

**Decision.** Playwright launches Edge or Chrome with `--use-file-for-fake-audio-capture`,
which plays a synthetic hum (`e2e/fixtures/hum-twinkle.wav`, made by
`backend/scripts/make_hum_fixture.py`) into `getUserMedia`.
**Why.** It exercises the real recorder, upload, transcription and editing path
automatically, with a known correct answer.

## D-028: Dirty tracking ignores key order

**Decision.** "Unsaved changes" compares documents with sorted keys, and after a save the
editor adopts the server's canonical copy when nothing changed in the meantime.
**Why.** Documents built on the client (such as a new melody track) serialise keys in a
different order from the server. A plain `JSON.stringify` comparison kept the project
"unsaved" forever. The hum browser test caught this.

## D-029: Rule-based beatbox classification with cluster voting

**Decision.** Classify hits with transparent feature rules (band energies, centroid,
flatness, decay), then let clusters of similar hits vote, without overruling hits that are
clearly one class.
**Why.** There's no labelled beatbox dataset to train on, no model weights to licence, and
it works offline. It is exact on synthetic takes at realistic noise levels. Beatboxers'
sounds vary widely, which is why correction (click to cycle, the Sounds mapping) is part of
the core UI, as the spec asks.
**Revisit** with a small learned classifier once real recordings exist; it fits behind the
same `DrumHit` output.

## D-030: Drum onsets on a dB spectrogram, refined and noise-gated

**Decision.** Spectral flux is computed on a dB STFT with linear frequency bins, onsets are
moved to the steepest level rise, and hits are gated against the recording's noise floor.
**Why.** Each step fixed a measured failure: mel-based flux missed quiet hi-hats, flux peaks
landed after a hat's 20 ms decay, and gating relative to the loudest hit dropped every hat.

## D-031: One shared recorder slice

**Decision.** Recording, upload and retake logic moved from the hum store into
`createRecorderSlice`, used by both panels.
**Why.** Beatbox needed the same flow. One implementation means one place to fix device,
permission and timing bugs, and Phase 6 vocal recording can reuse it.

## D-032: Separate Playwright projects per fake microphone

**Decision.** Chromium takes one fake-microphone file per launch, so the beatbox browser
test runs in its own Playwright project with `beatbox-boombap.wav`.
**Why.** Both takes need real end-to-end coverage, and the browser flag can't change
mid-run.
