import * as Tone from 'tone'
import { loopLengthBeats } from '../project/music'
import type { ProjectDocument } from '../types/project.generated'
import { ProjectGraph } from './graph'
import { encodeWav, peak } from './wav'

export interface RenderResult {
  wav: ArrayBuffer
  seconds: number
  sampleRate: number
  peak: number
}

const SAMPLE_RATE = 44_100
const TAIL_SECONDS = 1.5

/**
 * Render the project loop offline, faster than real time, through the same graph used
 * for live playback, and encode it as a stereo 16-bit WAV.
 */
export async function renderLoopWav(doc: ProjectDocument, loops = 1): Promise<RenderResult> {
  const loopSeconds = (loopLengthBeats(doc) * 60) / doc.bpm
  const seconds = loopSeconds * loops + TAIL_SECONDS
  const buffer = await Tone.Offline(
    ({ transport }) => {
      const graph = new ProjectGraph()
      graph.sync(doc)
      transport.bpm.value = doc.bpm
      transport.loop = loops > 1
      transport.loopEnd = loopSeconds
      if (loops > 1)
        transport.scheduleOnce(() => (transport.loop = false), loopSeconds * (loops - 1))
      transport.start(0)
    },
    seconds,
    2,
    SAMPLE_RATE,
  )
  const audio = buffer.get()
  if (!audio) throw new Error('offline render produced no audio buffer')
  return { wav: encodeWav(audio), seconds, sampleRate: audio.sampleRate, peak: peak(audio) }
}
