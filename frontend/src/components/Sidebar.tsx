import { useUiStore, type SidebarTab } from '../store/uiStore'
import { GeneratePanel } from './generator/GeneratePanel'
import { BeatboxPanel } from './beatbox/BeatboxPanel'
import { HumPanel } from './hum/HumPanel'
import { ProjectBrowser } from './ProjectBrowser'

const TABS: { id: SidebarTab; label: string }[] = [
  { id: 'projects', label: 'Projects' },
  { id: 'generate', label: 'AI Beat' },
  { id: 'hum', label: 'Hum' },
  { id: 'beatbox', label: 'Beatbox' },
]

export function Sidebar() {
  const tab = useUiStore((s) => s.sidebarTab)
  const setTab = useUiStore((s) => s.setSidebarTab)
  return (
    <aside className="flex w-80 shrink-0 flex-col border-r border-line bg-surface-1">
      <div role="tablist" aria-label="Sidebar" className="flex border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 border-b-2 px-2 py-2 text-[11px] font-semibold tracking-wide uppercase ${
              tab === t.id
                ? 'border-accent text-ink'
                : 'border-transparent text-ink-dim hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'projects' && <ProjectBrowser />}
        {tab === 'generate' && <GeneratePanel />}
        {tab === 'hum' && <HumPanel />}
        {tab === 'beatbox' && <BeatboxPanel />}
      </div>
    </aside>
  )
}
