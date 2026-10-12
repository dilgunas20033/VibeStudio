import { create } from 'zustand'
import { api } from '../api/client'
import type { GenerationPlan, GenerationRequest } from '../types/api'
import { useProjectStore } from './projectStore'

type Status = 'idle' | 'interpreting' | 'generating' | 'error'

interface GeneratorState {
  request: GenerationRequest
  status: Status
  /** How the server read the last request (preview or generation). */
  plan: GenerationPlan | null
  /** True when `plan` describes a project that was actually generated. */
  generated: boolean
  error: string | null

  update: (change: Partial<GenerationRequest>) => void
  reset: () => void
  preview: () => Promise<void>
  /** Compose a new project. `seed` overrides the request seed (e.g. reuse a plan's seed). */
  generate: (seed?: number) => Promise<boolean>
}

const EMPTY: GenerationRequest = { prompt: '' }

/** Drop unset fields so the server applies its own defaults ("Auto"). */
function clean(req: GenerationRequest): GenerationRequest {
  return Object.fromEntries(
    Object.entries(req).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ) as GenerationRequest
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export const useGeneratorStore = create<GeneratorState>()((set, get) => ({
  request: EMPTY,
  status: 'idle',
  plan: null,
  generated: false,
  error: null,

  update(change) {
    set({ request: { ...get().request, ...change } })
  },

  reset() {
    set({ request: EMPTY, plan: null, generated: false, error: null, status: 'idle' })
  },

  async preview() {
    set({ status: 'interpreting', error: null })
    try {
      const plan = await api.planBeat(clean(get().request))
      set({ plan, generated: false, status: 'idle' })
    } catch (e) {
      set({ status: 'error', error: message(e) })
    }
  },

  async generate(seed) {
    set({ status: 'generating', error: null })
    try {
      const req = clean({ ...get().request, ...(seed !== undefined ? { seed } : {}) })
      const res = await api.generateBeat(req)
      console.info('[generate]', res.plan)
      await useProjectStore.getState().openCreated(res.project.document.id)
      set({ plan: res.plan, generated: true, status: 'idle' })
      return true
    } catch (e) {
      set({ status: 'error', error: message(e) })
      return false
    }
  },
}))
