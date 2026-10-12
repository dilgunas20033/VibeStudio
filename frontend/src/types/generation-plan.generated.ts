/* Generated from shared/generation-plan.schema.json by npm run gen:types. Do not edit. */

/**
 * Fully resolved parameters the composer runs on. Shown to the user before/after.
 */
export interface GenerationPlan {
  bars: number
  bassIntensity: number
  bpm: number
  complexity: number
  composer: 'procedural-v1'
  /**
   * Length of the supplied drum pattern, in bars
   */
  drumBars: number | null
  drumIntensity: number
  drumMode: ('keep' | 'expand') | null
  energy: number
  genre: 'trap' | 'drill' | 'boombap' | 'lofi' | 'house' | 'pop'
  instruments: (
    | 'kick'
    | 'snare'
    | 'clap'
    | 'hihat'
    | 'openhat'
    | 'perc'
    | 'bass'
    | 'lead'
    | 'pad'
    | 'pluck'
    | 'keys'
  )[]
  interpreter: 'rules' | 'llm'
  interpreterModel: string | null
  key: MusicalKey
  melodicComplexity: number
  /**
   * Length of the supplied melody, in bars
   */
  melodyBars: number | null
  melodyInstrument: ('lead' | 'pluck' | 'keys') | null
  melodyMode: ('keep' | 'vary') | null
  mood: 'dark' | 'emotional' | 'uplifting' | 'chill' | 'aggressive' | 'dreamy'
  seed: number
  sources: {
    [k: string]: 'user' | 'prompt' | 'melody' | 'default'
  }
  structure: 'loop' | 'short' | 'full'
  title: string
  warnings: string[]
}
export interface MusicalKey {
  mode: 'major' | 'minor'
  root: 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F' | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B'
}
