import { create } from 'zustand'
import { api } from '../api/client'
import { peekEngine } from '../audio'
import { addDrumTracks } from '../project/edit'
import {
  DEFAULT_MAPPING,
  effectiveClass,
  hitsToBeats,
  nextClass,
  patternBarsFor,
  type ClassChoice,
  type DetectedDrum,
  type DrumBeatHit,
} from '../project/drums'
import { downloadBlob } from '../lib/download'
import type { BeatboxTranscription, GenerationPlan, ProjectDocument } from '../types/api'
import { useProjectStore } from './projectStore'
import { assetForTake, createRecorderSlice, type RecorderSlice } from './recorderSlice'
import { useTransportStore } from './transportStore'

export interface BeatboxSettings {
  bpm: number
  grid: number
  strength: number
}

interface BeatboxState extends RecorderSlice {
  transcription: BeatboxTranscription | null
  settings: BeatboxSettings
  overrides: ReadonlyMap<number, ClassChoice>
  mapping: Record<DetectedDrum, ClassChoice>
  previewing: boolean
  prompt: string
  mode: 'keep' | 'expand'
  building: boolean
  plan: GenerationPlan | null

  updateSettings: (change: Partial<BeatboxSettings>) => void
  /** Click-to-correct: move one hit to the next class (… → ignore → kick …). */
  cycleHit: (index: number) => void
  setMapping: (detected: DetectedDrum, to: ClassChoice) => void
  setPrompt: (prompt: string) => void
  setMode: (mode: 'keep' | 'expand') => void
  preview: () => Promise<void>
  stopPreview: () => void
  /** Returns the new track ids (empty if nothing was added). */
  addToProject: (options?: { setTempo?: boolean }) => Promise<string[]>
  expand: () => Promise<boolean>
  downloadMidi: () => Promise<void>
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The reviewed pattern, in beats, with corrections, mapping and quantization applied. */
export function beatboxHits(
  s: Pick<BeatboxState, 'transcription' | 'settings' | 'overrides' | 'mapping'>,
): DrumBeatHit[] {
  if (!s.transcription) return []
  return hitsToBeats(s.transcription.hits, {
    ...s.settings,
    overrides: s.overrides,
    mapping: s.mapping,
  })
}

export const useBeatboxStore = create<BeatboxState>()((set, get) => ({
  ...createRecorderSlice<BeatboxState>(set, get, {
    kind: 'beatbox',
    analysingLabel: 'Detecting hits…',
    async analyse(take) {
      const transcription = await api.transcribeBeatbox(take.asset.id)
      console.info('[beatbox] transcribed', {
        hits: transcription.hits.length,
        tempo: transcription.tempo,
      })
      return {
        transcription,
        overrides: new Map(),
        settings: { ...get().settings, bpm: Math.round(transcription.tempo.bpm) },
      }
    },
    reset: () => ({ transcription: null, overrides: new Map(), plan: null }),
    beforeReset: () => get().stopPreview(),
  }),
  transcription: null,
  settings: { bpm: 90, grid: 0.25, strength: 1 },
  overrides: new Map(),
  mapping: { ...DEFAULT_MAPPING },
  previewing: false,
  prompt: '',
  mode: 'expand',
  building: false,
  plan: null,

  updateSettings(change) {
    set({ settings: { ...get().settings, ...change } })
  },

  cycleHit(index) {
    const { transcription, overrides, mapping } = get()
    const hit = transcription?.hits[index]
    if (!hit) return
    const next = new Map(overrides)
    next.set(index, nextClass(effectiveClass(hit, index, { overrides, mapping })))
    set({ overrides: next })
  },

  setMapping(detected, to) {
    set({ mapping: { ...get().mapping, [detected]: to } })
  },

  setPrompt(prompt) {
    set({ prompt })
  },

  setMode(mode) {
    set({ mode })
  },

  async preview() {
    const hits = beatboxHits(get())
    if (!hits.length) return
    const engine = await useTransportStore.getState().ensureAudio()
    const bars = patternBarsFor(hits)
    // Two passes of the pattern so the groove is audible.
    const loop = [...hits, ...hits.map((h) => ({ ...h, startBeat: h.startBeat + bars * 4 }))]
    const seconds = engine.previewDrums(loop, get().settings.bpm)
    set({ previewing: true })
    setTimeout(() => set({ previewing: false }), seconds * 1000)
  },

  stopPreview() {
    peekEngine()?.stopPreview()
    set({ previewing: false })
  },

  async addToProject({ setTempo = true } = {}) {
    const { take, settings } = get()
    const hits = beatboxHits(get())
    if (!take || !hits.length) return []
    const projects = useProjectStore.getState()
    if (!projects.current) {
      await projects.createProject({ name: 'Beatbox groove', template: 'empty', bpm: settings.bpm })
    }
    if (!useProjectStore.getState().current) return []
    let ids: string[] = []
    useProjectStore.getState().updateDocument((doc) => {
      const result = addDrumTracks(doc, {
        hits,
        bars: patternBarsFor(hits),
        namePrefix: 'BB',
        asset: assetForTake(take),
      })
      ids = result.trackIds
      return setTempo ? { ...result.doc, bpm: settings.bpm } : result.doc
    })
    return ids
  },

  async expand() {
    const { take, settings, prompt, mode } = get()
    const hits = beatboxHits(get())
    if (!take || !hits.length) return false
    set({ building: true, error: null })
    try {
      const res = await api.generateBeat({
        prompt,
        bpm: settings.bpm,
        drums: {
          hits: hits.map((h) => ({
            startBeat: h.startBeat,
            drum: h.drum,
            velocity: h.velocity,
          })) as [
            { startBeat: number; drum: DrumBeatHit['drum']; velocity: number },
            ...{ startBeat: number; drum: DrumBeatHit['drum']; velocity: number }[],
          ],
          mode,
          sourceAssetId: take.asset.id,
        },
      })
      await useProjectStore.getState().openCreated(res.project.document.id)
      set({ plan: res.plan, building: false })
      return true
    } catch (e) {
      set({ building: false, error: message(e) })
      return false
    }
  },

  async downloadMidi() {
    const hits = beatboxHits(get())
    if (!hits.length) return
    const doc: ProjectDocument = {
      schemaVersion: 1,
      id: 'prj_beatbox_export',
      name: 'Beatbox groove',
      bpm: get().settings.bpm,
      key: { root: 'C', mode: 'minor' },
      timeSignature: { numerator: 4, denominator: 4 },
      tracks: [],
      patterns: [],
      clips: [],
      sections: [],
      assets: [],
      aiHistory: [],
    }
    const { doc: withDrums } = addDrumTracks(doc, {
      hits,
      bars: patternBarsFor(hits),
      namePrefix: 'BB',
    })
    try {
      downloadBlob(await api.exportMidi(withDrums), 'Beatbox groove.mid')
    } catch (e) {
      set({ error: message(e) })
    }
  },
}))
