// Builds and updates the Tone.js node graph for a project: one voice, channel and
// Part per track, feeding a master bus. Used by live playback and offline export,
// so what you export is what you hear.
import * as Tone from 'tone'
import type { ProjectDocument } from '../types/project.generated'
import { createVoice, instrumentKey, type Voice } from './instruments'
import { audibleTracks, collectEvents, type NoteEvent } from './schedule'

/** Tone.Part events carry their own transport time. */
type PartEvent = NoteEvent & { time: string }

interface TrackNodes {
  key: string
  voice: Voice
  channel: Tone.Channel
  part: Tone.Part<PartEvent>
}

/** Master headroom and a safety limiter so stacked tracks don't clip the output. */
const MASTER_GAIN_DB = -3
const LIMITER_THRESHOLD_DB = -0.5

let warned = 0

export class ProjectGraph {
  private readonly tracks = new Map<string, TrackNodes>()
  private readonly master: Tone.Volume
  private readonly limiter: Tone.Limiter
  private readonly transport = Tone.getTransport()

  constructor() {
    this.limiter = new Tone.Limiter(LIMITER_THRESHOLD_DB).toDestination()
    this.master = new Tone.Volume(MASTER_GAIN_DB).connect(this.limiter)
  }

  /** Bring the graph in line with the document. Cheap enough to call on every edit. */
  sync(doc: ProjectDocument): void {
    const events = collectEvents(doc)
    const audible = audibleTracks(doc.tracks)
    const ppq = this.transport.PPQ

    for (const track of doc.tracks) {
      const key = instrumentKey(track.instrument)
      let nodes = this.tracks.get(track.id)
      if (nodes && nodes.key !== key) {
        this.disposeTrack(track.id)
        nodes = undefined
      }
      if (!nodes) nodes = this.createTrack(track.id, key, track.instrument)

      nodes.channel.volume.value = track.mixer.volumeDb
      nodes.channel.pan.value = track.mixer.pan
      nodes.channel.mute = !audible.get(track.id)

      nodes.part.clear()
      for (const ev of events.get(track.id) ?? []) {
        nodes.part.add({ ...ev, time: `${Math.round(ev.beat * ppq)}i` })
      }
    }
    for (const id of [...this.tracks.keys()]) {
      if (!doc.tracks.some((t) => t.id === id)) this.disposeTrack(id)
    }
  }

  /** Audition a note on a track right away (piano roll and step clicks). */
  preview(trackId: string, pitch: number, velocity = 0.8): void {
    const nodes = this.tracks.get(trackId)
    nodes?.voice.trigger(pitch, 0.25, Tone.now() + 0.01, velocity)
  }

  silence(): void {
    for (const n of this.tracks.values()) n.voice.silence()
  }

  dispose(): void {
    for (const id of [...this.tracks.keys()]) this.disposeTrack(id)
    this.master.dispose()
    this.limiter.dispose()
  }

  private createTrack(
    id: string,
    key: string,
    instrument: ProjectDocument['tracks'][number]['instrument'],
  ): TrackNodes {
    const voice = createVoice(instrument)
    const channel = new Tone.Channel().connect(this.master)
    voice.output.connect(channel)
    const part = new Tone.Part<PartEvent>((time, ev) => {
      const seconds = (ev.durationBeats * 60) / this.transport.bpm.value
      try {
        voice.trigger(ev.pitch, seconds, time, ev.velocity)
      } catch (e) {
        // Monophonic voices reject two hits at the same instant; skip, don't crash playback.
        if (warned++ < 5) console.warn('[audio] skipped note', ev, e)
      }
    }, []).start(0)
    const nodes = { key, voice, channel, part }
    this.tracks.set(id, nodes)
    return nodes
  }

  private disposeTrack(id: string): void {
    const n = this.tracks.get(id)
    if (!n) return
    n.part.dispose()
    n.voice.dispose()
    n.channel.dispose()
    this.tracks.delete(id)
  }
}
