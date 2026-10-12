import { useState, type FormEvent } from 'react'
import { useProjectStore } from '../store/projectStore'
import type { ProjectTemplate } from '../types/api'
import { Button, Select, TextInput } from './ui'

const TEMPLATES: { id: ProjectTemplate; label: string }[] = [
  { id: 'starter', label: 'Starter kit (empty patterns)' },
  { id: 'demo', label: 'Demo beat (drums, bass, melody)' },
  { id: 'empty', label: 'Empty (no tracks)' },
]

export function ProjectBrowser() {
  const projects = useProjectStore((s) => s.projects)
  const currentId = useProjectStore((s) => s.current?.document.id)
  const busy = useProjectStore((s) => s.busy)
  const createProject = useProjectStore((s) => s.createProject)
  const openProject = useProjectStore((s) => s.openProject)
  const deleteProject = useProjectStore((s) => s.deleteProject)

  const [name, setName] = useState('')
  const [template, setTemplate] = useState<ProjectTemplate>('starter')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    await createProject({ name: trimmed, template })
    setName('')
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line p-3">
        <form onSubmit={onCreate} className="flex flex-col gap-1.5">
          <div className="flex gap-1.5">
            <TextInput
              aria-label="New project name"
              placeholder="New project name"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" variant="primary" disabled={!name.trim() || busy !== 'none'}>
              Create
            </Button>
          </div>
          <Select
            aria-label="Project template"
            value={template}
            onChange={(e) => setTemplate(e.target.value as ProjectTemplate)}
          >
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </form>
      </div>
      <ul className="flex-1 overflow-y-auto p-1.5" aria-label="Project list">
        {projects.length === 0 && (
          <li className="px-2 py-6 text-center text-xs text-ink-faint">No projects yet.</li>
        )}
        {projects.map((p) => (
          <li key={p.id} className="group">
            <div
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${
                p.id === currentId ? 'bg-accent/15 text-ink' : 'text-ink-dim hover:bg-surface-2'
              }`}
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => void openProject(p.id)}
              >
                <div className="truncate text-xs font-medium text-ink">{p.name}</div>
                <div className="font-mono text-[10px] text-ink-faint">
                  {p.bpm} BPM · {p.trackCount} tracks · rev {p.revision}
                </div>
              </button>
              {confirmDelete === p.id ? (
                <span className="flex gap-1">
                  <Button
                    variant="danger"
                    className="h-6 px-1.5"
                    onClick={() => {
                      setConfirmDelete(null)
                      void deleteProject(p.id)
                    }}
                  >
                    Delete
                  </Button>
                  <Button className="h-6 px-1.5" onClick={() => setConfirmDelete(null)}>
                    Keep
                  </Button>
                </span>
              ) : (
                <button
                  type="button"
                  aria-label={`Delete ${p.name}`}
                  className="hidden rounded px-1 text-ink-faint group-hover:block hover:text-danger focus:block"
                  onClick={() => setConfirmDelete(p.id)}
                >
                  ✕
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
