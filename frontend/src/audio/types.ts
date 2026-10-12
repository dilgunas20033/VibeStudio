import type { ProjectDocument } from '../types/project.generated'

export type TransportStatus = 'stopped' | 'playing' | 'paused'

export interface PreviewHit {
  startBeat: number
  drum: string
  velocity: number
}

export interface PreviewNote {
  startBeat: number
  durationBeats: number
  pitch: number
  velocity: number
}

/**
 * What the UI needs from an audio engine. The browser implementation uses Tone.js;
 * a native engine for the desktop app can implement the same interface later.
 */
export interface AudioEngine {
  /** Resume the AudioContext. Must be called from a user gesture the first time. */
  unlock(): Promise<void>
  /** Apply the current project. Safe to call on every edit, including during playback. */
  sync(doc: ProjectDocument): void
  /** Remove all project audio (project closed). */
  clear(): void
  play(): void
  pause(): void
  stop(): void
  seek(beat: number): void
  /** Current playhead position in beats. */
  position(): number
  status(): TransportStatus
  setLoop(enabled: boolean): void
  setMetronome(enabled: boolean): void
  preview(trackId: string, pitch: number): void
  /**
   * Play a note list on a synth preset, outside the project (e.g. a transcribed hum).
   * Returns the preview length in seconds. Starting a new preview stops the previous one.
   */
  previewNotes(notes: PreviewNote[], bpm: number, preset: string): number
  /** Play drum hits, each on its own kit sound. Returns the length in seconds. */
  previewDrums(hits: PreviewHit[], bpm: number): number
  stopPreview(): void
  /** AudioContext state and sample rate, for display. */
  info(): { state: string; sampleRate: number }
  dispose(): void
}
