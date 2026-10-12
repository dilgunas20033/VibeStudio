// API envelope types. These mirror backend/app/schemas/api.py.
// The project document itself is generated from the shared JSON Schema.
import type { GenerationPlan } from './generation-plan.generated'
import type { GenerationRequest } from './generation-request.generated'
import type { MusicalKey, ProjectDocument, TimeSignature } from './project.generated'

export type { GenerationPlan, GenerationRequest, ProjectDocument }

export interface HealthResponse {
  status: 'ok' | 'degraded'
  version: string
  projectSchemaVersion: number
  database: 'ok' | 'error'
}

export type ProjectTemplate = 'empty' | 'starter' | 'demo'

export interface ProjectCreate {
  name: string
  /** Defaults to 'starter' on the server. */
  template?: ProjectTemplate
  bpm?: number
  key?: MusicalKey
  timeSignature?: TimeSignature
}

export interface ProjectSummary {
  id: string
  name: string
  bpm: number
  revision: number
  trackCount: number
  createdAt: string
  updatedAt: string
}

export interface ProjectResponse {
  revision: number
  createdAt: string
  updatedAt: string
  document: ProjectDocument
}

export interface ProjectSave {
  baseRevision: number
  message?: string
  document: ProjectDocument
}

export interface RevisionSummary {
  revision: number
  message: string | null
  createdAt: string
}

export interface RevisionResponse extends RevisionSummary {
  document: ProjectDocument
}

export interface GenerateResponse {
  plan: GenerationPlan
  project: ProjectResponse
}

/** Mirrors backend/app/api/assets.py AssetResponse. */
export interface AssetResponse {
  id: string
  uri: string
  name: string
  kind: 'hum' | 'beatbox' | 'vocal' | 'import'
  sha256: string
  sampleRate: number
  channels: number
  durationSeconds: number
  sizeBytes: number
  createdAt: string
}

/** Mirrors backend/app/api/transcribe.py MelodyTranscriptionOut. */
export interface MelodyTranscription {
  assetId: string
  method: string
  duration: number
  tuningCents: number
  notes: {
    start: number
    end: number
    pitch: number
    pitchCents: number
    confidence: number
    velocity: number
  }[]
  tempo: { bpm: number; confidence: number; alternatives: number[] }
  key: { root: MusicalKey['root']; mode: MusicalKey['mode']; confidence: number }
  curveTimes: number[]
  curveMidi: number[]
  warnings: string[]
}

/** Mirrors backend/app/api/transcribe.py BeatboxTranscriptionOut. */
export interface BeatboxTranscription {
  assetId: string
  method: string
  duration: number
  hits: {
    time: number
    drum: 'kick' | 'snare' | 'hihat' | 'openhat' | 'perc'
    confidence: number
    velocity: number
    centroidHz: number
    lowRatio: number
    highRatio: number
    decayS: number
  }[]
  tempo: { bpm: number; confidence: number; alternatives: number[] }
  warnings: string[]
}
