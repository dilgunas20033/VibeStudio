// Shared "record a take, upload it, analyse it" state for the Hum and Beatbox panels.
import { api } from '../api/client'
import {
  listInputDevices,
  startRecording,
  toMonoWav,
  type InputDevice,
  type Recording,
} from '../audio/recorder'
import type { AssetResponse } from '../types/api'
import type { AudioAsset } from '../types/project.generated'

export const MAX_TAKE_SECONDS = 60

export type TakeStatus = 'idle' | 'requesting' | 'recording' | 'processing' | 'review' | 'error'

export interface Take {
  url: string
  seconds: number
  peaks: number[]
  asset: AssetResponse
}

export interface RecorderSlice {
  status: TakeStatus
  /** What the processing step is doing, for the progress label. */
  step: string
  error: string | null
  devices: InputDevice[]
  deviceId: string | undefined
  elapsed: number
  level: number
  take: Take | null
  loadDevices: () => Promise<void>
  setDevice: (id: string | undefined) => void
  record: () => Promise<void>
  stop: () => Promise<void>
  retake: () => void
}

type Set<S> = (partial: Partial<S>) => void
type Get<S> = () => S

interface Options<S> {
  kind: AssetResponse['kind']
  /** Label for the progress step, e.g. "Detecting notes…". */
  analysingLabel: string
  /** Analyse the uploaded take; returns the state to merge in (status becomes 'review'). */
  analyse: (take: Take) => Promise<Partial<S>>
  /** Extra state to clear on retake. */
  reset: () => Partial<S>
  /** Called before a retake or a new recording (e.g. stop previews). */
  beforeReset?: () => void
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function createRecorderSlice<S extends RecorderSlice>(
  set: Set<S>,
  get: Get<S>,
  opts: Options<S>,
): RecorderSlice {
  // Per-store recording state (not in React state: it is not serialisable).
  let recording: Recording | null = null
  let meter = 0
  let autoStop: ReturnType<typeof setTimeout> | null = null
  const setS = set as Set<RecorderSlice>

  return {
    status: 'idle',
    step: '',
    error: null,
    devices: [],
    deviceId: undefined,
    elapsed: 0,
    level: 0,
    take: null,

    async loadDevices() {
      try {
        setS({ devices: await listInputDevices() })
      } catch {
        setS({ devices: [] })
      }
    },

    setDevice(deviceId) {
      setS({ deviceId })
    },

    async record() {
      get().retake()
      setS({ status: 'requesting', error: null })
      try {
        recording = await startRecording(get().deviceId)
      } catch (e) {
        setS({ status: 'error', error: message(e) })
        return
      }
      void get().loadDevices() // device labels become available once permission is granted
      const started = performance.now()
      setS({ status: 'recording', elapsed: 0 })
      const tick = () => {
        if (get().status !== 'recording' || !recording) return
        setS({ level: recording.level(), elapsed: (performance.now() - started) / 1000 })
        meter = requestAnimationFrame(tick)
      }
      meter = requestAnimationFrame(tick)
      autoStop = setTimeout(() => void get().stop(), MAX_TAKE_SECONDS * 1000)
    },

    async stop() {
      if (get().status !== 'recording' || !recording) return
      cancelAnimationFrame(meter)
      if (autoStop) clearTimeout(autoStop)
      const rec = recording
      recording = null
      setS({ status: 'processing', step: 'Preparing the take…', level: 0 })
      try {
        const raw = await rec.stop()
        const { wav, seconds, peaks } = await toMonoWav(raw)
        if (seconds < 0.5) throw new Error('The take is too short. Record for at least a second.')
        setS({ step: 'Uploading…' })
        const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-')
        const asset = await api.uploadAsset(wav, `${opts.kind}-${stamp}.wav`, opts.kind)
        const take = { url: URL.createObjectURL(wav), seconds, peaks, asset }
        setS({ take, step: opts.analysingLabel })
        const result = await opts.analyse(take)
        set({ ...result, status: 'review', step: '' } as Partial<S>)
      } catch (e) {
        console.error(`[${opts.kind}] processing failed`, e)
        setS({ status: 'error', step: '', error: message(e) })
      }
    },

    retake() {
      opts.beforeReset?.()
      recording?.cancel()
      recording = null
      cancelAnimationFrame(meter)
      if (autoStop) clearTimeout(autoStop)
      const take = get().take
      if (take) URL.revokeObjectURL(take.url)
      set({
        ...opts.reset(),
        status: 'idle',
        take: null,
        error: null,
        elapsed: 0,
        level: 0,
      } as Partial<S>)
    },
  }
}

/** The project-document reference to a take's stored recording. */
export function assetForTake(take: Take): AudioAsset {
  const a = take.asset
  return {
    id: a.id,
    name: a.name,
    uri: a.uri,
    sha256: a.sha256,
    sampleRate: a.sampleRate,
    channels: a.channels,
    durationSeconds: a.durationSeconds,
  }
}
