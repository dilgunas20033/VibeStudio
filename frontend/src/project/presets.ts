// Track presets offered by "Add track". Preset names must match the sound
// implementations in src/audio/instruments.ts and the backend templates in
// backend/app/services/templates.py.

export type DrumPreset = 'kick' | 'snare' | 'clap' | 'hihat' | 'openhat' | 'perc'
export type SynthPreset = 'bass' | 'lead' | 'pad' | 'pluck' | 'keys'

export interface DrumPresetInfo {
  preset: DrumPreset
  name: string
  /** General MIDI percussion note, used for drum notes and future MIDI export. */
  pitch: number
  color: string
}

export interface SynthPresetInfo {
  preset: SynthPreset
  name: string
  color: string
  /** Lowest pitch shown in the piano roll for this preset. */
  rangeLow: number
}

export const DRUM_PRESETS: DrumPresetInfo[] = [
  { preset: 'kick', name: 'Kick', pitch: 36, color: '#f0596b' },
  { preset: 'snare', name: 'Snare', pitch: 38, color: '#f5b84a' },
  { preset: 'clap', name: 'Clap', pitch: 39, color: '#f58f4a' },
  { preset: 'hihat', name: 'Hi-hat', pitch: 42, color: '#3ecf8e' },
  { preset: 'openhat', name: 'Open hat', pitch: 46, color: '#2fb7a0' },
  { preset: 'perc', name: 'Perc', pitch: 37, color: '#4ab3f5' },
]

export const SYNTH_PRESETS: SynthPresetInfo[] = [
  { preset: 'bass', name: '808 Bass', color: '#8b6cff', rangeLow: 24 },
  { preset: 'lead', name: 'Lead', color: '#e46cff', rangeLow: 57 },
  { preset: 'pad', name: 'Pad', color: '#6c8bff', rangeLow: 48 },
  { preset: 'pluck', name: 'Pluck', color: '#ff6cb5', rangeLow: 57 },
  { preset: 'keys', name: 'Keys', color: '#f5d76c', rangeLow: 48 },
]

export const drumPreset = (preset: string | null | undefined) =>
  DRUM_PRESETS.find((p) => p.preset === preset)

export const synthPreset = (preset: string | null | undefined) =>
  SYNTH_PRESETS.find((p) => p.preset === preset)
