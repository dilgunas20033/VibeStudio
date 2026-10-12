import { readFileSync } from 'node:fs'

export interface WavInfo {
  channels: number
  sampleRate: number
  seconds: number
  /** Peak absolute sample, 0..1. */
  peak: number
  /** RMS level across all samples, 0..1. */
  rms: number
}

/** Parse a 16-bit PCM WAV file as written by src/audio/wav.ts. */
export function readWav(path: string): WavInfo {
  const buf = readFileSync(path)
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a WAV file')
  }
  const channels = buf.readUInt16LE(22)
  const sampleRate = buf.readUInt32LE(24)
  const bits = buf.readUInt16LE(34)
  if (bits !== 16) throw new Error(`expected 16-bit PCM, got ${bits}`)
  const dataSize = buf.readUInt32LE(40)
  const samples = dataSize / 2
  let peak = 0
  let sumSq = 0
  for (let i = 0; i < samples; i++) {
    const s = buf.readInt16LE(44 + i * 2) / 32768
    peak = Math.max(peak, Math.abs(s))
    sumSq += s * s
  }
  return {
    channels,
    sampleRate,
    seconds: samples / channels / sampleRate,
    peak,
    rms: Math.sqrt(sumSq / samples),
  }
}
