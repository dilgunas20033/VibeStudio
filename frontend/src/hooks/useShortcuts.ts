import { useEffect } from 'react'
import { isDirty, useProjectStore } from '../store/projectStore'
import { useTransportStore } from '../store/transportStore'

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

/** Global shortcuts: Space play/pause, Ctrl/Cmd+S save. Warns before leaving with unsaved work. */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        const s = useProjectStore.getState()
        if (isDirty(s.current) && s.busy === 'none') void s.saveProject()
        return
      }
      if (e.code === 'Space' && !isTyping(e.target) && !e.repeat) {
        e.preventDefault()
        void useTransportStore.getState().togglePlay()
      }
    }
    const onUnload = (e: BeforeUnloadEvent) => {
      if (isDirty(useProjectStore.getState().current)) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [])
}
