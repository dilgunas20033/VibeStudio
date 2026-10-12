// Beatbox hits -> drum notes in beats. Pure: the review re-runs it on every change.
import type { DrumPreset } from './presets'

export type DetectedDrum = 'kick' | 'snare' | 'hihat' | 'openhat' | 'perc'

export interface DetectedHit {
  time: number // seconds
  drum: string
  confidence: number
  velocity: number
}

export interface DrumBeatHit {
  startBeat: number
  drum: DrumPreset
  velocity: number
  confidence: number
  sourceIndex: number
}

export type ClassChoice = DrumPreset | 'ignore'

export interface DrumQuantizeOptions {
  bpm: number
  grid: number
  strength: number
  /** Per-hit class corrections by detected-hit index. */
  overrides: ReadonlyMap<number, ClassChoice>
  /** Which kit sound each detected class plays (drum sound replacement). */
  mapping: Readonly<Record<DetectedDrum, ClassChoice>>
}

export const DEFAULT_MAPPING: Record<DetectedDrum, ClassChoice> = {
  kick: 'kick',
  snare: 'snare',
  hihat: 'hihat',
  openhat: 'openhat',
  perc: 'perc',
}

/** The class order a click cycles through when correcting a hit. */
export const CYCLE: ClassChoice[] = ['kick', 'snare', 'clap', 'hihat', 'openhat', 'perc', 'ignore']

export function nextClass(current: ClassChoice): ClassChoice {
  return CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length]!
}

/** The class a hit currently plays, after corrections and sound mapping. */
export function effectiveClass(
  hit: DetectedHit,
  index: number,
  opts: Pick<DrumQuantizeOptions, 'overrides' | 'mapping'>,
): ClassChoice {
  const override = opts.overrides.get(index)
  if (override) return override
  return opts.mapping[hit.drum as DetectedDrum] ?? 'perc'
}

/**
 * Convert hits to beats, with the first hit on beat 0, snapped to the grid. Two hits of
 * the same drum on one grid step merge (keeping the louder).
 */
export function hitsToBeats(
  hits: readonly DetectedHit[],
  opts: DrumQuantizeOptions,
): DrumBeatHit[] {
  if (!hits.length || opts.bpm <= 0) return []
  const t0 = hits[0]!.time
  const out = new Map<string, DrumBeatHit>()
  hits.forEach((h, i) => {
    const drum = effectiveClass(h, i, opts)
    if (drum === 'ignore') return
    const raw = (h.time - t0) * (opts.bpm / 60)
    const snapped =
      opts.grid > 0 ? raw + (Math.round(raw / opts.grid) * opts.grid - raw) * opts.strength : raw
    const startBeat = Math.max(0, Math.round(snapped * 10_000) / 10_000)
    const key = `${drum}@${startBeat}`
    const prev = out.get(key)
    if (!prev || h.velocity > prev.velocity) {
      out.set(key, {
        startBeat,
        drum,
        velocity: h.velocity,
        confidence: h.confidence,
        sourceIndex: i,
      })
    }
  })
  return [...out.values()].sort((a, b) => a.startBeat - b.startBeat)
}

/** Pattern length that fits the hits: 1, 2, 4 or 8 bars. */
export function patternBarsFor(hits: readonly DrumBeatHit[], beatsPerBar = 4): number {
  const end = Math.max(0, ...hits.map((h) => h.startBeat)) + 0.25
  return [1, 2, 4, 8].find((b) => b * beatsPerBar >= end - 1e-6) ?? 8
}
