import { describe, expect, it } from 'vitest'
import {
  addNote,
  addTrack,
  setLoopBars,
  setMixer,
  setPatternBars,
  toggleStep,
  trackPattern,
} from '../project/edit'
import { emptyDoc } from '../test/docs'
import { audibleTracks, collectEvents } from './schedule'

function kickDoc() {
  const { doc, trackId } = addTrack(emptyDoc(), { kind: 'drums', preset: 'kick' })
  let d = toggleStep(doc, trackId, 0)
  d = toggleStep(d, trackId, 8)
  return { doc: d, trackId }
}

describe('collectEvents', () => {
  it('turns pattern notes into timed events', () => {
    const { doc, trackId } = kickDoc()
    const events = collectEvents(doc).get(trackId)!
    expect(events.map((e) => e.beat)).toEqual([0, 2])
    expect(events[0]).toMatchObject({ pitch: 36, durationBeats: 0.25 })
    expect(events[0]!.velocity).toBeCloseTo(100 / 127)
  })

  it('repeats a short pattern across a longer clip', () => {
    const { doc, trackId } = kickDoc()
    const events = collectEvents(setLoopBars(doc, 3)).get(trackId)!
    expect(events.map((e) => e.beat)).toEqual([0, 2, 4, 6, 8, 10])
  })

  it('ignores notes past the pattern end and cuts notes at the clip end', () => {
    const { doc, trackId } = addTrack(emptyDoc(), { kind: 'instrument', preset: 'bass' })
    const pid = trackPattern(doc, trackId)!.id
    let d = setPatternBars(doc, pid, 2)
    d = addNote(d, pid, { pitch: 33, startBeat: 3, durationBeats: 4 }) // crosses clip end at 4
    d = addNote(d, pid, { pitch: 36, startBeat: 6, durationBeats: 1 }) // in bar 2
    d = setPatternBars(d, pid, 1) // bar-2 note is now beyond the pattern
    const events = collectEvents(d).get(trackId)!
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ beat: 3, durationBeats: 1, pitch: 33 })
  })

  it('changing a note changes the schedule', () => {
    const { doc, trackId } = kickDoc()
    const changed = toggleStep(doc, trackId, 8)
    expect(
      collectEvents(changed)
        .get(trackId)!
        .map((e) => e.beat),
    ).toEqual([0])
  })
})

describe('audibleTracks', () => {
  it('applies mute and solo like a mixer', () => {
    let doc = emptyDoc()
    for (const preset of ['kick', 'snare', 'hihat'] as const) {
      doc = addTrack(doc, { kind: 'drums', preset }).doc
    }
    const [k, s, h] = doc.tracks.map((t) => t.id) as [string, string, string]
    expect([...audibleTracks(doc.tracks).values()]).toEqual([true, true, true])

    doc = setMixer(doc, k, { mute: true })
    expect([...audibleTracks(doc.tracks).values()]).toEqual([false, true, true])

    doc = setMixer(doc, s, { solo: true })
    expect([...audibleTracks(doc.tracks).values()]).toEqual([false, true, false])

    doc = setMixer(doc, s, { mute: true }) // mute beats solo
    expect(audibleTracks(doc.tracks).get(s)).toBe(false)
    expect(audibleTracks(doc.tracks).get(h)).toBe(false)
  })
})
