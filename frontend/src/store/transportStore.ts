import { create } from 'zustand'
import { getEngine, peekEngine, type AudioEngine, type TransportStatus } from '../audio'
import { loopLengthBeats } from '../project/music'
import { useProjectStore } from './projectStore'

interface TransportState {
  status: TransportStatus
  /** Playhead in beats, updated every animation frame while playing. */
  beat: number
  loop: boolean
  metronome: boolean
  /** Set while Tone.js is being loaded and the AudioContext started. */
  starting: boolean
  error: string | null
  /** AudioContext state once loaded, e.g. 'running'. Null until first use. */
  audio: { state: string; sampleRate: number } | null

  play: () => Promise<void>
  pause: () => void
  stop: () => void
  togglePlay: () => Promise<void>
  seek: (beat: number) => void
  setLoop: (on: boolean) => void
  setMetronome: (on: boolean) => Promise<void>
  /** Load and start the audio engine (call from a user gesture) and report its state. */
  ensureAudio: () => Promise<AudioEngine>
  /** Audition a note on a track. Loads the engine if needed (call from a user gesture). */
  preview: (trackId: string, pitch: number) => Promise<void>
}

let frame = 0

export const useTransportStore = create<TransportState>()((set, get) => {
  function tick() {
    const engine = peekEngine()
    if (!engine) return
    const beat = engine.position()
    const doc = useProjectStore.getState().current?.document
    if (!get().loop && doc && beat >= loopLengthBeats(doc)) {
      get().stop()
      return
    }
    // The store owns the playing state. The engine starts a few ms in the future, so
    // its own status can still read 'stopped' on the first frames after Play.
    set({ beat })
    if (get().status === 'playing') frame = requestAnimationFrame(tick)
  }

  /** Load and unlock the engine and give it the current document. */
  async function ready() {
    const engine = await getEngine()
    await engine.unlock()
    const doc = useProjectStore.getState().current?.document
    if (doc) engine.sync(doc)
    engine.setLoop(get().loop)
    set({ audio: engine.info() })
    return engine
  }

  return {
    status: 'stopped',
    beat: 0,
    loop: true,
    metronome: false,
    starting: false,
    error: null,
    audio: null,

    async play() {
      if (!useProjectStore.getState().current) return
      set({ starting: true, error: null })
      try {
        const engine = await ready()
        engine.play()
        set({ status: 'playing' })
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(tick)
      } catch (e) {
        console.error('[audio] could not start playback', e)
        set({ error: `Audio could not start: ${e instanceof Error ? e.message : String(e)}` })
      } finally {
        set({ starting: false })
      }
    },

    pause() {
      peekEngine()?.pause()
      cancelAnimationFrame(frame)
      set({ status: 'paused' })
    },

    stop() {
      peekEngine()?.stop()
      cancelAnimationFrame(frame)
      set({ status: 'stopped', beat: 0 })
    },

    async togglePlay() {
      if (get().status === 'playing') get().pause()
      else await get().play()
    },

    seek(beat) {
      const b = Math.max(0, beat)
      peekEngine()?.seek(b)
      set({ beat: b })
    },

    setLoop(on) {
      peekEngine()?.setLoop(on)
      set({ loop: on })
    },

    async setMetronome(on) {
      set({ metronome: on })
      const engine = on ? await getEngine() : peekEngine()
      engine?.setMetronome(on)
    },

    ensureAudio: ready,

    async preview(trackId, pitch) {
      try {
        const engine = await ready()
        engine.preview(trackId, pitch)
      } catch (e) {
        console.warn('[audio] preview failed', e)
      }
    },
  }
})
