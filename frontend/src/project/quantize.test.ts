import { describe, expect, it } from 'vitest'
import { emptyDoc } from '../test/docs'
import {
  addMelodyTrack,
  addNote,
  addTrack,
  quantizePattern,
  removeNotes,
  trackPattern,
  updateNotes,
} from './edit'
import { detectedToBeats, quantizeNotes, toBeatNotes, type DetectedNote } from './quantize'

// A slightly sloppy performance at 120 BPM (0.5 s per beat), starting at 1.03 s.
const sung: DetectedNote[] = [
  { start: 1.03, end: 1.48, pitch: 60, confidence: 0.95, velocity: 100 },
  { start: 1.55, end: 1.98, pitch: 62, confidence: 0.9, velocity: 90 },
  { start: 2.01, end: 2.95, pitch: 64, confidence: 0.3, velocity: 80 },
  { start: 3.06, end: 3.5, pitch: 65, confidence: 0.85, velocity: 95 },
]
const opts = { bpm: 120, grid: 0.25, strength: 1, transpose: 0, minConfidence: 0 }

describe('detectedToBeats', () => {
  it('starts on beat 0 and snaps to the grid', () => {
    const notes = detectedToBeats(sung, opts)
    expect(notes.map((n) => n.startBeat)).toEqual([0, 1, 2, 4])
    expect(notes.map((n) => n.durationBeats)).toEqual([1, 1, 1.75, 1]) // ends snap too
    expect(notes.map((n) => n.sourceIndex)).toEqual([0, 1, 2, 3])
    expect(notes[2]!.confidence).toBe(0.3)
  })

  it('partial strength moves notes part of the way', () => {
    const raw = detectedToBeats(sung, { ...opts, grid: 0 })
    const half = detectedToBeats(sung, { ...opts, strength: 0.5 })
    expect(raw[1]!.startBeat).toBeCloseTo(1.04, 2)
    expect(half[1]!.startBeat).toBeCloseTo(1.02, 2)
  })

  it('filters by confidence and exclusions, transposes, and drops UI fields', () => {
    const notes = detectedToBeats(sung, {
      ...opts,
      minConfidence: 0.5,
      transpose: 12,
      excluded: new Set([3]),
    })
    expect(notes.map((n) => n.pitch)).toEqual([72, 74])
    expect(toBeatNotes(notes)[0]).not.toHaveProperty('sourceIndex')
  })

  it('stays monophonic: trims overlaps and resolves collisions by confidence', () => {
    const overlap: DetectedNote[] = [
      { start: 0, end: 1.2, pitch: 60, confidence: 0.9, velocity: 100 },
      { start: 0.5, end: 1.0, pitch: 62, confidence: 0.9, velocity: 100 },
      { start: 0.52, end: 0.9, pitch: 64, confidence: 0.99, velocity: 100 },
    ]
    const notes = detectedToBeats(overlap, opts)
    expect(notes.map((n) => [n.startBeat, n.pitch])).toEqual([
      [0, 60],
      [1, 64],
    ])
    expect(notes[0]!.durationBeats).toBe(1)
    expect(detectedToBeats([], opts)).toEqual([])
  })
})

describe('note editing', () => {
  function withNotes() {
    const { doc, trackId } = addTrack(emptyDoc(), { kind: 'instrument', preset: 'lead' })
    const pid = trackPattern(doc, trackId)!.id
    let d = addNote(doc, pid, { pitch: 60, startBeat: 0.1, durationBeats: 0.4, confidence: 0.3 })
    d = addNote(d, pid, { pitch: 64, startBeat: 1.9, durationBeats: 0.6 })
    return { doc: d, trackId, pid }
  }

  it('moves and transposes notes, confirming them', () => {
    const { doc, trackId, pid } = withNotes()
    const [a] = trackPattern(doc, trackId)!.notes
    const d = updateNotes(doc, pid, new Set([a!.id]), (n) => ({
      pitch: n.pitch + 12,
      startBeat: n.startBeat + 1,
    }))
    const moved = trackPattern(d, trackId)!.notes.find((n) => n.id === a!.id)!
    expect(moved).toMatchObject({ pitch: 72, startBeat: 1.1, confidence: null })
  })

  it('quantizes and removes notes', () => {
    const { doc, trackId, pid } = withNotes()
    const q = trackPattern(quantizePattern(doc, pid, 0.5), trackId)!.notes
    expect(q.map((n) => [n.startBeat, n.durationBeats])).toEqual([
      [0, 0.5],
      [2, 0.5],
    ])
    expect(quantizeNotes([{ startBeat: 0.3, durationBeats: 0.05 }], 0)).toEqual([
      { startBeat: 0.3, durationBeats: 0.05 },
    ])
    const ids = new Set(trackPattern(doc, trackId)!.notes.map((n) => n.id))
    expect(trackPattern(removeNotes(doc, pid, ids), trackId)!.notes).toEqual([])
  })

  it('adds a melody track that keeps confidence and the source recording', () => {
    const asset = {
      id: 'ast_1',
      name: 'hum.wav',
      uri: 'asset://audio/ast_1',
      sha256: null,
      sampleRate: 22050,
      channels: 1,
      durationSeconds: 5,
    }
    const notes = toBeatNotes(detectedToBeats(sung, opts))
    const { doc, trackId } = addMelodyTrack(emptyDoc(), {
      notes,
      preset: 'pluck',
      name: 'Hum (Pluck)',
      asset,
    })
    const track = doc.tracks.find((t) => t.id === trackId)!
    expect(track).toMatchObject({ name: 'Hum (Pluck)', role: 'pluck' })
    const pattern = trackPattern(doc, trackId)!
    expect(pattern.lengthBeats).toBe(8) // 5 beats of notes rounds up to 2 bars
    expect(pattern.notes.map((n) => n.confidence)).toEqual([0.95, 0.9, 0.3, 0.85])
    expect(doc.assets).toEqual([asset])
  })
})
