/** Minimal view of an AudioBuffer, so encoding is testable without Web Audio. */
export interface PcmSource {
  numberOfChannels: number
  sampleRate: number
  length: number
  getChannelData(channel: number): Float32Array
}

/** Encode audio as a 16-bit PCM WAV file. Samples are clipped to [-1, 1]. */
export function encodeWav(source: PcmSource): ArrayBuffer {
  const channels = source.numberOfChannels
  const frames = source.length
  const bytesPerSample = 2
  const dataSize = frames * channels * bytesPerSample
  const buf = new ArrayBuffer(44 + dataSize)
  const v = new DataView(buf)
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i))
  }

  ascii(0, 'RIFF')
  v.setUint32(4, 36 + dataSize, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  v.setUint32(16, 16, true) // fmt chunk size
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, channels, true)
  v.setUint32(24, source.sampleRate, true)
  v.setUint32(28, source.sampleRate * channels * bytesPerSample, true)
  v.setUint16(32, channels * bytesPerSample, true)
  v.setUint16(34, 16, true)
  ascii(36, 'data')
  v.setUint32(40, dataSize, true)

  const data = Array.from({ length: channels }, (_, c) => source.getChannelData(c))
  let offset = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, data[c]![i]!))
      v.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      offset += 2
    }
  }
  return buf
}

/** Peak absolute sample value across channels. Used for clip and silence checks. */
export function peak(source: PcmSource): number {
  let max = 0
  for (let c = 0; c < source.numberOfChannels; c++) {
    for (const s of source.getChannelData(c)) max = Math.max(max, Math.abs(s))
  }
  return max
}
