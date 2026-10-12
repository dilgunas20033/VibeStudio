import { useProjectStore } from '../store/projectStore'
import { useTransportStore } from '../store/transportStore'

export function StatusBar() {
  const health = useProjectStore((s) => s.health)
  const healthError = useProjectStore((s) => s.healthError)
  const current = useProjectStore((s) => s.current)
  const audio = useTransportStore((s) => s.audio)

  const connected = health?.status === 'ok'
  const label = health
    ? `Backend ${health.status} · API v${health.version} · schema v${health.projectSchemaVersion}`
    : (healthError ?? 'Connecting to backend…')

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-line bg-surface-1 px-3 text-[11px] text-ink-faint">
      <span className="flex items-center gap-1.5" data-testid="backend-status">
        <span
          className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-ok' : health ? 'bg-warn' : 'bg-danger'}`}
          aria-hidden
        />
        {label}
      </span>
      <span data-testid="audio-status" className="ml-auto">
        {audio
          ? `Audio ${audio.state} · ${(audio.sampleRate / 1000).toFixed(1)} kHz`
          : 'Audio starts when you press Play'}
      </span>
      {current && <span className="font-mono">revision {current.revision}</span>}
    </footer>
  )
}
