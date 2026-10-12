import { describe, expect, it } from 'vitest'
import { encodeWav, peak, type PcmSource } from './wav'

function source(channels: number[][], sampleRate = 44_100): PcmSource {
  return {
    numberOfChannels: channels.length,
    sampleRate,
    length: channels[0]!.length,
    getChannelData: (c) => Float32Array.from(channels[c]!),
  }
}

describe('encodeWav', () => {
  it('writes a valid 16-bit stereo PCM header', () => {
    const wav = new DataView(
      encodeWav(
        source([
          [0, 0.5],
          [0, -0.5],
        ]),
      ),
    )
    const text = (o: number, n: number) =>
      String.fromCharCode(...Array.from({ length: n }, (_, i) => wav.getUint8(o + i)))
    expect(text(0, 4)).toBe('RIFF')
    expect(text(8, 4)).toBe('WAVE')
    expect(wav.getUint16(20, true)).toBe(1) // PCM
    expect(wav.getUint16(22, true)).toBe(2) // channels
    expect(wav.getUint32(24, true)).toBe(44_100)
    expect(wav.getUint16(34, true)).toBe(16)
    expect(wav.getUint32(40, true)).toBe(2 * 2 * 2) // frames * channels * bytes
    expect(wav.byteLength).toBe(44 + 8)
  })

  it('interleaves channels and clips out-of-range samples', () => {
    const wav = new DataView(
      encodeWav(
        source([
          [2, 0.5],
          [-2, -0.5],
        ]),
      ),
    )
    expect(wav.getInt16(44, true)).toBe(32767) // L frame 0, clipped
    expect(wav.getInt16(46, true)).toBe(-32768) // R frame 0, clipped
    expect(wav.getInt16(48, true)).toBe(Math.trunc(0.5 * 0x7fff))
    expect(wav.getInt16(50, true)).toBe(-0.5 * 0x8000)
  })

  it('reports peak level', () => {
    expect(
      peak(
        source([
          [0, -0.75],
          [0.25, 0],
        ]),
      ),
    ).toBe(0.75)
    expect(peak(source([[0, 0]]))).toBe(0)
  })
})
