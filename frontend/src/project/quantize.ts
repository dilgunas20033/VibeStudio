// Turns transcribed notes (seconds) into beat-based notes, and quantizes note lists.
// Pure functions: the hum review UI re-runs these on every slider change.

export interface DetectedNote {
  start: number // seconds
  end: number
  pitch: number
  confidence: number
  velocity: number
}

export interface BeatNote {
  startBeat: number
  durationBeats: number
  pitch: number
  velocity: number
  confidence: number | null
}

/** A reviewed note plus the index of the detected note it came from (UI only). */
export interface ReviewNote extends BeatNote {
  sourceIndex: number
}

export interface QuantizeOptions {
  bpm: number
  /** Grid size in beats (0.25 = sixteenth). 0 disables quantization. */
  grid: number
  /** 0 = keep the performed timing, 1 = snap fully to the grid. */
  strength: number
  /** Semitones added to every note (usually a multiple of 12). */
  transpose: number
  /** Notes below this confidence are dropped. */
  minConfidence: number
  /** Indices of detected notes the user excluded. */
  excluded?: ReadonlySet<number>
}

const MIN_DURATION = 1 / 16

function snap(value: number, grid: number, strength: number): number {
  if (grid <= 0 || strength <= 0) return value
  const target = Math.round(value / grid) * grid
  return value + (target - value) * Math.min(1, strength)
}

/**
 * Convert detected notes to beats, starting the first kept note on beat 0 (bar 1).
 * The result is monophonic: overlapping notes are trimmed, and two notes snapped onto
 * the same start keep only the more confident one.
 */
export function detectedToBeats(
  notes: readonly DetectedNote[],
  opts: QuantizeOptions,
): ReviewNote[] {
  const kept = notes
    .map((n, i) => ({ n, i }))
    .filter(({ n, i }) => n.confidence >= opts.minConfidence && !opts.excluded?.has(i))
  if (kept.length === 0 || opts.bpm <= 0) return []
  const t0 = kept[0]!.n.start
  const perSecond = opts.bpm / 60

  const placed: ReviewNote[] = []
  for (const { n, i } of kept) {
    const start = Math.max(0, snap((n.start - t0) * perSecond, opts.grid, opts.strength))
    let end = snap((n.end - t0) * perSecond, opts.grid, opts.strength)
    if (end - start < (opts.grid || MIN_DURATION)) end = start + (opts.grid || MIN_DURATION)
    const note: ReviewNote = {
      sourceIndex: i,
      startBeat: round(start),
      durationBeats: round(end - start),
      pitch: Math.min(127, Math.max(0, n.pitch + opts.transpose)),
      velocity: n.velocity,
      confidence: n.confidence,
    }
    const prev = placed[placed.length - 1]
    if (prev && Math.abs(prev.startBeat - note.startBeat) < 1e-6) {
      if ((note.confidence ?? 0) > (prev.confidence ?? 0)) placed[placed.length - 1] = note
      continue
    }
    placed.push(note)
  }
  for (let i = 0; i < placed.length - 1; i++) {
    const cur = placed[i]!
    const next = placed[i + 1]!
    if (cur.startBeat + cur.durationBeats > next.startBeat) {
      cur.durationBeats = round(Math.max(MIN_DURATION, next.startBeat - cur.startBeat))
    }
  }
  return placed
}

const round = (v: number) => Math.round(v * 10_000) / 10_000

/** Snap starts (and lengths, to at least one grid step) of existing notes. */
export function quantizeNotes<T extends { startBeat: number; durationBeats: number }>(
  notes: readonly T[],
  grid: number,
): T[] {
  if (grid <= 0) return [...notes]
  return notes.map((n) => ({
    ...n,
    startBeat: round(Math.round(n.startBeat / grid) * grid),
    durationBeats: round(Math.max(grid, Math.round(n.durationBeats / grid) * grid)),
  }))
}

/** Strip UI-only fields before sending notes to the backend or into a project. */
export const toBeatNotes = (notes: readonly ReviewNote[]): BeatNote[] =>
  notes.map(({ sourceIndex: _sourceIndex, ...n }) => n)
