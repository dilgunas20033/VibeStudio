// Microphone recording with the browser's MediaRecorder, plus conversion to a mono WAV
// for upload. Uses plain Web Audio (not Tone.js) so it never touches the playback graph.
import { encodeWav } from './wav'

export interface InputDevice {
  deviceId: string
  label: string
}

export class MicrophoneError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MicrophoneError'
  }
}

export async function listInputDevices(): Promise<InputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
}

export interface Recording {
  /** 0..1 input level, for a meter. Call every animation frame. */
  level(): number
  /** Stop and return the recorded audio. */
  stop(): Promise<Blob>
  /** Stop and discard. */
  cancel(): void
}

function describe(e: unknown): string {
  const name = e instanceof DOMException ? e.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Microphone access was blocked. Allow it in the browser’s site settings and try again.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'No microphone was found. Connect one or pick another input.'
  if (name === 'NotReadableError') return 'The microphone is in use by another application.'
  return `Could not start recording: ${e instanceof Error ? e.message : String(e)}`
}

export async function startRecording(deviceId?: string): Promise<Recording> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new MicrophoneError('This browser cannot record audio.')
  }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        // Pitch detection wants the raw voice: no processing that changes the signal.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
  } catch (e) {
    throw new MicrophoneError(describe(e))
  }

  const ctx = new AudioContext()
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  source.connect(analyser)
  const buf = new Float32Array(analyser.fftSize)

  const recorder = new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data)
  recorder.start(250)

  const release = () => {
    stream.getTracks().forEach((t) => t.stop())
    source.disconnect()
    void ctx.close()
  }

  return {
    level() {
      analyser.getFloatTimeDomainData(buf)
      let peak = 0
      for (const s of buf) peak = Math.max(peak, Math.abs(s))
      return Math.min(1, peak)
    },
    stop() {
      return new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          release()
          resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
        }
        recorder.stop()
      })
    },
    cancel() {
      recorder.onstop = release
      if (recorder.state !== 'inactive') recorder.stop()
      else release()
    },
  }
}

/** Decode any browser-recorded audio and return a mono 16-bit WAV at `sampleRate`. */
export async function toMonoWav(
  blob: Blob,
  sampleRate = 22_050,
): Promise<{
  wav: Blob
  seconds: number
  peaks: number[]
}> {
  const data = await blob.arrayBuffer()
  const decodeCtx = new OfflineAudioContext(1, 1, 44_100)
  const decoded = await decodeCtx.decodeAudioData(data)
  const length = Math.max(1, Math.ceil(decoded.duration * sampleRate))
  const offline = new OfflineAudioContext(1, length, sampleRate)
  const src = offline.createBufferSource()
  src.buffer = decoded
  src.connect(offline.destination) // downmixes to mono and resamples
  src.start()
  const mono = await offline.startRendering()
  return {
    wav: new Blob([encodeWav(mono)], { type: 'audio/wav' }),
    seconds: mono.duration,
    peaks: peaksOf(mono.getChannelData(0), 400),
  }
}

/** Downsampled absolute peaks (0..1) for drawing a waveform. */
export function peaksOf(samples: Float32Array, buckets: number): number[] {
  const size = Math.max(1, Math.floor(samples.length / buckets))
  const out: number[] = []
  for (let i = 0; i < samples.length; i += size) {
    let peak = 0
    const end = Math.min(samples.length, i + size)
    for (let j = i; j < end; j++) peak = Math.max(peak, Math.abs(samples[j]!))
    out.push(peak)
  }
  return out
}
