/* Generated from shared/project.schema.json by npm run gen:types. Do not edit. */

export interface ProjectDocument {
  /**
   * @maxItems 1000
   */
  aiHistory: AiPromptRecord[];
  /**
   * @maxItems 2048
   */
  assets: AudioAsset[];
  bpm: number;
  /**
   * @maxItems 10000
   */
  clips: Clip[];
  id: string;
  key: MusicalKey;
  name: string;
  /**
   * @maxItems 2048
   */
  patterns: Pattern[];
  schemaVersion: 1;
  /**
   * @maxItems 256
   */
  sections: ArrangementSection[];
  timeSignature: TimeSignature;
  /**
   * @maxItems 256
   */
  tracks: Track[];
}
export interface AiPromptRecord {
  createdAt: string;
  id: string;
  prompt: string;
  summary: string | null;
}
/**
 * Immutable reference to stored audio. Edits never modify the source file.
 */
export interface AudioAsset {
  channels: number | null;
  durationSeconds: number | null;
  id: string;
  name: string;
  sampleRate: number | null;
  sha256: string | null;
  uri: string;
}
/**
 * Places a pattern (MIDI) or an audio asset on a track's timeline.
 */
export interface Clip {
  assetId: string | null;
  id: string;
  lengthBeats: number;
  /**
   * Where inside the source the clip starts
   */
  offsetBeats: number;
  patternId: string | null;
  startBeat: number;
  trackId: string;
}
export interface MusicalKey {
  mode: "major" | "minor";
  root: "C" | "C#" | "D" | "D#" | "E" | "F" | "F#" | "G" | "G#" | "A" | "A#" | "B";
}
/**
 * A reusable block of MIDI notes. Clips place patterns on the timeline.
 */
export interface Pattern {
  id: string;
  lengthBeats: number;
  name: string;
  /**
   * @maxItems 50000
   */
  notes: MidiNote[];
}
export interface MidiNote {
  /**
   * Transcription confidence (0-1) for notes detected from audio. Null for notes entered or confirmed by the user.
   */
  confidence: number | null;
  durationBeats: number;
  id: string;
  /**
   * MIDI note number
   */
  pitch: number;
  /**
   * Offset from the pattern start, in beats
   */
  startBeat: number;
  velocity: number;
}
export interface ArrangementSection {
  id: string;
  lengthBeats: number;
  name: string;
  startBeat: number;
}
export interface TimeSignature {
  denominator: 1 | 2 | 4 | 8 | 16 | 32;
  numerator: number;
}
export interface Track {
  color: string;
  /**
   * @maxItems 64
   */
  effects: Effect[];
  id: string;
  instrument: Instrument | null;
  kind: "instrument" | "drums" | "audio";
  mixer: MixerSettings;
  name: string;
  /**
   * Musical role hint, e.g. kick, 808, lead, vocal_lead
   */
  role: string | null;
}
export interface Effect {
  enabled: boolean;
  id: string;
  params: {
    [k: string]: number | string | boolean;
  };
  type: string;
}
/**
 * Instrument reference. `type` selects an engine implementation. `params` are
 * engine-specific and validated by that engine, not by this schema.
 */
export interface Instrument {
  params: {
    [k: string]: number | string | boolean;
  };
  preset: string | null;
  type: string;
}
export interface MixerSettings {
  mute: boolean;
  pan: number;
  solo: boolean;
  volumeDb: number;
}
