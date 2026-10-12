import { addTrack, type AddTrackSpec } from '../project/edit'
import { DRUM_PRESETS, SYNTH_PRESETS } from '../project/presets'
import { useProjectStore } from '../store/projectStore'
import { useUiStore } from '../store/uiStore'

export function AddTrackMenu() {
  const current = useProjectStore((s) => s.current)
  const update = useProjectStore((s) => s.updateDocument)
  const selectTrack = useUiStore((s) => s.selectTrack)

  function onPick(value: string) {
    const [kind, preset] = value.split(':')
    if (!current || !kind || !preset) return
    const result = addTrack(current.document, { kind, preset } as AddTrackSpec)
    update(() => result.doc)
    selectTrack(result.trackId, kind === 'drums' ? 'rack' : 'piano')
  }

  return (
    <select
      aria-label="Add track"
      value=""
      onChange={(e) => onPick(e.target.value)}
      className="h-6 w-full rounded border border-dashed border-line bg-transparent px-1 text-[11px] text-ink-dim hover:border-accent hover:text-ink"
    >
      <option value="" disabled>
        + Add track
      </option>
      <optgroup label="Drums">
        {DRUM_PRESETS.map((p) => (
          <option key={p.preset} value={`drums:${p.preset}`}>
            {p.name}
          </option>
        ))}
      </optgroup>
      <optgroup label="Synths">
        {SYNTH_PRESETS.map((p) => (
          <option key={p.preset} value={`instrument:${p.preset}`}>
            {p.name}
          </option>
        ))}
      </optgroup>
    </select>
  )
}
