import type { MusicalKey, TimeSignature } from '../types/project.generated'
import { useProjectStore } from '../store/projectStore'
import { BPM_MAX, BPM_MIN } from '../lib/tempo'
import { Button, Field, NumberInput, Panel, Select, TextInput } from './ui'

const ROOTS: MusicalKey['root'][] = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
]
const DENOMINATORS: TimeSignature['denominator'][] = [2, 4, 8, 16]

export function ProjectSettings() {
  const current = useProjectStore((s) => s.current)
  const update = useProjectStore((s) => s.updateDocument)
  const restore = useProjectStore((s) => s.restoreRevision)
  const busy = useProjectStore((s) => s.busy)
  if (!current) return null
  const doc = current.document

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Panel title="Project settings">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <TextInput
              value={doc.name}
              maxLength={120}
              onChange={(e) => update((d) => ({ ...d, name: e.target.value }))}
              onBlur={(e) => {
                if (!e.target.value.trim()) update((d) => ({ ...d, name: 'Untitled' }))
              }}
            />
          </Field>
          <Field label="Tempo (BPM)">
            <NumberInput
              min={BPM_MIN}
              max={BPM_MAX}
              value={doc.bpm}
              onCommit={(bpm) => update((d) => ({ ...d, bpm }))}
            />
          </Field>
          <Field label="Key">
            <div className="flex gap-1.5">
              <Select
                aria-label="Key root"
                value={doc.key.root}
                onChange={(e) =>
                  update((d) => ({
                    ...d,
                    key: { ...d.key, root: e.target.value as MusicalKey['root'] },
                  }))
                }
              >
                {ROOTS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </Select>
              <Select
                aria-label="Key mode"
                value={doc.key.mode}
                onChange={(e) =>
                  update((d) => ({
                    ...d,
                    key: { ...d.key, mode: e.target.value as MusicalKey['mode'] },
                  }))
                }
              >
                <option value="major">major</option>
                <option value="minor">minor</option>
              </Select>
            </div>
          </Field>
          <Field label="Time signature">
            <div className="flex items-center gap-1.5">
              <NumberInput
                aria-label="Beats per bar"
                min={1}
                max={32}
                integer
                value={doc.timeSignature.numerator}
                onCommit={(numerator) =>
                  update((d) => ({ ...d, timeSignature: { ...d.timeSignature, numerator } }))
                }
              />
              <span className="text-ink-faint">/</span>
              <Select
                aria-label="Beat unit"
                value={doc.timeSignature.denominator}
                onChange={(e) =>
                  update((d) => ({
                    ...d,
                    timeSignature: {
                      ...d.timeSignature,
                      denominator: Number(e.target.value) as TimeSignature['denominator'],
                    },
                  }))
                }
              >
                {DENOMINATORS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </div>
          </Field>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-xs">
          {[
            ['Tracks', doc.tracks.length],
            ['Patterns', doc.patterns.length],
            ['Clips', doc.clips.length],
          ].map(([k, v]) => (
            <div key={k} className="rounded-md bg-surface-2 px-2 py-1.5">
              <dt className="text-ink-faint">{k}</dt>
              <dd className="font-mono text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-ink-faint">
          Tempo, key and time signature apply to playback immediately. Changing the time signature
          does not resize existing patterns.
        </p>
      </Panel>

      <Panel title="Revision history">
        <ol className="max-h-80 space-y-1 overflow-y-auto" aria-label="Revisions">
          {current.revisions.map((r) => (
            <li
              key={r.revision}
              className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-surface-2"
            >
              <div className="min-w-0">
                <div className="text-xs">
                  <span className="font-mono text-ink-dim">#{r.revision}</span>{' '}
                  {r.message ?? 'Saved'}
                  {r.revision === current.revision && (
                    <span className="ml-1 text-[10px] text-ok">current</span>
                  )}
                </div>
                <div className="text-[10px] text-ink-faint">
                  {new Date(r.createdAt).toLocaleString()}
                </div>
              </div>
              {r.revision !== current.revision && (
                <Button
                  className="h-6 shrink-0 px-1.5"
                  disabled={busy !== 'none'}
                  title="Load this revision into the editor. Nothing is overwritten until you save."
                  onClick={() => void restore(r.revision)}
                >
                  Load
                </Button>
              )}
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  )
}
