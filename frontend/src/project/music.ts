import type { MusicalKey, ProjectDocument, TimeSignature } from '../types/project.generated'

/** The editing grid is sixteenth notes: four steps per quarter-note beat. */
export const STEPS_PER_BEAT = 4

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

const SCALES: Record<MusicalKey['mode'], number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
}

/** Quarter-note beats per bar, e.g. 4 for 4/4 and 3 for 6/8. */
export function beatsPerBar(ts: TimeSignature): number {
  return (ts.numerator * 4) / ts.denominator
}

/** "C4" style name; MIDI 60 is C4. */
export function noteName(pitch: number): string {
  return `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`
}

export function isInScale(pitch: number, key: MusicalKey): boolean {
  const root = NOTE_NAMES.indexOf(key.root)
  return SCALES[key.mode].includes((((pitch - root) % 12) + 12) % 12)
}

export function stepToBeat(step: number): number {
  return step / STEPS_PER_BEAT
}

/** Nearest grid step for a beat position. Tolerates float error from stored beats. */
export function beatToStep(beat: number): number {
  return Math.round(beat * STEPS_PER_BEAT)
}

/** Length of the playable loop: the end of the last clip, at least one bar. */
export function loopLengthBeats(doc: ProjectDocument): number {
  const end = doc.clips.reduce((max, c) => Math.max(max, c.startBeat + c.lengthBeats), 0)
  return Math.max(end, beatsPerBar(doc.timeSignature))
}

/** 1-based bar.beat.sixteenth display, e.g. "2.3.1". */
export function formatPosition(beat: number, ts: TimeSignature): string {
  const perBar = beatsPerBar(ts)
  const bar = Math.floor(beat / perBar) + 1
  const inBar = beat - (bar - 1) * perBar
  const b = Math.floor(inBar) + 1
  const sixteenth = Math.floor((inBar - Math.floor(inBar)) * STEPS_PER_BEAT) + 1
  return `${bar}.${b}.${sixteenth}`
}
