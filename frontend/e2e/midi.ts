import { readFileSync } from 'node:fs'

export interface MidiInfo {
  format: number
  ticksPerBeat: number
  tracks: { name: string; noteOns: number; channels: Set<number> }[]
  markers: string[]
  bpm: number | null
}

/** Minimal Standard MIDI File reader, enough to verify exports in tests. */
export function readMidi(path: string): MidiInfo {
  const b = readFileSync(path)
  if (b.toString('ascii', 0, 4) !== 'MThd') throw new Error('not a MIDI file')
  const format = b.readUInt16BE(8)
  const ntracks = b.readUInt16BE(10)
  const ticksPerBeat = b.readUInt16BE(12)
  let pos = 14
  const tracks: MidiInfo['tracks'] = []
  const markers: string[] = []
  let bpm: number | null = null

  const vlq = () => {
    let v = 0
    for (;;) {
      const byte = b[pos++]!
      v = (v << 7) | (byte & 0x7f)
      if (!(byte & 0x80)) return v
    }
  }

  for (let t = 0; t < ntracks; t++) {
    if (b.toString('ascii', pos, pos + 4) !== 'MTrk') throw new Error('bad track chunk')
    const end = pos + 8 + b.readUInt32BE(pos + 4)
    pos += 8
    const track = { name: '', noteOns: 0, channels: new Set<number>() }
    let status = 0
    while (pos < end) {
      vlq() // delta time
      let byte = b[pos]!
      if (byte & 0x80) {
        status = byte
        pos++
      }
      if (status === 0xff) {
        const type = b[pos++]!
        const len = vlq()
        const data = b.subarray(pos, pos + len)
        if (type === 0x03) track.name = data.toString('utf8')
        if (type === 0x06) markers.push(data.toString('utf8'))
        if (type === 0x51) bpm = 60_000_000 / ((data[0]! << 16) | (data[1]! << 8) | data[2]!)
        pos += len
      } else if (status === 0xf0 || status === 0xf7) {
        pos += vlq()
      } else {
        const kind = status & 0xf0
        const channel = status & 0x0f
        const size = kind === 0xc0 || kind === 0xd0 ? 1 : 2
        byte = b[pos + 1]!
        if (kind === 0x90 && byte > 0) {
          track.noteOns++
          track.channels.add(channel)
        }
        pos += size
      }
    }
    tracks.push(track)
  }
  return { format, ticksPerBeat, tracks, markers, bpm }
}
