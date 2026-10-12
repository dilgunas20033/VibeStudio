import { noteName } from '../../project/music'
import type { ReviewNote } from '../../project/quantize'
import type { MelodyTranscription } from '../../types/api'

const LOW_CONFIDENCE = 0.5

/**
 * Mini piano roll of the transcription: the sung pitch curve behind the detected notes.
 * Uncertain notes are amber and dashed. Click a note to leave it out (or bring it back).
 */
export function MelodyReview({
  transcription,
  notes,
  bpm,
  transpose,
  excluded,
  onToggle,
}: {
  transcription: MelodyTranscription
  notes: ReviewNote[]
  bpm: number
  transpose: number
  excluded: ReadonlySet<number>
  onToggle: (index: number) => void
}) {
  const detected = transcription.notes
  const pitches = [...detected.map((n) => n.pitch + transpose), ...notes.map((n) => n.pitch)]
  if (pitches.length === 0) {
    return <p className="text-xs text-ink-faint">No notes were detected.</p>
  }
  const lo = Math.min(...pitches) - 2
  const hi = Math.max(...pitches) + 2
  const rowH = 160 / Math.max(12, hi - lo + 1)
  // Beat 0 is the first kept note (that is where quantized notes start).
  const t0 = detected[notes[0]?.sourceIndex ?? 0]?.start ?? 0
  const secondsPerBeat = 60 / bpm
  const beats = Math.max(4, ...notes.map((n) => n.startBeat + n.durationBeats)) + 0.5
  const w = 400
  const x = (beat: number) => (beat / beats) * w
  const y = (pitch: number) => (hi - pitch) * rowH
  const curve = transcription.curveTimes
    .map((t, i) => {
      const beat = (t - t0) / secondsPerBeat
      const m = transcription.curveMidi[i]! + transpose
      return beat >= 0 && beat <= beats
        ? `${x(beat).toFixed(1)},${(y(m) + rowH / 2).toFixed(1)}`
        : null
    })
    .filter(Boolean)

  return (
    <svg
      viewBox={`0 0 ${w} 160`}
      className="h-40 w-full rounded border border-line bg-surface-0"
      role="img"
      aria-label="Detected melody"
      data-testid="melody-review"
    >
      {Array.from({ length: Math.ceil(beats) }, (_, b) => (
        <line
          key={b}
          x1={x(b)}
          x2={x(b)}
          y1={0}
          y2={160}
          stroke="var(--color-line)"
          strokeWidth={b % 4 === 0 ? 1 : 0.4}
        />
      ))}
      {curve.length > 1 && (
        <polyline
          points={curve.join(' ')}
          fill="none"
          stroke="var(--color-ink-faint)"
          strokeWidth={1}
          opacity={0.7}
        />
      )}
      {[...excluded].map((i) => {
        const d = detected[i]
        if (!d) return null
        return (
          <rect
            key={`x${i}`}
            role="button"
            aria-label={`${noteName(d.pitch + transpose)}, left out`}
            x={x((d.start - t0) / secondsPerBeat)}
            y={y(d.pitch + transpose) + 0.5}
            width={Math.max(2, x((d.end - d.start) / secondsPerBeat) - 1)}
            height={Math.max(2, rowH - 1)}
            fill="none"
            stroke="var(--color-ink-faint)"
            strokeDasharray="1 2"
            className="cursor-pointer"
            onClick={() => onToggle(i)}
          >
            <title>Left out · click to bring back</title>
          </rect>
        )
      })}
      {notes.map((n) => {
        const low = (n.confidence ?? 1) < LOW_CONFIDENCE
        const index = n.sourceIndex
        return (
          <rect
            key={index}
            role="button"
            aria-label={`${noteName(n.pitch)}, ${Math.round((n.confidence ?? 1) * 100)}% confident`}
            x={x(n.startBeat)}
            y={y(n.pitch) + 0.5}
            width={Math.max(2, x(n.durationBeats) - 1)}
            height={Math.max(2, rowH - 1)}
            rx={1.5}
            fill={low ? 'var(--color-warn)' : 'var(--color-accent)'}
            fillOpacity={low ? 0.55 : 0.9}
            stroke={low ? 'var(--color-warn)' : 'none'}
            strokeDasharray={low ? '2 1.5' : undefined}
            className="cursor-pointer hover:opacity-70"
            onClick={() => onToggle(index)}
          >
            <title>
              {noteName(n.pitch)} · {Math.round((n.confidence ?? 1) * 100)}% confident · click to
              leave out
            </title>
          </rect>
        )
      })}
    </svg>
  )
}
