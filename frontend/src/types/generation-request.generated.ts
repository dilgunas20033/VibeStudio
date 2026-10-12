/* Generated from shared/generation-request.schema.json by npm run gen:types. Do not edit. */

/**
 * What the user asks for. Every setting is optional; unset means "decide for me".
 */
export interface GenerationRequest {
  bassIntensity?: number | null
  bpm?: number | null
  complexity?: number | null
  drumIntensity?: number | null
  drums?: DrumsInput | null
  durationSeconds?: number | null
  energy?: number | null
  genre?: ('trap' | 'drill' | 'boombap' | 'lofi' | 'house' | 'pop') | null
  instruments?:
    | [
        (
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
        ),
        ...(
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
        )[],
      ]
    | null
  /**
   * auto: LLM if configured, otherwise keyword rules
   */
  interpreter?: 'auto' | 'rules' | 'llm'
  keyMode?: ('major' | 'minor') | null
  keyRoot?: ('C' | 'C#' | 'D' | 'D#' | 'E' | 'F' | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B') | null
  melodicComplexity?: number | null
  melody?: MelodyInput | null
  mood?: ('dark' | 'emotional' | 'uplifting' | 'chill' | 'aggressive' | 'dreamy') | null
  name?: string | null
  prompt?: string
  seed?: number | null
  structure?: ('loop' | 'short' | 'full') | null
}
/**
 * A drum pattern to build the beat around (e.g. transcribed beatboxing), in beats.
 */
export interface DrumsInput {
  /**
   * @minItems 1
   * @maxItems 1024
   */
  hits: [DrumHitInput, ...DrumHitInput[]]
  /**
   * keep: the hook and verse play exactly these hits. expand: the hook adds complementary parts (hats, open hats, fills) and the verse is a thinned version.
   */
  mode?: 'keep' | 'expand'
  sourceAssetId?: string | null
}
export interface DrumHitInput {
  drum: 'kick' | 'snare' | 'clap' | 'hihat' | 'openhat' | 'perc'
  startBeat: number
  velocity?: number
}
/**
 * A melody to build the beat around (e.g. transcribed humming), in beats from bar 1.
 */
export interface MelodyInput {
  instrument?: 'lead' | 'pluck' | 'keys'
  /**
   * keep: the melody is used exactly as given. vary: the verse also plays a variation of it (the hook always keeps the original notes).
   */
  mode?: 'keep' | 'vary'
  /**
   * @minItems 1
   * @maxItems 512
   */
  notes: [MelodyNote, ...MelodyNote[]]
  /**
   * Recording the melody came from; kept in the project
   */
  sourceAssetId?: string | null
}
export interface MelodyNote {
  confidence?: number | null
  durationBeats: number
  pitch: number
  startBeat: number
  velocity?: number
}
