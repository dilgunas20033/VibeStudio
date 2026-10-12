/** Static waveform of a take, drawn from precomputed peaks (0..1). */
export function Waveform({ peaks, seconds }: { peaks: number[]; seconds: number }) {
  const w = 400
  const h = 48
  const step = w / Math.max(1, peaks.length)
  const bars = peaks
    .map((p, i) => {
      const y = Math.max(0.5, p * (h / 2 - 1))
      return `M${(i * step).toFixed(1)} ${(h / 2 - y).toFixed(1)}V${(h / 2 + y).toFixed(1)}`
    })
    .join('')
  return (
    <figure className="m-0" aria-label={`Recorded take, ${seconds.toFixed(1)} seconds`}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="h-12 w-full rounded bg-surface-0"
        data-testid="take-waveform"
      >
        <path d={bars} stroke="var(--color-accent)" strokeWidth={Math.max(1, step * 0.7)} />
      </svg>
    </figure>
  )
}
