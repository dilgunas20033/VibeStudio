import { effectiveClass, type ClassChoice, type DetectedDrum } from '../../project/drums'
import type { BeatboxTranscription } from '../../types/api'
import { CLASS_COLORS, CLASS_LETTER } from './classStyle'

/**
 * The take's waveform with a marker per detected hit. Click a marker to change its class
 * (kick → snare → clap → hi-hat → open hat → perc → ignore). Uncertain hits are dashed.
 */
export function HitStrip({
  transcription,
  peaks,
  seconds,
  overrides,
  mapping,
  onCycle,
}: {
  transcription: BeatboxTranscription
  peaks: number[]
  seconds: number
  overrides: ReadonlyMap<number, ClassChoice>
  mapping: Record<DetectedDrum, ClassChoice>
  onCycle: (index: number) => void
}) {
  const w = 400
  const h = 64
  const step = w / Math.max(1, peaks.length)
  const wave = peaks
    .map((p, i) => {
      const y = Math.max(0.5, p * (h / 2 - 8))
      return `M${(i * step).toFixed(1)} ${(h / 2 - y).toFixed(1)}V${(h / 2 + y).toFixed(1)}`
    })
    .join('')
  const x = (t: number) => (t / Math.max(seconds, 0.001)) * w

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-16 w-full rounded bg-surface-0"
      role="group"
      aria-label="Detected hits"
      data-testid="hit-strip"
    >
      <path d={wave} stroke="var(--color-line)" strokeWidth={Math.max(1, step * 0.7)} />
      {transcription.hits.map((hit, i) => {
        const cls = effectiveClass(hit, i, { overrides, mapping })
        const uncertain = hit.confidence < 0.5 && !overrides.has(i)
        return (
          <g
            key={i}
            role="button"
            aria-label={`Hit ${i + 1}: ${cls}${overrides.has(i) ? ' (corrected)' : ''}, ${Math.round(hit.confidence * 100)}% confident`}
            className="cursor-pointer"
            onClick={() => onCycle(i)}
          >
            <line
              x1={x(hit.time)}
              x2={x(hit.time)}
              y1={14}
              y2={h}
              stroke={CLASS_COLORS[cls]}
              strokeWidth={1.5}
              strokeDasharray={uncertain ? '2 2' : undefined}
              opacity={cls === 'ignore' ? 0.5 : 1}
            />
            <circle
              cx={x(hit.time)}
              cy={8}
              r={6.5}
              fill={CLASS_COLORS[cls]}
              opacity={cls === 'ignore' ? 0.5 : 1}
            />
            <text
              x={x(hit.time)}
              y={11}
              textAnchor="middle"
              fontSize={8}
              fontWeight={700}
              fill="#0d0e12"
              pointerEvents="none"
            >
              {CLASS_LETTER[cls]}
            </text>
            <title>
              {cls} · {Math.round(hit.confidence * 100)}% confident · click to change
            </title>
          </g>
        )
      })}
    </svg>
  )
}
