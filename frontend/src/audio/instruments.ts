// Built-in synthesized instruments (Tone.js). Every sound is generated, so there are
// no sample files to license. Preset names match src/project/presets.ts.
import * as Tone from 'tone'
import type { Instrument } from '../types/project.generated'

export interface Voice {
  /** Play one note. `time` is an AudioContext time; `velocity` is 0..1. */
  trigger(pitch: number, durationSeconds: number, time: number, velocity: number): void
  /** Release sounding notes (on stop). */
  silence(): void
  output: Tone.ToneAudioNode
  dispose(): void
}

const midiToHz = (pitch: number) => Tone.Frequency(pitch, 'midi').toFrequency()

/** Wrap nodes as a Voice whose output is the last node of the chain. */
function voice(
  nodes: Tone.ToneAudioNode[],
  output: Tone.ToneAudioNode,
  trigger: Voice['trigger'],
  silence: () => void = () => {},
): Voice {
  return {
    output,
    trigger,
    silence,
    dispose: () => nodes.forEach((n) => n.dispose()),
  }
}

function kick(): Voice {
  const synth = new Tone.MembraneSynth({
    pitchDecay: 0.05,
    octaves: 6,
    envelope: { attack: 0.001, decay: 0.45, sustain: 0, release: 0.1 },
  })
  return voice([synth], synth, (_p, _d, time, vel) =>
    synth.triggerAttackRelease('C1', 0.3, time, vel),
  )
}

function snare(): Voice {
  const out = new Tone.Gain(0.9)
  const hp = new Tone.Filter(1800, 'highpass').connect(out)
  const noise = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.18, sustain: 0 },
  }).connect(hp)
  const body = new Tone.MembraneSynth({
    octaves: 2,
    envelope: { attack: 0.001, decay: 0.12, sustain: 0 },
    volume: -8,
  }).connect(out)
  return voice([noise, body, hp, out], out, (_p, _d, time, vel) => {
    noise.triggerAttackRelease(0.15, time, vel)
    body.triggerAttackRelease('G2', 0.1, time, vel)
  })
}

function clap(): Voice {
  const out = new Tone.Gain(1)
  const bp = new Tone.Filter({ frequency: 1300, type: 'bandpass', Q: 1.2 }).connect(out)
  const noise = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.001, decay: 0.22, sustain: 0 },
  }).connect(bp)
  return voice([noise, bp, out], out, (_p, _d, time, vel) =>
    noise.triggerAttackRelease(0.2, time, vel),
  )
}

function hat(decay: number): Voice {
  const hp = new Tone.Filter(7000, 'highpass')
  const metal = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay, release: 0.01 },
    harmonicity: 5.1,
    modulationIndex: 32,
    resonance: 5000,
    octaves: 1.5,
    volume: -14,
  }).connect(hp)
  return voice([metal, hp], hp, (_p, _d, time, vel) =>
    metal.triggerAttackRelease(300, decay, time, vel),
  )
}

function perc(): Voice {
  const synth = new Tone.MembraneSynth({
    pitchDecay: 0.01,
    octaves: 2,
    envelope: { attack: 0.001, decay: 0.15, sustain: 0 },
    volume: -6,
  })
  return voice([synth], synth, (_p, _d, time, vel) =>
    synth.triggerAttackRelease('G3', 0.1, time, vel),
  )
}

type SynthPatch = Parameters<Tone.PolySynth<Tone.Synth>['set']>[0]

function poly(options: SynthPatch, chain: Tone.ToneAudioNode[], maxPolyphony = 8): Voice {
  const synth = new Tone.PolySynth(Tone.Synth)
  synth.maxPolyphony = maxPolyphony
  synth.set(options)
  const nodes: Tone.ToneAudioNode[] = [synth, ...chain]
  synth.chain(...chain)
  return voice(
    nodes,
    chain.at(-1) ?? synth,
    (pitch, dur, time, vel) => synth.triggerAttackRelease(midiToHz(pitch), dur, time, vel),
    () => synth.releaseAll(),
  )
}

const SYNTHS: Record<string, () => Voice> = {
  bass: () =>
    poly(
      {
        oscillator: { type: 'sine' },
        envelope: { attack: 0.005, decay: 1.2, sustain: 0.5, release: 0.25 },
      },
      [new Tone.Distortion(0.25)],
      4,
    ),
  lead: () =>
    poly(
      {
        oscillator: { type: 'fatsawtooth', count: 3, spread: 18 },
        envelope: { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.3 },
        volume: -10,
      },
      [new Tone.Filter(3200, 'lowpass')],
    ),
  pad: () =>
    poly(
      {
        oscillator: { type: 'fatsawtooth', count: 4, spread: 30 },
        envelope: { attack: 0.4, decay: 0.5, sustain: 0.8, release: 1.2 },
        volume: -14,
      },
      [new Tone.Filter(1400, 'lowpass')],
    ),
  pluck: () =>
    poly(
      {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.002, decay: 0.3, sustain: 0, release: 0.2 },
        volume: -6,
      },
      [new Tone.Filter(4000, 'lowpass')],
    ),
}

/** Electric-piano style keys: a soft FM poly synth. */
function keys(): Voice {
  const synth = new Tone.PolySynth(Tone.FMSynth)
  synth.maxPolyphony = 12
  synth.set({
    harmonicity: 3,
    modulationIndex: 6,
    envelope: { attack: 0.005, decay: 1.2, sustain: 0.25, release: 0.6 },
    modulationEnvelope: { attack: 0.002, decay: 0.4, sustain: 0.1, release: 0.4 },
    volume: -10,
  })
  const filter = new Tone.Filter(3500, 'lowpass')
  synth.connect(filter)
  return voice(
    [synth, filter],
    filter,
    (pitch, dur, time, vel) => synth.triggerAttackRelease(midiToHz(pitch), dur, time, vel),
    () => synth.releaseAll(),
  )
}

SYNTHS.keys = keys

const DRUMS: Record<string, () => Voice> = {
  kick,
  snare,
  clap,
  hihat: () => hat(0.06),
  openhat: () => hat(0.35),
  perc,
}

/** Stable identity for an instrument; a change means the voice must be rebuilt. */
export const instrumentKey = (i: Instrument | null | undefined) =>
  `${i?.type ?? 'none'}:${i?.preset ?? ''}`

/** Create the voice for a track's instrument. Unknown presets fall back with a warning. */
export function createVoice(instrument: Instrument | null | undefined): Voice {
  const table = instrument?.type === 'drum' ? DRUMS : SYNTHS
  const factory = table[instrument?.preset ?? '']
  if (!factory) {
    console.warn(`[audio] unknown instrument ${instrumentKey(instrument)}, using default synth`)
    return (instrument?.type === 'drum' ? DRUMS.perc : SYNTHS.pluck)!()
  }
  return factory()
}
