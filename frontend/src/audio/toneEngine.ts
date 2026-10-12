import * as Tone from 'tone'
import { beatsPerBar, loopLengthBeats } from '../project/music'
import type { ProjectDocument } from '../types/project.generated'
import { ProjectGraph } from './graph'
import { createVoice, type Voice } from './instruments'
import type { AudioEngine, PreviewHit, PreviewNote, TransportStatus } from './types'

/** Live browser playback on the main AudioContext. */
export class ToneAudioEngine implements AudioEngine {
  private readonly transport = Tone.getTransport()
  private graph: ProjectGraph | null = null
  private metronome: { synth: Tone.Synth; loop: Tone.Loop; volume: Tone.Volume } | null = null
  private perBar = 4
  private preview_: { voice: Voice; timer: ReturnType<typeof setTimeout> } | null = null

  constructor() {
    this.transport.loop = true
    // Schedule slightly ahead for stable timing; UI latency is not critical here.
    Tone.getContext().lookAhead = 0.08
  }

  async unlock(): Promise<void> {
    if (Tone.getContext().state !== 'running') {
      await Tone.start()
      console.info('[audio] context started', Tone.getContext().sampleRate, 'Hz')
    }
  }

  sync(doc: ProjectDocument): void {
    this.graph ??= new ProjectGraph()
    this.graph.sync(doc)
    this.transport.bpm.value = doc.bpm
    this.transport.timeSignature = [doc.timeSignature.numerator, doc.timeSignature.denominator]
    this.perBar = beatsPerBar(doc.timeSignature)
    const end = loopLengthBeats(doc)
    this.transport.loopStart = 0
    this.transport.loopEnd = `${Math.round(end * this.transport.PPQ)}i`
    if (this.position() >= end) this.seek(0)
  }

  clear(): void {
    this.stop()
    this.graph?.dispose()
    this.graph = null
  }

  play(): void {
    this.transport.start('+0.05')
  }

  pause(): void {
    this.transport.pause()
    this.graph?.silence()
  }

  stop(): void {
    this.transport.stop()
    this.transport.ticks = 0
    this.graph?.silence()
  }

  seek(beat: number): void {
    this.transport.ticks = Math.max(0, Math.round(beat * this.transport.PPQ))
  }

  position(): number {
    return this.transport.ticks / this.transport.PPQ
  }

  status(): TransportStatus {
    return this.transport.state === 'started' ? 'playing' : this.transport.state
  }

  setLoop(enabled: boolean): void {
    this.transport.loop = enabled
  }

  setMetronome(enabled: boolean): void {
    if (enabled && !this.metronome) {
      const volume = new Tone.Volume(-10).toDestination()
      const synth = new Tone.Synth({
        oscillator: { type: 'square' },
        envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.01 },
      }).connect(volume)
      const loop = new Tone.Loop((time) => {
        const beat = Math.round(this.transport.getTicksAtTime(time) / this.transport.PPQ)
        synth.triggerAttackRelease(beat % this.perBar === 0 ? 'C6' : 'G5', 0.03, time)
      }, '4n').start(0)
      this.metronome = { synth, loop, volume }
    } else if (!enabled && this.metronome) {
      this.metronome.loop.dispose()
      this.metronome.synth.dispose()
      this.metronome.volume.dispose()
      this.metronome = null
    }
  }

  preview(trackId: string, pitch: number): void {
    this.graph?.preview(trackId, pitch)
  }

  previewNotes(notes: PreviewNote[], bpm: number, preset: string): number {
    this.stopPreview()
    const voice = createVoice({ type: 'synth', preset, params: {} })
    voice.output.toDestination()
    const spb = 60 / bpm
    const t0 = Tone.now() + 0.1
    for (const n of notes) {
      voice.trigger(n.pitch, n.durationBeats * spb, t0 + n.startBeat * spb, n.velocity / 127)
    }
    const seconds = Math.max(0, ...notes.map((n) => (n.startBeat + n.durationBeats) * spb)) + 0.5
    // Dispose after the release tail so preview voices don't accumulate.
    const timer = setTimeout(() => this.stopPreview(), (seconds + 1.5) * 1000)
    this.preview_ = { voice, timer }
    return seconds
  }

  previewDrums(hits: PreviewHit[], bpm: number): number {
    this.stopPreview()
    const voices = new Map<string, Voice>()
    for (const drum of new Set(hits.map((h) => h.drum))) {
      const v = createVoice({ type: 'drum', preset: drum, params: {} })
      v.output.toDestination()
      voices.set(drum, v)
    }
    const spb = 60 / bpm
    const t0 = Tone.now() + 0.1
    for (const h of hits) {
      try {
        voices.get(h.drum)!.trigger(36, 0.2, t0 + h.startBeat * spb, h.velocity / 127)
      } catch {
        // Monophonic drum voices reject two hits at the same instant; skip the duplicate.
      }
    }
    const seconds = Math.max(0, ...hits.map((h) => h.startBeat * spb)) + 0.8
    const kit: Voice = {
      output: [...voices.values()][0]!.output,
      trigger: () => {},
      silence: () => voices.forEach((v) => v.silence()),
      dispose: () => voices.forEach((v) => v.dispose()),
    }
    const timer = setTimeout(() => this.stopPreview(), (seconds + 1.5) * 1000)
    this.preview_ = { voice: kit, timer }
    return seconds
  }

  stopPreview(): void {
    if (!this.preview_) return
    clearTimeout(this.preview_.timer)
    this.preview_.voice.silence()
    this.preview_.voice.dispose()
    this.preview_ = null
  }

  info(): { state: string; sampleRate: number } {
    const ctx = Tone.getContext()
    return { state: ctx.state, sampleRate: ctx.sampleRate }
  }

  dispose(): void {
    this.stopPreview()
    this.clear()
    this.setMetronome(false)
  }
}
