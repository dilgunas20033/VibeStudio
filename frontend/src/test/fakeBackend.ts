import { vi } from 'vitest'
import type { GenerationPlan, ProjectDocument } from '../types/api'

/** A one-track stand-in for the server's starter template: a Kick with an empty pattern. */
function starterContent(): Pick<ProjectDocument, 'tracks' | 'patterns' | 'clips'> {
  return {
    tracks: [
      {
        id: 'trk_kick',
        name: 'Kick',
        kind: 'drums',
        role: 'kick',
        color: '#f0596b',
        instrument: { type: 'drum', preset: 'kick', params: {} },
        mixer: { volumeDb: 0, pan: 0, mute: false, solo: false },
        effects: [],
      },
    ],
    patterns: [{ id: 'pat_kick', name: 'Kick', lengthBeats: 4, notes: [] }],
    clips: [
      {
        id: 'clp_kick',
        trackId: 'trk_kick',
        patternId: 'pat_kick',
        assetId: null,
        startBeat: 0,
        lengthBeats: 8,
        offsetBeats: 0,
      },
    ],
  }
}

export function fakePlan(prompt: string, seed: number): GenerationPlan {
  return {
    title: prompt.includes('trap') ? 'Dark Trap Beat' : 'Generated Beat',
    genre: 'trap',
    mood: 'dark',
    energy: 0.8,
    bpm: 145,
    key: { root: 'A', mode: 'minor' },
    structure: 'short',
    bars: 4,
    instruments: ['kick', 'lead'],
    complexity: 0.5,
    drumIntensity: 0.8,
    bassIntensity: 0.6,
    melodicComplexity: 0.5,
    seed,
    sources: { genre: 'prompt', bpm: 'prompt', mood: 'prompt', keyRoot: 'default' },
    interpreter: 'rules',
    interpreterModel: null,
    composer: 'procedural-v1',
    melodyBars: null,
    melodyInstrument: null,
    melodyMode: null,
    drumBars: null,
    drumMode: null,
    warnings: ['808 slides (pitch glides) are not supported by the engine yet.'],
  }
}

/** Two sections: the kick only plays in the Hook; the lead plays in both. */
function generatedDoc(id: string, name: string): ProjectDocument {
  const mixer = { volumeDb: 0, pan: 0, mute: false, solo: false }
  const note = (nid: string, pitch: number, startBeat: number) => ({
    id: nid,
    pitch,
    startBeat,
    durationBeats: 0.25,
    velocity: 100,
    confidence: null,
  })
  const clip = (cid: string, trackId: string, patternId: string, startBeat: number) => ({
    id: cid,
    trackId,
    patternId,
    assetId: null,
    startBeat,
    lengthBeats: 8,
    offsetBeats: 0,
  })
  return {
    schemaVersion: 1,
    id,
    name,
    bpm: 145,
    key: { root: 'A', mode: 'minor' },
    timeSignature: { numerator: 4, denominator: 4 },
    tracks: [
      { ...starterContent().tracks[0]!, id: 'trk_gk' },
      {
        id: 'trk_gl',
        name: 'Lead',
        kind: 'instrument',
        role: 'lead',
        color: '#e46cff',
        instrument: { type: 'synth', preset: 'lead', params: {} },
        mixer,
        effects: [],
      },
    ],
    patterns: [
      { id: 'pat_hk', name: 'Hook Kick', lengthBeats: 4, notes: [note('n_k1', 36, 0)] },
      { id: 'pat_il', name: 'Intro Lead', lengthBeats: 4, notes: [note('n_l1', 69, 0)] },
      { id: 'pat_hl', name: 'Hook Lead', lengthBeats: 4, notes: [note('n_l2', 72, 1)] },
    ],
    clips: [
      clip('c_hk', 'trk_gk', 'pat_hk', 8),
      clip('c_il', 'trk_gl', 'pat_il', 0),
      clip('c_hl', 'trk_gl', 'pat_hl', 8),
    ],
    sections: [
      { id: 's_i', name: 'Intro', startBeat: 0, lengthBeats: 8 },
      { id: 's_h', name: 'Hook', startBeat: 8, lengthBeats: 8 },
    ],
    assets: [],
    aiHistory: [],
  }
}

/** Minimal in-memory imitation of the FastAPI project endpoints, installed as global fetch. */
export function installFakeBackend() {
  const projects = new Map<
    string,
    { revision: number; doc: ProjectDocument; history: ProjectDocument[] }
  >()
  let seq = 0

  const json = (status: number, body: unknown) =>
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })

  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    const now = '2026-01-01T00:00:00Z'
    const m = url.match(/\/api\/projects\/([^/]+)(\/revisions)?(?:\/(\d+))?$/)

    if (url.endsWith('/api/health'))
      return json(200, { status: 'ok', version: '0.1.0', projectSchemaVersion: 1, database: 'ok' })
    if (url.endsWith('/api/projects') && method === 'GET')
      return json(
        200,
        [...projects.values()].map(({ doc, revision }) => ({
          id: doc.id,
          name: doc.name,
          bpm: doc.bpm,
          revision,
          trackCount: doc.tracks.length,
          createdAt: now,
          updatedAt: now,
        })),
      )
    if (url.endsWith('/api/generate/plan') || url.endsWith('/api/generate')) {
      const plan = fakePlan(body.prompt ?? '', body.seed ?? 42)
      if (url.endsWith('/plan')) return json(200, plan)
      const doc = generatedDoc(`prj_${++seq}`, plan.title)
      projects.set(doc.id, { revision: 1, doc, history: [doc] })
      return json(201, {
        plan,
        project: { revision: 1, createdAt: now, updatedAt: now, document: doc },
      })
    }
    if (url.endsWith('/api/export/midi')) {
      return new Response(new Blob(['MThd']), {
        status: 200,
        headers: { 'Content-Type': 'audio/midi' },
      })
    }
    if (url.endsWith('/api/projects') && method === 'POST') {
      const doc: ProjectDocument = {
        schemaVersion: 1,
        id: `prj_${++seq}`,
        name: body.name,
        bpm: body.bpm ?? 120,
        key: { root: 'C', mode: 'minor' },
        timeSignature: { numerator: 4, denominator: 4 },
        tracks: [],
        patterns: [],
        clips: [],
        ...(body.template === 'empty' ? {} : starterContent()),
        sections: [],
        assets: [],
        aiHistory: [],
      }
      projects.set(doc.id, { revision: 1, doc, history: [doc] })
      return json(201, { revision: 1, createdAt: now, updatedAt: now, document: doc })
    }
    if (m) {
      const entry = projects.get(decodeURIComponent(m[1]!))
      if (!entry) return json(404, { detail: 'project not found' })
      if (m[2] && m[3]) {
        const doc = entry.history[Number(m[3]) - 1]
        if (!doc) return json(404, { detail: 'revision not found' })
        return json(200, { revision: Number(m[3]), message: null, createdAt: now, document: doc })
      }
      if (m[2])
        return json(
          200,
          entry.history
            .map((_, i) => ({ revision: i + 1, message: null, createdAt: now }))
            .reverse(),
        )
      if (method === 'GET')
        return json(200, {
          revision: entry.revision,
          createdAt: now,
          updatedAt: now,
          document: entry.doc,
        })
      if (method === 'PUT') {
        if (body.baseRevision !== entry.revision)
          return json(409, {
            detail: { message: 'project was modified elsewhere', currentRevision: entry.revision },
          })
        entry.revision += 1
        entry.doc = body.document
        entry.history.push(body.document)
        return json(200, {
          revision: entry.revision,
          createdAt: now,
          updatedAt: now,
          document: entry.doc,
        })
      }
      if (method === 'DELETE') {
        projects.delete(entry.doc.id)
        return json(204, null)
      }
    }
    return json(500, { detail: `unhandled ${method} ${url}` })
  })

  vi.stubGlobal('fetch', fetchMock)
  return { projects, fetchMock }
}
