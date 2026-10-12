import { isDirty, useProjectStore } from '../store/projectStore'
import { useUiStore } from '../store/uiStore'
import { ExportMenu } from './ExportMenu'
import { TransportControls } from './TransportControls'
import { Button } from './ui'

export function TopBar() {
  const current = useProjectStore((s) => s.current)
  const busy = useProjectStore((s) => s.busy)
  const save = useProjectStore((s) => s.saveProject)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const dirty = isDirty(current)

  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-surface-1 px-3">
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label="Toggle project browser"
        className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-surface-2"
      >
        <div className="h-5 w-5 rounded bg-gradient-to-br from-accent to-fuchsia-500" aria-hidden />
        <span className="text-sm font-semibold tracking-tight">VibeStudio</span>
      </button>
      <div className="h-6 w-px bg-line" />
      {current ? (
        <>
          <div className="flex min-w-0 max-w-56 flex-col leading-tight">
            <span className="truncate font-medium" data-testid="project-title">
              {current.document.name}
            </span>
            <span className="text-[10px] text-ink-faint">
              {current.document.key.root} {current.document.key.mode} ·{' '}
              {current.document.timeSignature.numerator}/
              {current.document.timeSignature.denominator}
              {dirty && <span className="ml-1.5 text-warn">Unsaved changes</span>}
            </span>
          </div>
          <div className="flex flex-1 justify-center">
            <TransportControls />
          </div>
          <div className="flex items-center gap-2">
            <ExportMenu />
            <Button
              variant="primary"
              disabled={!dirty || busy === 'saving'}
              onClick={() => void save()}
              title="Save (Ctrl+S)"
            >
              {busy === 'saving' ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </>
      ) : (
        <span className="text-ink-faint">No project open</span>
      )}
    </header>
  )
}
