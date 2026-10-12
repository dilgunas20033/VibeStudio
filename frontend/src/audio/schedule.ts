// Pure translation from the project document to timed note events. No Tone.js
// here, so timing logic is unit-testable without an AudioContext.
import type { MixerSettings, ProjectDocument } from '../types/project.generated'

export interface NoteEvent {
  trackId: string
  /** Absolute position on the timeline, in beats. */
  beat: number
  durationBeats: number
  pitch: number
  /** 0..1 */
  velocity: number
}

const EPS = 1e-9

/**
 * Expand every pattern clip into note events. A clip repeats its pattern until the
 * clip ends. Notes starting at or after the pattern length are ignored (kept in the
 * document, but silent). Notes are cut at the clip's end.
 */
export function collectEvents(doc: ProjectDocument): Map<string, NoteEvent[]> {
  const patterns = new Map(doc.patterns.map((p) => [p.id, p]))
  const byTrack = new Map<string, NoteEvent[]>(doc.tracks.map((t) => [t.id, []]))

  for (const clip of doc.clips) {
    const pattern = clip.patternId ? patterns.get(clip.patternId) : undefined
    const events = byTrack.get(clip.trackId)
    if (!pattern || !events || pattern.lengthBeats <= 0) continue
    const clipEnd = clip.startBeat + clip.lengthBeats
    const firstRep = Math.floor(clip.offsetBeats / pattern.lengthBeats)

    for (let rep = firstRep; ; rep++) {
      const repStart = clip.startBeat + rep * pattern.lengthBeats - clip.offsetBeats
      if (repStart >= clipEnd - EPS) break
      for (const n of pattern.notes) {
        if (n.startBeat >= pattern.lengthBeats - EPS) continue
        const beat = repStart + n.startBeat
        if (beat < clip.startBeat - EPS || beat >= clipEnd - EPS) continue
        events.push({
          trackId: clip.trackId,
          beat,
          durationBeats: Math.min(n.durationBeats, clipEnd - beat),
          pitch: n.pitch,
          velocity: n.velocity / 127,
        })
      }
    }
  }
  for (const list of byTrack.values()) list.sort((a, b) => a.beat - b.beat || a.pitch - b.pitch)
  return byTrack
}

/**
 * Whether each track is audible, applying mute and solo the way DAWs do: if any
 * track is soloed, only soloed tracks play. Mute wins over solo on the same track.
 */
export function audibleTracks(
  tracks: { id: string; mixer: MixerSettings }[],
): Map<string, boolean> {
  const anySolo = tracks.some((t) => t.mixer.solo)
  return new Map(tracks.map((t) => [t.id, !t.mixer.mute && (!anySolo || t.mixer.solo)]))
}
