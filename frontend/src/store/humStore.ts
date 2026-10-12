import { create } from 'zustand'
import { api } from '../api/client'
import { peekEngine } from '../audio'
import { addMelodyTrack } from '../project/edit'
import { detectedToBeats, toBeatNotes, type BeatNote, type ReviewNote } from '../project/quantize'
import { downloadBlob, safeFileName } from '../lib/download'
import type { GenerationPlan, MelodyTranscription, ProjectDocument } from '../types/api'
import { useProjectStore } from './projectStore'
import { useTransportStore } from './transportStore'
import { assetForTake, createRecorderSlice, type RecorderSlice } from './recorderSlice'

export { MAX_TAKE_SECONDS } from './recorderSlice'
export type HumInstrument = 'lead' | 'pluck' | 'keys'

export interface HumSettings {
  bpm: number
  grid: number
  strength: number
  transpose: number
  minConfidence: number
  instrument: HumInstrument
}

interface HumState extends RecorderSlice {
  transcription: MelodyTranscription | null
  settings: HumSettings
  excluded: ReadonlySet<number>
  previewing: boolean
  prompt: string
  mode: 'keep' | 'vary'
  building: boolean
  plan: GenerationPlan | null

  updateSettings: (change: Partial<HumSettings>) => void
  toggleExcluded: (index: number) => void
  setPrompt: (prompt: string) => void
  setMode: (mode: 'keep' | 'vary') => void
  preview: () => Promise<void>
  stopPreview: () => void
  /** Returns the new track's id, or null if nothing was added. */
  addToProject: (options?: { setTempo?: boolean }) => Promise<string | null>
  buildBeat: () => Promise<boolean>
  downloadMidi: () => Promise<void>
}

const DEFAULT_SETTINGS: HumSettings = {
  bpm: 100,
  grid: 0.25,
  strength: 1,
  transpose: 0,
  minConfidence: 0,
  instrument: 'lead',
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The reviewed melody, in beats, with the current settings applied. */
export function humNotes(
  s: Pick<HumState, 'transcription' | 'settings' | 'excluded'>,
): ReviewNote[] {
  if (!s.transcription) return []
  return detectedToBeats(s.transcription.notes, { ...s.settings, excluded: s.excluded })
}

export const useHumStore = create<HumState>()((set, get) => ({
  ...createRecorderSlice<HumState>(set, get, {
    kind: 'hum',
    analysingLabel: 'Detecting notes…',
    async analyse(take) {
      const transcription = await api.transcribeMelody(take.asset.id)
      console.info('[hum] transcribed', {
        notes: transcription.notes.length,
        tempo: transcription.tempo,
        key: transcription.key,
      })
      return {
        transcription,
        excluded: new Set(),
        settings: { ...get().settings, bpm: Math.round(transcription.tempo.bpm), transpose: 0 },
      }
    },
    reset: () => ({ transcription: null, excluded: new Set(), plan: null }),
    beforeReset: () => get().stopPreview(),
  }),
  transcription: null,
  settings: DEFAULT_SETTINGS,
  excluded: new Set(),
  previewing: false,
  prompt: '',
  mode: 'keep',
  building: false,
  plan: null,

  updateSettings(change) {
    set({ settings: { ...get().settings, ...change } })
  },

  toggleExcluded(index) {
    const next = new Set(get().excluded)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    set({ excluded: next })
  },

  setPrompt(prompt) {
    set({ prompt })
  },

  setMode(mode) {
    set({ mode })
  },

  async preview() {
    const notes = humNotes(get())
    if (!notes.length) return
    const engine = await useTransportStore.getState().ensureAudio()
    const seconds = engine.previewNotes(notes, get().settings.bpm, get().settings.instrument)
    set({ previewing: true })
    setTimeout(() => set({ previewing: false }), seconds * 1000)
  },

  stopPreview() {
    peekEngine()?.stopPreview()
    set({ previewing: false })
  },

  async addToProject({ setTempo = true } = {}) {
    const { take, settings, transcription } = get()
    const notes = toBeatNotes(humNotes(get()))
    if (!take || !notes.length) return null
    const projects = useProjectStore.getState()
    if (!projects.current) {
      // A new project takes the melody's key when the estimate is reasonably sure.
      const key =
        transcription && transcription.key.confidence >= 0.3
          ? { root: transcription.key.root, mode: transcription.key.mode }
          : undefined
      await projects.createProject({
        name: 'Hummed melody',
        template: 'empty',
        bpm: settings.bpm,
        key,
      })
    }
    const current = useProjectStore.getState().current
    if (!current) return null
    const presetName = { lead: 'Lead', pluck: 'Pluck', keys: 'Keys' }[settings.instrument]
    let trackId: string | null = null
    useProjectStore.getState().updateDocument((doc) => {
      const { doc: next, trackId: id } = addMelodyTrack(doc, {
        notes,
        preset: settings.instrument,
        name: `Hum (${presetName})`,
        asset: assetForTake(take),
      })
      trackId = id
      return setTempo ? { ...next, bpm: settings.bpm } : next
    })
    return trackId
  },

  async buildBeat() {
    const { take, settings, prompt, mode } = get()
    const notes = toBeatNotes(humNotes(get()))
    if (!take || !notes.length) return false
    set({ building: true, error: null })
    try {
      const res = await api.generateBeat({
        prompt,
        bpm: settings.bpm,
        melody: {
          notes: notes as [BeatNote, ...BeatNote[]],
          instrument: settings.instrument,
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
    const { settings } = get()
    const notes = toBeatNotes(humNotes(get()))
    if (!notes.length) return
    const doc: ProjectDocument = {
      schemaVersion: 1,
      id: 'prj_hum_export',
      name: 'Hummed melody',
      bpm: settings.bpm,
      key: { root: 'C', mode: 'major' },
      timeSignature: { numerator: 4, denominator: 4 },
      tracks: [],
      patterns: [],
      clips: [],
      sections: [],
      assets: [],
      aiHistory: [],
    }
    const { doc: withMelody } = addMelodyTrack(doc, {
      notes,
      preset: settings.instrument,
      name: 'Melody',
    })
    try {
      downloadBlob(await api.exportMidi(withMelody), `${safeFileName('Hummed melody')}.mid`)
    } catch (e) {
      set({ error: message(e) })
    }
  },
}))
