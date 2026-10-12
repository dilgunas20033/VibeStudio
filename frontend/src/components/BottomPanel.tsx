import { useUiStore, type BottomTab } from '../store/uiStore'
import { ChannelRack } from './ChannelRack'
import { PianoRoll } from './PianoRoll'
import { ProjectSettings } from './ProjectSettings'

const TABS: { id: BottomTab; label: string }[] = [
  { id: 'rack', label: 'Channel rack' },
  { id: 'piano', label: 'Piano roll' },
  { id: 'project', label: 'Project' },
]

export function BottomPanel() {
  const tab = useUiStore((s) => s.bottomTab)
  const setTab = useUiStore((s) => s.setBottomTab)
  return (
    <section className="flex h-[48%] min-h-64 shrink-0 flex-col border-t border-line bg-surface-1">
      <div role="tablist" className="flex h-8 shrink-0 items-end gap-1 border-b border-line px-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-t-md px-3 py-1 text-xs font-medium ${
              tab === t.id ? 'bg-surface-2 text-ink' : 'text-ink-dim hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="flex min-h-0 flex-1 flex-col overflow-auto">
        {tab === 'rack' && <ChannelRack />}
        {tab === 'piano' && <PianoRoll />}
        {tab === 'project' && <ProjectSettings />}
      </div>
    </section>
  )
}
