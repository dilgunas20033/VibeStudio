import { patternBarsFor, type ClassChoice, type DrumBeatHit } from '../../project/drums'
import { CLASS_COLORS } from './classStyle'

const ROWS: { drum: DrumBeatHit['drum']; label: string }[] = [
  { drum: 'kick', label: 'Kick' },
  { drum: 'snare', label: 'Snare' },
  { drum: 'clap', label: 'Clap' },
  { drum: 'hihat', label: 'Hi-hat' },
  { drum: 'openhat', label: 'Open hat' },
  { drum: 'perc', label: 'Perc' },
]

/** The quantized pattern as a step grid (sixteenths), one row per kit sound. */
export function DrumGridPreview({ hits }: { hits: DrumBeatHit[] }) {
  const bars = patternBarsFor(hits)
  const steps = bars * 16
  const used = ROWS.filter((r) => hits.some((h) => h.drum === r.drum))
  if (!used.length) return <p className="text-xs text-ink-faint">No hits to show.</p>
  const at = new Map(hits.map((h) => [`${h.drum}@${Math.round(h.startBeat * 4)}`, h]))
  return (
    <div className="overflow-x-auto" aria-label="Drum pattern preview" data-testid="drum-grid">
      <table className="border-separate border-spacing-[1px] text-[10px]">
        <tbody>
          {used.map((row) => (
            <tr key={row.drum}>
              <th
                scope="row"
                className="pr-1.5 text-left font-medium whitespace-nowrap text-ink-dim"
              >
                {row.label}
              </th>
              {Array.from({ length: steps }, (_, s) => {
                const hit = at.get(`${row.drum}@${s}`)
                return (
                  <td
                    key={s}
                    aria-label={hit ? `${row.label} on step ${s + 1}` : undefined}
                    className={`h-3 w-2.5 rounded-[1px] ${s % 4 === 0 ? 'bg-surface-3' : 'bg-surface-2'} ${s % 16 === 0 && s ? 'border-l border-ink-faint/40' : ''}`}
                    style={
                      hit
                        ? {
                            background: CLASS_COLORS[row.drum as ClassChoice],
                            opacity: 0.45 + 0.55 * (hit.velocity / 127),
                          }
                        : undefined
                    }
                  />
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
