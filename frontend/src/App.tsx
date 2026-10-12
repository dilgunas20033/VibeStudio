import { useEffect } from 'react'
import { BottomPanel } from './components/BottomPanel'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { Timeline } from './components/Timeline'
import { TopBar } from './components/TopBar'
import { Button } from './components/ui'
import { useEngineSync } from './hooks/useEngineSync'
import { useShortcuts } from './hooks/useShortcuts'
import { useProjectStore } from './store/projectStore'
import { useTransportStore } from './store/transportStore'
import { useUiStore } from './store/uiStore'

const HEALTH_POLL_MS = 15_000

function Banner({ message, children }: { message: string; children?: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger"
    >
      <span className="flex-1">{message}</span>
      {children}
    </div>
  )
}

function Welcome() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold">Welcome to VibeStudio</h1>
        <p className="mt-2 text-xs text-ink-dim">
          Describe a beat in the AI Beat Generator, or create a project from the Projects tab. Pick
          “Demo beat” to hear a working loop right away, or “Starter kit” to program your own.
        </p>
      </div>
    </div>
  )
}

export default function App() {
  const current = useProjectStore((s) => s.current)
  const error = useProjectStore((s) => s.error)
  const conflictRevision = useProjectStore((s) => s.conflictRevision)
  const clearError = useProjectStore((s) => s.clearError)
  const openProject = useProjectStore((s) => s.openProject)
  const audioError = useTransportStore((s) => s.error)
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)

  useEngineSync()
  useShortcuts()

  useEffect(() => {
    const { checkHealth, refreshProjects } = useProjectStore.getState()
    void checkHealth()
    void refreshProjects()
    const timer = setInterval(() => void checkHealth(), HEALTH_POLL_MS)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      {error && (
        <Banner message={error}>
          {conflictRevision !== null && current && (
            <Button
              variant="danger"
              onClick={() => void openProject(current.document.id)}
              title="Discard local edits and load the newest saved revision"
            >
              Reload revision {conflictRevision}
            </Button>
          )}
          <Button onClick={clearError}>Dismiss</Button>
        </Banner>
      )}
      {audioError && <Banner message={audioError} />}
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && <Sidebar />}
        <main className="flex min-w-0 flex-1 flex-col">
          {current ? (
            <>
              <Timeline />
              <BottomPanel />
            </>
          ) : (
            <Welcome />
          )}
        </main>
      </div>
      <StatusBar />
    </div>
  )
}
