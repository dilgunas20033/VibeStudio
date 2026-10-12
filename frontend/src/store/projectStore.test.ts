import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeBackend } from '../test/fakeBackend'
import { isDirty, useProjectStore } from './projectStore'

const initial = useProjectStore.getState()

describe('projectStore', () => {
  let backend: ReturnType<typeof installFakeBackend>

  beforeEach(() => {
    useProjectStore.setState(initial, true)
    backend = installFakeBackend()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('creates a project and opens it', async () => {
    await useProjectStore.getState().createProject({ name: 'Night Drive' })
    const s = useProjectStore.getState()
    expect(s.current?.document.name).toBe('Night Drive')
    expect(s.current?.revision).toBe(1)
    expect(s.projects).toHaveLength(1)
    expect(isDirty(s.current)).toBe(false)
  })

  it('tracks unsaved edits and saves a new revision', async () => {
    const store = useProjectStore.getState()
    await store.createProject({ name: 'Beat' })
    store.updateDocument((d) => ({ ...d, bpm: 145 }))
    expect(isDirty(useProjectStore.getState().current)).toBe(true)

    expect(await useProjectStore.getState().saveProject('tempo')).toBe(true)
    const s = useProjectStore.getState()
    expect(s.current?.revision).toBe(2)
    expect(isDirty(s.current)).toBe(false)
    expect(backend.projects.get(s.current!.document.id)?.doc.bpm).toBe(145)
  })

  it('reports a conflict when the server has a newer revision', async () => {
    await useProjectStore.getState().createProject({ name: 'Beat' })
    const id = useProjectStore.getState().current!.document.id
    backend.projects.get(id)!.revision = 5 // another tab saved meanwhile

    useProjectStore.getState().updateDocument((d) => ({ ...d, bpm: 90 }))
    expect(await useProjectStore.getState().saveProject()).toBe(false)
    const s = useProjectStore.getState()
    expect(s.conflictRevision).toBe(5)
    expect(s.error).toMatch(/modified elsewhere/)
    expect(s.current?.document.bpm).toBe(90) // local edits are kept
  })

  it('loads an old revision as unsaved changes without overwriting anything', async () => {
    const store = useProjectStore.getState()
    await store.createProject({ name: 'Beat' })
    store.updateDocument((d) => ({ ...d, bpm: 150 }))
    await useProjectStore.getState().saveProject()
    const id = useProjectStore.getState().current!.document.id

    await useProjectStore.getState().restoreRevision(1)
    const s = useProjectStore.getState()
    expect(s.current?.document.bpm).toBe(120)
    expect(s.current?.revision).toBe(2)
    expect(isDirty(s.current)).toBe(true)
    expect(backend.projects.get(id)?.doc.bpm).toBe(150) // server copy untouched
  })

  it('surfaces a readable error when the backend is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await useProjectStore.getState().refreshProjects()
    expect(useProjectStore.getState().error).toMatch(/Cannot reach the VibeStudio backend/)
  })

  it('deletes the open project and closes it', async () => {
    await useProjectStore.getState().createProject({ name: 'Temp' })
    const id = useProjectStore.getState().current!.document.id
    await useProjectStore.getState().deleteProject(id)
    expect(useProjectStore.getState().current).toBeNull()
    expect(useProjectStore.getState().projects).toHaveLength(0)
  })
})

describe('dirty tracking', () => {
  it('ignores object key order', () => {
    const doc = { a: 1, b: { c: 2, d: [1, { e: 3, f: 4 }] } }
    const reordered = { b: { d: [1, { f: 4, e: 3 }], c: 2 }, a: 1 }
    const p = (document: unknown, saved: unknown) =>
      ({ document, saved, revision: 1, revisions: [] }) as unknown as Parameters<typeof isDirty>[0]
    expect(isDirty(p(doc, reordered))).toBe(false)
    expect(isDirty(p(doc, { ...reordered, a: 2 }))).toBe(true)
  })
})
