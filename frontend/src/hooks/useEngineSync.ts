import { useEffect } from 'react'
import { peekEngine } from '../audio'
import { useProjectStore } from '../store/projectStore'
import { useTransportStore } from '../store/transportStore'
import { useUiStore } from '../store/uiStore'

/**
 * Keep the audio engine in step with the open project. Every document change is
 * pushed to the engine (if loaded), so edits are heard immediately, even mid-playback.
 * Opening a different project or closing one stops playback, clears its audio and resets
 * the editors' focus.
 */
export function useEngineSync(): void {
  useEffect(() => {
    let lastId: string | undefined
    const unsubscribe = useProjectStore.subscribe((state, prev) => {
      const doc = state.current?.document
      if (doc === prev.current?.document) return
      const engine = peekEngine()
      if (doc?.id !== lastId) {
        useTransportStore.getState().stop()
        engine?.clear()
        useUiStore.getState().focus(0, null) // editors start at the top of the new project
        lastId = doc?.id
      }
      if (doc && engine) engine.sync(doc)
    })
    return () => {
      unsubscribe()
      useTransportStore.getState().stop()
      peekEngine()?.clear()
    }
  }, [])
}
