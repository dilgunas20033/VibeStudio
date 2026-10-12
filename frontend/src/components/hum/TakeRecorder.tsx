import { useEffect } from 'react'
import type { StoreApi, UseBoundStore } from 'zustand'
import { MAX_TAKE_SECONDS, type RecorderSlice } from '../../store/recorderSlice'
import { Select } from '../ui'

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Record button, timer, input meter and microphone picker for any take-recording store. */
export function TakeRecorder({ store }: { store: UseBoundStore<StoreApi<RecorderSlice>> }) {
  const status = store((s) => s.status)
  const step = store((s) => s.step)
  const devices = store((s) => s.devices)
  const deviceId = store((s) => s.deviceId)
  const elapsed = store((s) => s.elapsed)
  const level = store((s) => s.level)
  const { loadDevices, setDevice, record, stop } = store.getState()
  const recording = status === 'recording'
  const busy = status === 'requesting' || status === 'processing'

  useEffect(() => {
    void loadDevices()
  }, [loadDevices])

  return (
    <div className="flex flex-col gap-2">
      {devices.length > 1 && (
        <Select
          aria-label="Microphone"
          value={deviceId ?? ''}
          disabled={recording || busy}
          onChange={(e) => setDevice(e.target.value || undefined)}
        >
          <option value="">Default microphone</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </Select>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void (recording ? stop() : record())}
          disabled={busy}
          aria-label={recording ? 'Stop recording' : 'Record'}
          className={`flex h-9 items-center gap-2 rounded-md px-3 text-xs font-semibold text-white disabled:opacity-60 ${
            recording ? 'bg-danger hover:bg-danger/80' : 'bg-danger/80 hover:bg-danger'
          }`}
        >
          <span
            className={`h-2.5 w-2.5 ${recording ? 'rounded-[2px] bg-white' : 'animate-none rounded-full bg-white'}`}
            aria-hidden
          />
          {recording ? 'Stop' : status === 'requesting' ? 'Allow the microphone…' : 'Record'}
        </button>
        <span className="font-mono text-xs text-ink-dim tabular-nums" aria-label="Recording time">
          {fmt(elapsed)} / {fmt(MAX_TAKE_SECONDS)}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-0"
        role="meter"
        aria-label="Input level"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(level.toFixed(2))}
      >
        <div
          className={`h-full transition-[width] duration-75 ${level > 0.95 ? 'bg-danger' : 'bg-ok'}`}
          style={{ width: `${Math.round(level * 100)}%` }}
        />
      </div>
      {busy && (
        <p className="text-[11px] text-ink-dim" role="status">
          {status === 'processing' ? step : 'Waiting for microphone permission…'}
        </p>
      )}
      {recording && level > 0.95 && (
        <p className="text-[11px] text-danger">Too loud: move back from the microphone.</p>
      )}
    </div>
  )
}
