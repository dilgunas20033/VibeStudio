import { useTransportStore } from '../store/transportStore'

/** Vertical playhead line. Isolated so only it re-renders on every animation frame. */
export function Playhead({
  pxPerBeat,
  offsetPx = 0,
  wrapBeats,
  originBeat = 0,
  endBeat,
}: {
  pxPerBeat: number
  offsetPx?: number
  /** Show position inside a looping pattern of this length. */
  wrapBeats?: number
  /** Timeline beat where the edited clip starts; the line hides outside [origin, end). */
  originBeat?: number
  endBeat?: number
}) {
  const beat = useTransportStore((s) => s.beat)
  const status = useTransportStore((s) => s.status)
  if (status === 'stopped' && beat === 0) return null
  if (beat < originBeat || (endBeat !== undefined && beat >= endBeat)) return null
  const local = beat - originBeat
  const b = wrapBeats ? local % wrapBeats : local
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-ok shadow-[0_0_6px] shadow-ok"
      style={{ transform: `translateX(${offsetPx + b * pxPerBeat}px)` }}
    />
  )
}
