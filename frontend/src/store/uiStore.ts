import { create } from 'zustand'

export type BottomTab = 'rack' | 'piano' | 'project'
export type SidebarTab = 'projects' | 'generate' | 'hum' | 'beatbox'

export const ZOOM_LEVELS = [8, 12, 16, 24, 32, 40, 56] as const

interface UiState {
  selectedTrackId: string | null
  /**
   * Timeline position (beats) the editors focus on. The channel rack and piano roll
   * edit the clip under this position, so each song section can be edited separately.
   */
  focusBeat: number
  bottomTab: BottomTab
  sidebarOpen: boolean
  sidebarTab: SidebarTab
  /** Timeline zoom: pixels per beat. */
  pxPerBeat: number
  selectTrack: (id: string | null, tab?: BottomTab) => void
  focus: (beat: number, trackId?: string | null, tab?: BottomTab) => void
  setBottomTab: (tab: BottomTab) => void
  setSidebarTab: (tab: SidebarTab) => void
  toggleSidebar: () => void
  zoom: (direction: 1 | -1) => void
  setZoom: (pxPerBeat: number) => void
}

export const useUiStore = create<UiState>()((set, get) => ({
  selectedTrackId: null,
  focusBeat: 0,
  bottomTab: 'rack',
  sidebarOpen: true,
  sidebarTab: 'projects',
  pxPerBeat: 40,
  selectTrack: (id, tab) => set((s) => ({ selectedTrackId: id, bottomTab: tab ?? s.bottomTab })),
  focus: (beat, trackId, tab) =>
    set((s) => ({
      focusBeat: Math.max(0, beat),
      selectedTrackId: trackId === undefined ? s.selectedTrackId : trackId,
      bottomTab: tab ?? s.bottomTab,
    })),
  setBottomTab: (bottomTab) => set({ bottomTab }),
  setSidebarTab: (sidebarTab) => set({ sidebarTab, sidebarOpen: true }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  zoom: (direction) => {
    const levels: readonly number[] = ZOOM_LEVELS
    const i = levels.findIndex((l) => l >= get().pxPerBeat)
    const next =
      levels[Math.min(levels.length - 1, Math.max(0, (i < 0 ? levels.length - 1 : i) + direction))]
    set({ pxPerBeat: next ?? 40 })
  },
  setZoom: (pxPerBeat) => set({ pxPerBeat }),
}))
