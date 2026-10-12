import { addSectionClip, clipAt, patternUsage, setPatternBars, toggleStep } from '../project/edit'
import { beatToStep, beatsPerBar, STEPS_PER_BEAT } from '../project/music'
import { drumPreset } from '../project/presets'
import { useProjectStore } from '../store/projectStore'
import { useTransportStore } from '../store/transportStore'
import { useUiStore } from '../store/uiStore'
import type { ProjectDocument, Track } from '../types/project.generated'
import { Playhead } from './Playhead'

const BAR_CHOICES = [1, 2, 4]

function RackRow({
  doc,
  track,
  focusBeat,
}: {
  doc: ProjectDocument
  track: Track
  focusBeat: number
}) {
  const update = useProjectStore((s) => s.updateDocument)
  const preview = useTransportStore((s) => s.preview)
  const selected = useUiStore((s) => s.selectedTrackId === track.id)
  const selectTrack = useUiStore((s) => s.selectTrack)
  const clip = clipAt(doc, track.id, focusBeat)
  const pattern = doc.patterns.find((p) => p.id === clip?.patternId)
  const pitch = drumPreset(track.role)?.pitch ?? 36

  const name = (
    <button
      type="button"
      onClick={() => {
        selectTrack(track.id)
        void preview(track.id, pitch)
      }}
      className={`flex w-28 shrink-0 items-center gap-2 rounded-md border px-2 py-1 text-left text-xs ${
        selected ? 'border-accent/60 bg-surface-3' : 'border-line bg-surface-2 hover:bg-surface-3'
      }`}
      title="Click to hear this sound"
    >
      <span className="h-3 w-1 rounded-full" style={{ background: track.color }} />
      <span className="truncate">{track.name}</span>
    </button>
  )

  if (!clip || !pattern) {
    return (
      <div className="flex items-center gap-3 py-1 opacity-70">
        {name}
        <span className="text-[11px] text-ink-faint">Silent in this section.</span>
        <button
          type="button"
          className="rounded border border-dashed border-line px-2 py-0.5 text-[11px] text-ink-dim hover:border-accent hover:text-ink"
          onClick={() => update((d) => addSectionClip(d, track.id, focusBeat))}
        >
          + Add pattern here
        </button>
      </div>
    )
  }

  const perBar = beatsPerBar(doc.timeSignature)
  const steps = Math.round(pattern.lengthBeats * STEPS_PER_BEAT)
  const stepW = steps > 32 ? 20 : 26
  const counts = new Map<number, number>()
  for (const n of pattern.notes) {
    if (n.startBeat < pattern.lengthBeats) {
      const s = beatToStep(n.startBeat)
      counts.set(s, (counts.get(s) ?? 0) + 1)
    }
  }
  const bars = Math.round(pattern.lengthBeats / perBar)
  const shared = patternUsage(doc, pattern.id)

  return (
    <div className={`flex items-center gap-3 py-1 ${track.mixer.mute ? 'opacity-50' : ''}`}>
      {name}
      <select
        aria-label={`${track.name} pattern length`}
        value={bars}
        onChange={(e) => update((d) => setPatternBars(d, pattern.id, Number(e.target.value)))}
        className="h-6 rounded border border-line bg-surface-0 px-1 text-[11px] text-ink-dim"
        title={shared > 1 ? `Pattern “${pattern.name}” is used by ${shared} clips` : pattern.name}
      >
        {[...new Set([...BAR_CHOICES, bars])].map((n) => (
          <option key={n} value={n}>
            {n} bar{n > 1 ? 's' : ''}
          </option>
        ))}
      </select>
      <div className="relative flex" role="group" aria-label={`${track.name} steps`}>
        {Array.from({ length: steps }, (_, i) => {
          const hits = counts.get(i) ?? 0
          const on = hits > 0
          const beatShade = Math.floor(i / STEPS_PER_BEAT) % 2 === 0
          const barLine = i % (perBar * STEPS_PER_BEAT) === 0 && i > 0
          return (
            <div
              key={i}
              style={{ width: stepW }}
              className={`p-[2px] ${barLine ? 'border-l border-ink-faint/40' : ''}`}
            >
              <button
                type="button"
                aria-label={`${track.name} step ${i + 1}`}
                aria-pressed={on}
                title={hits > 1 ? `${hits} hits (roll)` : undefined}
                onClick={() => {
                  update((d) => toggleStep(d, track.id, i, focusBeat))
                  if (!on) void preview(track.id, pitch)
                }}
                className={`relative h-7 w-full rounded-[3px] border transition-colors ${
                  on
                    ? 'border-transparent'
                    : beatShade
                      ? 'border-line bg-surface-3 hover:bg-surface-3/70'
                      : 'border-line bg-surface-2 hover:bg-surface-3'
                }`}
                style={on ? { background: track.color } : undefined}
              >
                {hits > 1 && (
                  <span className="absolute right-0.5 bottom-0 text-[8px] font-bold text-surface-0">
                    {hits}
                  </span>
                )}
              </button>
            </div>
          )
        })}
        <Playhead
          pxPerBeat={stepW * STEPS_PER_BEAT}
          wrapBeats={pattern.lengthBeats}
          originBeat={clip.startBeat}
          endBeat={clip.startBeat + clip.lengthBeats}
        />
      </div>
    </div>
  )
}

export function ChannelRack() {
  const doc = useProjectStore((s) => s.current?.document)
  const focusBeat = useUiStore((s) => s.focusBeat)
  if (!doc) return null
  const drums = doc.tracks.filter((t) => t.kind === 'drums')
  if (drums.length === 0) {
    return (
      <p className="p-4 text-xs text-ink-faint">No drum tracks. Use “+ Add track” to add one.</p>
    )
  }
  return (
    <div className="overflow-auto p-3" aria-label="Channel rack">
      {drums.map((t) => (
        <RackRow key={t.id} doc={doc} track={t} focusBeat={focusBeat} />
      ))}
    </div>
  )
}
