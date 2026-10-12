import { useState } from 'react'
import { removeTrack, setMixer } from '../project/edit'
import type { Track } from '../types/project.generated'
import { useProjectStore } from '../store/projectStore'
import { useUiStore } from '../store/uiStore'

const VOLUME_MIN_DB = -60
const VOLUME_MAX_DB = 6

function SmallToggle({
  on,
  label,
  activeClass,
  onClick,
  children,
}: {
  on: boolean
  label: string
  activeClass: string
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`h-5 w-5 rounded text-[10px] font-bold ${
        on ? activeClass : 'bg-surface-3 text-ink-faint hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

export function TrackHeader({ track }: { track: Track }) {
  const update = useProjectStore((s) => s.updateDocument)
  const selected = useUiStore((s) => s.selectedTrackId === track.id)
  const selectTrack = useUiStore((s) => s.selectTrack)
  const [confirming, setConfirming] = useState(false)
  const mix = (change: Parameters<typeof setMixer>[2]) =>
    update((d) => setMixer(d, track.id, change))

  return (
    <div
      onClick={() => selectTrack(track.id, track.kind === 'drums' ? 'rack' : 'piano')}
      className={`flex h-full cursor-pointer items-center gap-2 border-r border-line px-2 ${
        selected ? 'bg-surface-3' : 'bg-surface-2 hover:bg-surface-3/60'
      }`}
      data-testid={`track-${track.name}`}
    >
      <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: track.color }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium">{track.name}</div>
        <input
          type="range"
          aria-label={`${track.name} volume`}
          title={`${track.mixer.volumeDb.toFixed(1)} dB`}
          min={VOLUME_MIN_DB}
          max={VOLUME_MAX_DB}
          step={0.5}
          value={Math.max(VOLUME_MIN_DB, track.mixer.volumeDb)}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => mix({ volumeDb: Number(e.target.value) })}
          className="h-1 w-full accent-accent"
        />
      </div>
      <div className="flex shrink-0 gap-1">
        <SmallToggle
          on={track.mixer.mute}
          label={`Mute ${track.name}`}
          activeClass="bg-warn text-surface-0"
          onClick={() => mix({ mute: !track.mixer.mute })}
        >
          M
        </SmallToggle>
        <SmallToggle
          on={track.mixer.solo}
          label={`Solo ${track.name}`}
          activeClass="bg-ok text-surface-0"
          onClick={() => mix({ solo: !track.mixer.solo })}
        >
          S
        </SmallToggle>
        {confirming ? (
          <button
            type="button"
            className="h-5 rounded bg-danger px-1 text-[10px] font-bold text-white"
            onClick={(e) => {
              e.stopPropagation()
              update((d) => removeTrack(d, track.id))
            }}
            onBlur={() => setConfirming(false)}
            autoFocus
          >
            Delete?
          </button>
        ) : (
          <SmallToggle
            on={false}
            label={`Delete ${track.name}`}
            activeClass=""
            onClick={() => setConfirming(true)}
          >
            ✕
          </SmallToggle>
        )}
      </div>
    </div>
  )
}
