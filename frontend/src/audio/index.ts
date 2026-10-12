// Entry point for audio. Tone.js is loaded lazily on first use (Play, preview or
// export), which keeps the initial bundle small and keeps Web Audio out of tests
// that don't need it.
import type { AudioEngine } from './types'

let engine: AudioEngine | null = null
let loading: Promise<AudioEngine> | null = null

export function getEngine(): Promise<AudioEngine> {
  loading ??= import('./toneEngine').then((m) => {
    engine = new m.ToneAudioEngine()
    return engine
  })
  return loading
}

/** The engine if it has already been loaded, otherwise null. Never triggers loading. */
export function peekEngine(): AudioEngine | null {
  return engine
}

export async function renderLoopWav(...args: Parameters<typeof import('./render').renderLoopWav>) {
  const m = await import('./render')
  return m.renderLoopWav(...args)
}

export type { AudioEngine, PreviewHit, PreviewNote, TransportStatus } from './types'
