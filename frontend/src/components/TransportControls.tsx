import { isSingleLoop, setLoopBars } from '../project/edit'
import { beatsPerBar, formatPosition, loopLengthBeats } from '../project/music'
import { BPM_MAX, BPM_MIN } from '../lib/tempo'
import { useProjectStore } from '../store/projectStore'
import { useTransportStore } from '../store/transportStore'
import { NumberInput, Select } from './ui'

const LOOP_BARS = [1, 2, 4, 8, 16]

function Toggle({
  on,
  label,
  onClick,
  children,
}: {
  on: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={onClick}
      className={`h-7 rounded-md border px-2 text-xs font-medium ${
        on
          ? 'border-accent/60 bg-accent/20 text-accent-strong'
          : 'border-line bg-surface-2 text-ink-dim hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

function Position() {
  const beat = useTransportStore((s) => s.beat)
  const ts = useProjectStore((s) => s.current?.document.timeSignature)
  if (!ts) return null
  return (
    <output
      aria-label="Playhead position"
      className="w-20 rounded-md border border-line bg-surface-0 px-2 py-1 text-center font-mono text-sm text-ok tabular-nums"
    >
      {formatPosition(beat, ts)}
    </output>
  )
}

export function TransportControls() {
  const doc = useProjectStore((s) => s.current?.document)
  const update = useProjectStore((s) => s.updateDocument)
  // Select fields individually: the store's `beat` changes every frame during playback.
  const status = useTransportStore((s) => s.status)
  const starting = useTransportStore((s) => s.starting)
  const loop = useTransportStore((s) => s.loop)
  const metronome = useTransportStore((s) => s.metronome)
  const togglePlay = useTransportStore((s) => s.togglePlay)
  const stop = useTransportStore((s) => s.stop)
  const setLoop = useTransportStore((s) => s.setLoop)
  const setMetronome = useTransportStore((s) => s.setMetronome)

  if (!doc) return null
  const playing = status === 'playing'
  const loopBars = Math.round(loopLengthBeats(doc) / beatsPerBar(doc.timeSignature))

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label={playing ? 'Pause' : 'Play'}
        title={`${playing ? 'Pause' : 'Play'} (Space)`}
        disabled={starting}
        onClick={() => void togglePlay()}
        className={`flex h-8 w-9 items-center justify-center rounded-md text-white ${
          playing ? 'bg-ok/80 hover:bg-ok' : 'bg-accent hover:bg-accent-strong'
        } disabled:opacity-60`}
      >
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <rect x="2" y="1" width="3" height="10" fill="currentColor" />
            <rect x="7" y="1" width="3" height="10" fill="currentColor" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M2 1 L11 6 L2 11 Z" fill="currentColor" />
          </svg>
        )}
      </button>
      <button
        type="button"
        aria-label="Stop"
        title="Stop and return to start"
        onClick={stop}
        className="flex h-8 w-9 items-center justify-center rounded-md border border-line bg-surface-2 text-ink-dim hover:text-ink"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <rect width="10" height="10" fill="currentColor" />
        </svg>
      </button>
      <Position />
      <label className="flex items-center gap-1.5 text-[11px] text-ink-dim">
        BPM
        <NumberInput
          aria-label="Tempo"
          className="w-16 font-mono"
          min={BPM_MIN}
          max={BPM_MAX}
          value={doc.bpm}
          onCommit={(bpm) => update((d) => ({ ...d, bpm }))}
        />
      </label>
      {isSingleLoop(doc) ? (
        <label className="flex items-center gap-1.5 text-[11px] text-ink-dim">
          Bars
          <Select
            aria-label="Loop length in bars"
            className="w-16"
            value={loopBars}
            onChange={(e) => update((d) => setLoopBars(d, Number(e.target.value)))}
          >
            {[...new Set([...LOOP_BARS, loopBars])]
              .sort((a, b) => a - b)
              .map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
          </Select>
        </label>
      ) : (
        <span className="text-[11px] text-ink-dim" title="Song length (end of the last clip)">
          Song <span className="font-mono text-ink">{loopBars}</span> bars
        </span>
      )}
      <Toggle on={loop} label="Loop playback" onClick={() => setLoop(!loop)}>
        Loop
      </Toggle>
      <Toggle on={metronome} label="Metronome" onClick={() => void setMetronome(!metronome)}>
        Click
      </Toggle>
    </div>
  )
}
