import type {
  AssetResponse,
  BeatboxTranscription,
  GenerateResponse,
  GenerationPlan,
  GenerationRequest,
  HealthResponse,
  MelodyTranscription,
  ProjectCreate,
  ProjectDocument,
  ProjectResponse,
  ProjectSave,
  ProjectSummary,
  RevisionResponse,
  RevisionSummary,
} from '../types/api'

/** Base path for API calls. Same-origin by default (Vite proxies /api in dev). */
const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''

export class ApiError extends Error {
  readonly status: number
  readonly detail: unknown

  constructor(status: number, detail: unknown, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }

  /** The server's currentRevision when a save hit a 409 conflict. */
  get currentRevision(): number | undefined {
    const d = this.detail as { currentRevision?: unknown } | null
    return typeof d?.currentRevision === 'number' ? d.currentRevision : undefined
  }
}

function describe(status: number, detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    // FastAPI validation errors: [{loc: [...], msg: "..."}]
    return detail
      .map((e: { loc?: unknown[]; msg?: string }) => `${(e.loc ?? []).join('.')}: ${e.msg ?? ''}`)
      .join('; ')
  }
  if (detail && typeof detail === 'object' && 'message' in detail) {
    return String((detail as { message: unknown }).message)
  }
  return `Request failed with status ${status}`
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch {
    throw new ApiError(0, null, 'Cannot reach the VibeStudio backend. Is it running?')
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null)
    const detail = (body as { detail?: unknown } | null)?.detail ?? body
    throw new ApiError(res.status, detail, describe(res.status, detail))
  }
  return res
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await send(path, init)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

const enc = encodeURIComponent

export const api = {
  health: () => request<HealthResponse>('/api/health'),
  listProjects: () => request<ProjectSummary[]>('/api/projects'),
  createProject: (body: ProjectCreate) =>
    request<ProjectResponse>('/api/projects', { method: 'POST', body: JSON.stringify(body) }),
  getProject: (id: string) => request<ProjectResponse>(`/api/projects/${enc(id)}`),
  saveProject: (id: string, body: ProjectSave) =>
    request<ProjectResponse>(`/api/projects/${enc(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteProject: (id: string) => request<void>(`/api/projects/${enc(id)}`, { method: 'DELETE' }),
  listRevisions: (id: string) => request<RevisionSummary[]>(`/api/projects/${enc(id)}/revisions`),
  getRevision: (id: string, revision: number) =>
    request<RevisionResponse>(`/api/projects/${enc(id)}/revisions/${revision}`),
  /** Interpret a generation request without composing anything. */
  planBeat: (body: GenerationRequest) =>
    request<GenerationPlan>('/api/generate/plan', { method: 'POST', body: JSON.stringify(body) }),
  /** Compose a new project from a description and settings. */
  generateBeat: (body: GenerationRequest) =>
    request<GenerateResponse>('/api/generate', { method: 'POST', body: JSON.stringify(body) }),
  /** Upload audio (raw body). The server validates it and stores it immutably. */
  uploadAsset: (audio: Blob, name: string, kind: AssetResponse['kind']) =>
    request<AssetResponse>(`/api/assets?${new URLSearchParams({ name, kind }).toString()}`, {
      method: 'POST',
      body: audio,
      headers: { 'Content-Type': audio.type || 'audio/wav' },
    }),
  assetAudioUrl: (id: string) => `${BASE}/api/assets/${enc(id)}/audio`,
  transcribeMelody: (assetId: string) =>
    request<MelodyTranscription>('/api/transcribe/melody', {
      method: 'POST',
      body: JSON.stringify({ assetId }),
    }),
  transcribeBeatbox: (assetId: string) =>
    request<BeatboxTranscription>('/api/transcribe/beatbox', {
      method: 'POST',
      body: JSON.stringify({ assetId }),
    }),
  /** Standard MIDI File of the given (possibly unsaved) document. */
  exportMidi: async (document: ProjectDocument, trackIds?: string[]) => {
    const res = await send('/api/export/midi', {
      method: 'POST',
      body: JSON.stringify({ document, trackIds }),
    })
    return res.blob()
  },
}
