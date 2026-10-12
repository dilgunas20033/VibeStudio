import { describe, expect, it } from 'vitest'
import { emptyDoc } from '../test/docs'
import { DEFAULT_MAPPING, hitsToBeats, nextClass, patternBarsFor, type DetectedHit } from './drums'
import { addDrumTracks, trackPattern } from './edit'

// "boom ts pf ts" at 120 BPM (0.5 s per beat), slightly loose, starting at 0.8 s.
const take: DetectedHit[] = [
  { time: 0.8, drum: 'kick', confidence: 0.9, velocity: 110 },
  { time: 1.06, drum: 'hihat', confidence: 0.8, velocity: 70 },
  { time: 1.31, drum: 'snare', confidence: 0.7, velocity: 100 },
  { time: 1.52, drum: 'hihat', confidence: 0.3, velocity: 65 },
  { time: 1.53, drum: 'hihat', confidence: 0.4, velocity: 80 }, // double trigger
]
const opts = { bpm: 120, grid: 0.25, strength: 1, overrides: new Map(), mapping: DEFAULT_MAPPING }

describe('hitsToBeats', () => {
  it('starts on beat 0, snaps, and merges same-drum duplicates (keeping the louder)', () => {
    const hits = hitsToBeats(take, opts)
    expect(hits.map((h) => [h.startBeat, h.drum])).toEqual([
      [0, 'kick'],
      [0.5, 'hihat'],
      [1, 'snare'],
      [1.5, 'hihat'],
    ])
    expect(hits[3]).toMatchObject({ velocity: 80, sourceIndex: 4 })
  })

  it('applies corrections and sound mapping', () => {
    const hits = hitsToBeats(take, {
      ...opts,
      overrides: new Map([[1, 'ignore'] as const, [2, 'clap'] as const]),
      mapping: { ...DEFAULT_MAPPING, hihat: 'perc' },
    })
    expect(hits.map((h) => h.drum)).toEqual(['kick', 'clap', 'perc'])
  })

  it('keeps performed timing with the grid off', () => {
    expect(hitsToBeats(take, { ...opts, grid: 0 })[1]!.startBeat).toBeCloseTo(0.52, 2)
    expect(hitsToBeats([], opts)).toEqual([])
  })

  it('cycles classes and sizes patterns', () => {
    expect(nextClass('kick')).toBe('snare')
    expect(nextClass('ignore')).toBe('kick')
    expect(patternBarsFor([{ startBeat: 3.75 }] as never)).toBe(1)
    expect(patternBarsFor([{ startBeat: 4 }] as never)).toBe(2)
    expect(patternBarsFor([{ startBeat: 13 }] as never)).toBe(4)
  })
})

describe('addDrumTracks', () => {
  it('creates one drum track per sound with GM pitches and keeps the recording', () => {
    const hits = hitsToBeats(take, opts)
    const asset = {
      id: 'ast_bb',
      name: 'bb.wav',
      uri: 'asset://audio/ast_bb',
      sha256: null,
      sampleRate: 22050,
      channels: 1,
      durationSeconds: 3,
    }
    const { doc, trackIds } = addDrumTracks(emptyDoc(), { hits, bars: 1, namePrefix: 'BB', asset })
    expect(doc.tracks.map((t) => t.name)).toEqual(['BB Kick', 'BB Snare', 'BB Hi-hat'])
    expect(trackIds).toHaveLength(3)
    const hat = trackPattern(doc, trackIds[2]!)!
    expect(hat.notes.map((n) => [n.startBeat, n.pitch])).toEqual([
      [0.5, 42],
      [1.5, 42],
    ])
    expect(hat.lengthBeats).toBe(4)
    expect(doc.assets).toEqual([asset])
  })
})
