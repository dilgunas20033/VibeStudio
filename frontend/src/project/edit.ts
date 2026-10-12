// Pure, immutable edits to a project document. UI components and (later) AI
// edit commands both go through these, so every change is validated the same
// way and stays easy to test and undo.
import type {
  AudioAsset,
  Clip,
  MidiNote,
  MixerSettings,
  Pattern,
  ProjectDocument,
  Track,
} from '../types/project.generated'
import { beatToStep, beatsPerBar, loopLengthBeats, stepToBeat, STEPS_PER_BEAT } from './music'
import { drumPreset, synthPreset, type DrumPreset, type SynthPreset } from './presets'
import { quantizeNotes } from './quantize'

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** The pattern a track plays: the pattern of its first clip. Phase 1 uses one clip per track. */
export function trackPattern(
  doc: ProjectDocument,
  trackId: string,
  beat?: number,
): Pattern | undefined {
  const clip = beat === undefined ? firstClip(doc, trackId) : clipAt(doc, trackId, beat)
  return doc.patterns.find((p) => p.id === clip?.patternId)
}

const firstClip = (doc: ProjectDocument, trackId: string) =>
  doc.clips
    .filter((c) => c.trackId === trackId && c.patternId)
    .sort((a, b) => a.startBeat - b.startBeat)[0]

/** The pattern clip on a track that is playing at `beat`, if any. */
export function clipAt(doc: ProjectDocument, trackId: string, beat: number): Clip | undefined {
  return doc.clips.find(
    (c) =>
      c.trackId === trackId &&
      c.patternId &&
      c.startBeat <= beat + 1e-9 &&
      beat < c.startBeat + c.lengthBeats - 1e-9,
  )
}

/** How many clips play this pattern. Editing a shared pattern changes all of them. */
export function patternUsage(doc: ProjectDocument, patternId: string): number {
  return doc.clips.filter((c) => c.patternId === patternId).length
}

/** The arrangement section containing `beat`, or the whole loop when there are none. */
export function sectionAt(
  doc: ProjectDocument,
  beat: number,
): { name: string; startBeat: number; lengthBeats: number } {
  const s = doc.sections.find((x) => x.startBeat <= beat && beat < x.startBeat + x.lengthBeats)
  return s ?? { name: 'Loop', startBeat: 0, lengthBeats: loopLengthBeats(doc) }
}

/**
 * Give a track an empty pattern in the section at `beat` (for tracks that are silent
 * there). Returns the document unchanged if the track already plays at that position.
 */
export function addSectionClip(
  doc: ProjectDocument,
  trackId: string,
  beat: number,
): ProjectDocument {
  const track = doc.tracks.find((t) => t.id === trackId)
  if (!track || clipAt(doc, trackId, beat)) return doc
  const section = sectionAt(doc, beat)
  const perBar = beatsPerBar(doc.timeSignature)
  const pattern: Pattern = {
    id: newId('pat'),
    name: `${section.name} ${track.name}`,
    lengthBeats: Math.min(section.lengthBeats, perBar * 4),
    notes: [],
  }
  const clip: Clip = {
    id: newId('clp'),
    trackId,
    patternId: pattern.id,
    assetId: null,
    startBeat: section.startBeat,
    lengthBeats: section.lengthBeats,
    offsetBeats: 0,
  }
  return { ...doc, patterns: [...doc.patterns, pattern], clips: [...doc.clips, clip] }
}

/** True when every clip starts at the top: the Phase 1 single-loop project shape. */
export function isSingleLoop(doc: ProjectDocument): boolean {
  return doc.sections.length === 0 && doc.clips.every((c) => c.startBeat === 0)
}

function updatePattern(
  doc: ProjectDocument,
  patternId: string,
  change: (p: Pattern) => Pattern,
): ProjectDocument {
  return { ...doc, patterns: doc.patterns.map((p) => (p.id === patternId ? change(p) : p)) }
}

export function updateTrack(
  doc: ProjectDocument,
  trackId: string,
  change: (t: Track) => Track,
): ProjectDocument {
  return { ...doc, tracks: doc.tracks.map((t) => (t.id === trackId ? change(t) : t)) }
}

export type AddTrackSpec =
  { kind: 'drums'; preset: DrumPreset } | { kind: 'instrument'; preset: SynthPreset }

/** Add a track with an empty one-bar pattern and a clip spanning the current loop. */
export function addTrack(
  doc: ProjectDocument,
  spec: AddTrackSpec,
): { doc: ProjectDocument; trackId: string } {
  const info = spec.kind === 'drums' ? drumPreset(spec.preset) : synthPreset(spec.preset)
  if (!info) throw new Error(`unknown preset ${spec.preset}`)
  const sameRole = doc.tracks.filter((t) => t.role === spec.preset).length
  const track: Track = {
    id: newId('trk'),
    name: sameRole ? `${info.name} ${sameRole + 1}` : info.name,
    kind: spec.kind,
    role: spec.preset,
    color: info.color,
    instrument: { type: spec.kind === 'drums' ? 'drum' : 'synth', preset: spec.preset, params: {} },
    mixer: { volumeDb: 0, pan: 0, mute: false, solo: false },
    effects: [],
  }
  const pattern: Pattern = {
    id: newId('pat'),
    name: track.name,
    lengthBeats: beatsPerBar(doc.timeSignature),
    notes: [],
  }
  const clip: Clip = {
    id: newId('clp'),
    trackId: track.id,
    patternId: pattern.id,
    assetId: null,
    startBeat: 0,
    lengthBeats: loopLengthBeats(doc),
    offsetBeats: 0,
  }
  return {
    doc: {
      ...doc,
      tracks: [...doc.tracks, track],
      patterns: [...doc.patterns, pattern],
      clips: [...doc.clips, clip],
    },
    trackId: track.id,
  }
}

/** Remove a track, its clips, and patterns no other clip uses. Leaves no dangling references. */
export function removeTrack(doc: ProjectDocument, trackId: string): ProjectDocument {
  const clips = doc.clips.filter((c) => c.trackId !== trackId)
  const used = new Set(clips.map((c) => c.patternId))
  const removedPatterns = new Set(
    doc.clips.filter((c) => c.trackId === trackId).map((c) => c.patternId),
  )
  return {
    ...doc,
    tracks: doc.tracks.filter((t) => t.id !== trackId),
    clips,
    patterns: doc.patterns.filter((p) => used.has(p.id) || !removedPatterns.has(p.id)),
  }
}

export function setMixer(
  doc: ProjectDocument,
  trackId: string,
  change: Partial<MixerSettings>,
): ProjectDocument {
  return updateTrack(doc, trackId, (t) => {
    const m = { ...t.mixer, ...change }
    return { ...t, mixer: { ...m, volumeDb: clamp(m.volumeDb, -96, 12), pan: clamp(m.pan, -1, 1) } }
  })
}

const noteAtStep = (p: Pattern, step: number) =>
  p.notes.find((n) => beatToStep(n.startBeat) === step)

/** Drum step sequencer: toggle a one-step hit in the track's pattern at `beat` (default: first clip). */
export function toggleStep(
  doc: ProjectDocument,
  trackId: string,
  step: number,
  beat?: number,
): ProjectDocument {
  const pattern = trackPattern(doc, trackId, beat)
  const track = doc.tracks.find((t) => t.id === trackId)
  if (!pattern || !track) return doc
  const existing = noteAtStep(pattern, step)
  if (existing) return removeNote(doc, pattern.id, existing.id)
  const pitch = drumPreset(track.role)?.pitch ?? 36
  return addNote(doc, pattern.id, {
    pitch,
    startBeat: stepToBeat(step),
    durationBeats: 1 / STEPS_PER_BEAT,
  })
}

export function addNote(
  doc: ProjectDocument,
  patternId: string,
  note: Omit<MidiNote, 'id' | 'velocity' | 'confidence'> & {
    velocity?: number
    confidence?: number | null
  },
): ProjectDocument {
  const n: MidiNote = {
    id: newId('note'),
    pitch: clamp(Math.round(note.pitch), 0, 127),
    startBeat: Math.max(0, note.startBeat),
    durationBeats: Math.max(1 / STEPS_PER_BEAT / 4, note.durationBeats),
    velocity: clamp(Math.round(note.velocity ?? 100), 1, 127),
    confidence: note.confidence ?? null,
  }
  return updatePattern(doc, patternId, (p) => ({
    ...p,
    notes: [...p.notes, n].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch),
  }))
}

export function removeNote(
  doc: ProjectDocument,
  patternId: string,
  noteId: string,
): ProjectDocument {
  return updatePattern(doc, patternId, (p) => ({
    ...p,
    notes: p.notes.filter((n) => n.id !== noteId),
  }))
}

/**
 * Change a pattern's length in bars. Notes past the new end are kept, not deleted:
 * they are silent until the pattern grows again.
 */
export function setPatternBars(
  doc: ProjectDocument,
  patternId: string,
  bars: number,
): ProjectDocument {
  const lengthBeats = clamp(Math.round(bars), 1, 64) * beatsPerBar(doc.timeSignature)
  return updatePattern(doc, patternId, (p) => ({ ...p, lengthBeats }))
}

/** Set the loop length in bars by resizing every clip. Phase 1 clips all start at beat 0. */
export function setLoopBars(doc: ProjectDocument, bars: number): ProjectDocument {
  const lengthBeats = clamp(Math.round(bars), 1, 64) * beatsPerBar(doc.timeSignature)
  return { ...doc, clips: doc.clips.map((c) => ({ ...c, lengthBeats })) }
}

/**
 * Change some notes of a pattern. Edited notes lose their transcription confidence:
 * once the user has touched a note, it counts as confirmed.
 */
export function updateNotes(
  doc: ProjectDocument,
  patternId: string,
  noteIds: ReadonlySet<string>,
  change: (n: MidiNote) => Partial<MidiNote>,
): ProjectDocument {
  return updatePattern(doc, patternId, (p) => ({
    ...p,
    notes: p.notes
      .map((n) => {
        if (!noteIds.has(n.id)) return n
        const next = { ...n, ...change(n), confidence: null }
        return {
          ...next,
          pitch: clamp(Math.round(next.pitch), 0, 127),
          startBeat: Math.max(0, next.startBeat),
          durationBeats: Math.max(1 / 16, next.durationBeats),
          velocity: clamp(Math.round(next.velocity), 1, 127),
        }
      })
      .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch),
  }))
}

export function removeNotes(
  doc: ProjectDocument,
  patternId: string,
  noteIds: ReadonlySet<string>,
): ProjectDocument {
  return updatePattern(doc, patternId, (p) => ({
    ...p,
    notes: p.notes.filter((n) => !noteIds.has(n.id)),
  }))
}

/** Quantize the given notes (or all notes) of a pattern to `grid` beats. */
export function quantizePattern(
  doc: ProjectDocument,
  patternId: string,
  grid: number,
  noteIds?: ReadonlySet<string>,
): ProjectDocument {
  const pattern = doc.patterns.find((p) => p.id === patternId)
  if (!pattern) return doc
  const ids = noteIds ?? new Set(pattern.notes.map((n) => n.id))
  const snapped = new Map(
    quantizeNotes(
      pattern.notes.filter((n) => ids.has(n.id)),
      grid,
    ).map((n) => [n.id, n]),
  )
  return updateNotes(doc, patternId, ids, (n) => {
    const s = snapped.get(n.id)!
    return { startBeat: s.startBeat, durationBeats: s.durationBeats }
  })
}

/**
 * Add a melody (e.g. transcribed humming) as a new synth track whose clip starts at
 * `startBeat`. Notes keep their confidence so uncertain ones stay marked. The source
 * recording, if given, is kept in the project's assets.
 */
export function addMelodyTrack(
  doc: ProjectDocument,
  melody: {
    notes: readonly Omit<MidiNote, 'id'>[]
    preset: SynthPreset
    name: string
    startBeat?: number
    asset?: AudioAsset
  },
): { doc: ProjectDocument; trackId: string } {
  const { doc: withTrack, trackId } = addTrack(doc, { kind: 'instrument', preset: melody.preset })
  const perBar = beatsPerBar(doc.timeSignature)
  const end = Math.max(...melody.notes.map((n) => n.startBeat + n.durationBeats), perBar)
  const bars = Math.ceil(end / perBar - 1e-6)
  const start = melody.startBeat ?? 0
  const clip = withTrack.clips.find((c) => c.trackId === trackId)!
  const patternId = clip.patternId!
  let next: ProjectDocument = {
    ...updateTrack(withTrack, trackId, (t) => ({ ...t, name: melody.name })),
    patterns: withTrack.patterns.map((p) =>
      p.id === patternId
        ? {
            ...p,
            name: melody.name,
            lengthBeats: bars * perBar,
            notes: melody.notes.map((n) => ({ ...n, id: newId('note') })),
          }
        : p,
    ),
    clips: withTrack.clips.map((c) =>
      c.id === clip.id
        ? {
            ...c,
            startBeat: start,
            lengthBeats: Math.max(bars * perBar, loopLengthBeats(doc) - start),
          }
        : c,
    ),
  }
  if (melody.asset && !next.assets.some((a) => a.id === melody.asset!.id)) {
    next = { ...next, assets: [...next.assets, melody.asset] }
  }
  return { doc: next, trackId }
}

/**
 * Add a beatboxed drum pattern as one drum track per sound, each with its own pattern and
 * a clip starting at `startBeat`. Returns the new track ids in kit order.
 */
export function addDrumTracks(
  doc: ProjectDocument,
  pattern: {
    hits: readonly { startBeat: number; drum: DrumPreset; velocity: number }[]
    bars: number
    namePrefix: string
    startBeat?: number
    asset?: AudioAsset
  },
): { doc: ProjectDocument; trackIds: string[] } {
  const perBar = beatsPerBar(doc.timeSignature)
  const start = pattern.startBeat ?? 0
  const lengthBeats = pattern.bars * perBar
  const songEnd = loopLengthBeats(doc)
  let next = doc
  const trackIds: string[] = []
  const order: DrumPreset[] = ['kick', 'snare', 'clap', 'hihat', 'openhat', 'perc']
  for (const drum of order) {
    const hits = pattern.hits.filter((h) => h.drum === drum)
    if (!hits.length) continue
    const added = addTrack(next, { kind: 'drums', preset: drum })
    const clip = added.doc.clips.find((c) => c.trackId === added.trackId)!
    const pitch = drumPreset(drum)?.pitch ?? 36
    const name = `${pattern.namePrefix} ${drumPreset(drum)?.name ?? drum}`
    next = {
      ...updateTrack(added.doc, added.trackId, (t) => ({ ...t, name })),
      patterns: added.doc.patterns.map((p) =>
        p.id === clip.patternId
          ? {
              ...p,
              name,
              lengthBeats,
              notes: hits.map((h) => ({
                id: newId('note'),
                pitch,
                startBeat: h.startBeat,
                durationBeats: drum === 'openhat' ? 0.5 : 0.25,
                velocity: clamp(Math.round(h.velocity), 1, 127),
                confidence: null,
              })),
            }
          : p,
      ),
      clips: added.doc.clips.map((c) =>
        c.id === clip.id
          ? { ...c, startBeat: start, lengthBeats: Math.max(lengthBeats, songEnd - start) }
          : c,
      ),
    }
    trackIds.push(added.trackId)
  }
  if (pattern.asset && !next.assets.some((a) => a.id === pattern.asset!.id)) {
    next = { ...next, assets: [...next.assets, pattern.asset] }
  }
  return { doc: next, trackIds }
}
