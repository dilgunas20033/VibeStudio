import { describe, expect, it } from 'vitest'
import { emptyDoc } from '../test/docs'
import {
  addNote,
  addSectionClip,
  addTrack,
  clipAt,
  isSingleLoop,
  patternUsage,
  sectionAt,
  removeNote,
  removeTrack,
  setLoopBars,
  setMixer,
  setPatternBars,
  toggleStep,
  trackPattern,
} from './edit'
import { beatsPerBar, formatPosition, isInScale, loopLengthBeats, noteName } from './music'

describe('music helpers', () => {
  it('computes bar lengths and positions', () => {
    expect(beatsPerBar({ numerator: 4, denominator: 4 })).toBe(4)
    expect(beatsPerBar({ numerator: 6, denominator: 8 })).toBe(3)
    expect(formatPosition(0, { numerator: 4, denominator: 4 })).toBe('1.1.1')
    expect(formatPosition(5.75, { numerator: 4, denominator: 4 })).toBe('2.2.4')
  })

  it('names notes and checks scales', () => {
    expect(noteName(60)).toBe('C4')
    expect(noteName(33)).toBe('A1')
    const aMinor = { root: 'A', mode: 'minor' } as const
    expect([69, 71, 72, 74, 76, 77, 79].every((p) => isInScale(p, aMinor))).toBe(true)
    expect(isInScale(70, aMinor)).toBe(false)
  })

  it('loop length is at least one bar', () => {
    expect(loopLengthBeats(emptyDoc())).toBe(4)
  })
})

describe('project edits', () => {
  it('adds a track with pattern and clip spanning the loop', () => {
    const { doc, trackId } = addTrack(emptyDoc(), { kind: 'drums', preset: 'kick' })
    expect(doc.tracks).toHaveLength(1)
    expect(doc.tracks[0]).toMatchObject({ id: trackId, kind: 'drums', role: 'kick', name: 'Kick' })
    expect(doc.tracks[0]!.id).toMatch(/^[A-Za-z0-9_-]+$/)
    const pattern = trackPattern(doc, trackId)
    expect(pattern?.lengthBeats).toBe(4)
    expect(doc.clips[0]).toMatchObject({
      trackId,
      patternId: pattern!.id,
      startBeat: 0,
      lengthBeats: 4,
    })
    // Duplicate presets get numbered names.
    expect(addTrack(doc, { kind: 'drums', preset: 'kick' }).doc.tracks[1]!.name).toBe('Kick 2')
  })

  it('toggles drum steps using the General MIDI pitch', () => {
    const { doc, trackId } = addTrack(emptyDoc(), { kind: 'drums', preset: 'snare' })
    const on = toggleStep(doc, trackId, 4)
    const notes = trackPattern(on, trackId)!.notes
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ pitch: 38, startBeat: 1, durationBeats: 0.25, velocity: 100 })
    expect(trackPattern(toggleStep(on, trackId, 4), trackId)!.notes).toHaveLength(0)
    expect(doc).not.toBe(on) // immutable
    expect(trackPattern(doc, trackId)!.notes).toHaveLength(0)
  })

  it('adds and removes notes, keeping them sorted and in range', () => {
    const { doc, trackId } = addTrack(emptyDoc(), { kind: 'instrument', preset: 'lead' })
    const pid = trackPattern(doc, trackId)!.id
    let d = addNote(doc, pid, { pitch: 72, startBeat: 2, durationBeats: 0.5 })
    d = addNote(d, pid, { pitch: 200, startBeat: 1, durationBeats: 0.5, velocity: 999 })
    const notes = trackPattern(d, trackId)!.notes
    expect(notes.map((n) => n.startBeat)).toEqual([1, 2])
    expect(notes[0]).toMatchObject({ pitch: 127, velocity: 127 })
    expect(trackPattern(removeNote(d, pid, notes[0]!.id), trackId)!.notes).toHaveLength(1)
  })

  it('removes a track without leaving dangling clips or patterns', () => {
    let { doc } = addTrack(emptyDoc(), { kind: 'drums', preset: 'kick' })
    const second = addTrack(doc, { kind: 'instrument', preset: 'bass' })
    doc = removeTrack(second.doc, doc.tracks[0]!.id)
    expect(doc.tracks.map((t) => t.role)).toEqual(['bass'])
    expect(doc.clips.every((c) => doc.tracks.some((t) => t.id === c.trackId))).toBe(true)
    expect(doc.patterns).toHaveLength(1)
  })

  it('clamps mixer values', () => {
    const { doc, trackId } = addTrack(emptyDoc(), { kind: 'drums', preset: 'kick' })
    const t = setMixer(doc, trackId, { volumeDb: 50, pan: -3, mute: true }).tracks[0]!
    expect(t.mixer).toEqual({ volumeDb: 12, pan: -1, mute: true, solo: false })
  })

  it('resizes patterns without deleting notes, and resizes the loop', () => {
    const { doc, trackId } = addTrack(emptyDoc(), { kind: 'drums', preset: 'kick' })
    const pid = trackPattern(doc, trackId)!.id
    let d = setPatternBars(doc, pid, 2)
    d = toggleStep(d, trackId, 12 + 4) // beat 4, second bar
    d = setPatternBars(d, pid, 1)
    expect(trackPattern(d, trackId)!.lengthBeats).toBe(4)
    expect(trackPattern(d, trackId)!.notes).toHaveLength(1)
    expect(loopLengthBeats(setLoopBars(d, 4))).toBe(16)
  })
})

describe('multi-section editing', () => {
  function twoSections() {
    let { doc, trackId } = addTrack(emptyDoc(), { kind: 'drums', preset: 'kick' })
    doc = {
      ...doc,
      clips: doc.clips.map((c) => ({ ...c, startBeat: 8, lengthBeats: 8 })),
      sections: [
        { id: 's1', name: 'Intro', startBeat: 0, lengthBeats: 8 },
        { id: 's2', name: 'Hook', startBeat: 8, lengthBeats: 8 },
      ],
    }
    return { doc, trackId }
  }

  it('finds the clip under a position and edits only that pattern', () => {
    const { doc, trackId } = twoSections()
    expect(clipAt(doc, trackId, 0)).toBeUndefined()
    expect(clipAt(doc, trackId, 9)?.startBeat).toBe(8)
    expect(toggleStep(doc, trackId, 0, 0)).toBe(doc) // nothing to edit in the intro
    const edited = toggleStep(doc, trackId, 0, 9)
    expect(trackPattern(edited, trackId, 9)!.notes).toHaveLength(1)
  })

  it('adds a pattern for a silent section and reports sharing', () => {
    const { doc, trackId } = twoSections()
    expect(isSingleLoop(doc)).toBe(false)
    const withIntro = addSectionClip(doc, trackId, 3)
    const intro = clipAt(withIntro, trackId, 3)!
    expect(intro).toMatchObject({ startBeat: 0, lengthBeats: 8 })
    expect(addSectionClip(withIntro, trackId, 3)).toBe(withIntro) // already has one
    expect(patternUsage(withIntro, intro.patternId!)).toBe(1)
    expect(sectionAt(withIntro, 9).name).toBe('Hook')
    expect(sectionAt(emptyDoc(), 0)).toMatchObject({ name: 'Loop', startBeat: 0 })
  })
})
