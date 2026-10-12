import { create } from 'zustand'
import { ApiError, api } from '../api/client'
import type {
  HealthResponse,
  ProjectCreate,
  ProjectDocument,
  ProjectSummary,
  RevisionSummary,
} from '../types/api'

interface OpenProject {
  document: ProjectDocument
  /** Server revision the local document is based on. */
  revision: number
  /** Last document confirmed by the server; used to detect unsaved changes. */
  saved: ProjectDocument
  revisions: RevisionSummary[]
}

type Busy = 'none' | 'loading' | 'saving'

interface ProjectState {
  health: HealthResponse | null
  healthError: string | null
  projects: ProjectSummary[]
  current: OpenProject | null
  busy: Busy
  error: string | null
  /** Set when a save was rejected because the server has a newer revision. */
  conflictRevision: number | null

  checkHealth: () => Promise<void>
  refreshProjects: () => Promise<void>
  createProject: (body: ProjectCreate) => Promise<void>
  openProject: (id: string) => Promise<void>
  /** Open a project the server just created (e.g. by generation) and refresh the list. */
  openCreated: (id: string) => Promise<void>
  closeProject: () => void
  updateDocument: (change: (doc: ProjectDocument) => ProjectDocument) => void
  saveProject: (message?: string) => Promise<boolean>
  deleteProject: (id: string) => Promise<void>
  /** Load an old revision into the editor as unsaved changes. Nothing is overwritten until saved. */
  restoreRevision: (revision: number) => Promise<void>
  clearError: () => void
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** JSON with object keys sorted, so equal documents compare equal whatever the key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  )
}

export const isDirty = (p: OpenProject | null): boolean =>
  p !== null && p.document !== p.saved && canonical(p.document) !== canonical(p.saved)

export const useProjectStore = create<ProjectState>()((set, get) => {
  /** Run an async action with a busy flag and uniform error capture. */
  async function run<T>(busy: Busy, fn: () => Promise<T>): Promise<T | undefined> {
    set({ busy, error: null })
    try {
      return await fn()
    } catch (e) {
      set({ error: message(e) })
      return undefined
    } finally {
      set({ busy: 'none' })
    }
  }

  async function loadIntoEditor(id: string) {
    const [res, revisions] = await Promise.all([api.getProject(id), api.listRevisions(id)])
    set({
      current: { document: res.document, saved: res.document, revision: res.revision, revisions },
      conflictRevision: null,
    })
  }

  return {
    health: null,
    healthError: null,
    projects: [],
    current: null,
    busy: 'none',
    error: null,
    conflictRevision: null,

    async checkHealth() {
      try {
        set({ health: await api.health(), healthError: null })
      } catch (e) {
        set({ health: null, healthError: message(e) })
      }
    },

    async refreshProjects() {
      await run('loading', async () => set({ projects: await api.listProjects() }))
    },

    async createProject(body) {
      await run('saving', async () => {
        const res = await api.createProject(body)
        await loadIntoEditor(res.document.id)
        set({ projects: await api.listProjects() })
      })
    },

    async openProject(id) {
      await run('loading', () => loadIntoEditor(id))
    },

    async openCreated(id) {
      await run('loading', async () => {
        await loadIntoEditor(id)
        set({ projects: await api.listProjects() })
      })
    },

    closeProject() {
      set({ current: null, conflictRevision: null })
    },

    updateDocument(change) {
      const cur = get().current
      if (!cur) return
      set({ current: { ...cur, document: change(cur.document) } })
    },

    async saveProject(msg) {
      const cur = get().current
      if (!cur) return false
      const ok = await run('saving', async () => {
        try {
          const res = await api.saveProject(cur.document.id, {
            baseRevision: cur.revision,
            message: msg,
            document: cur.document,
          })
          const revisions = await api.listRevisions(cur.document.id)
          // Adopt the server's canonical copy, unless the user kept editing while the
          // request was in flight: then keep those edits and only rebase the snapshot.
          const latest = get().current ?? cur
          const document = latest.document === cur.document ? res.document : latest.document
          set({
            current: {
              ...latest,
              document,
              saved: res.document,
              revision: res.revision,
              revisions,
            },
            conflictRevision: null,
            projects: await api.listProjects(),
          })
          return true
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            set({ conflictRevision: e.currentRevision ?? null })
          }
          throw e
        }
      })
      return ok === true
    },

    async deleteProject(id) {
      await run('saving', async () => {
        await api.deleteProject(id)
        if (get().current?.document.id === id) set({ current: null })
        set({ projects: await api.listProjects() })
      })
    },

    async restoreRevision(revision) {
      const cur = get().current
      if (!cur) return
      await run('loading', async () => {
        const rev = await api.getRevision(cur.document.id, revision)
        const latest = get().current ?? cur
        set({ current: { ...latest, document: rev.document } })
      })
    },

    clearError() {
      set({ error: null })
    },
  }
})
