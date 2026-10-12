import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import {
  addNote,
  addSectionClip,
  clipAt,
  patternUsage,
  quantizePattern,
  removeNotes,
  setPatternBars,
  updateNotes,
} from '../project/edit'
import { beatsPerBar, isInScale, noteName, STEPS_PER_BEAT } from '../project/music'
import { synthPreset } from '../project/presets'
import { useProjectStore } from '../store/projectStore'
import { useTransportStore } from '../store/transportStore'
import { useUiStore } from '../store/uiStore'
import type { Clip, Pattern, ProjectDocument, Track } from '../types/project.generated'
import { Playhead } from './Playhead'
import { Button, Select } from './ui'

const STEP_W = 22
const ROW_H = 14
const MIN_ROWS = 36 // three octaves
const KEYS_W = 48
const LOW_CONFIDENCE = 0.5
const LENGTHS = [
  { label: '1/16', beats: 0.25 },
  { label: '1/8', beats: 0.5 },
  { label: '1/4', beats: 1 },
  { label: '1/2', beats: 2 },
  { label: '1/1', beats: 4 },
]

/** Picks the synth track to edit, then renders the editor for it. */
export function PianoRoll() {
  const doc = useProjectStore((s) => s.current?.document)
  const selectedId = useUiStore((s) => s.selectedTrackId)
  const focusBeat = useUiStore((s) => s.focusBeat)
  const update = useProjectStore((s) => s.updateDocument)

  if (!doc) return null
  const synths = doc.tracks.filter((t) => t.kind === 'instrument')
  const track = synths.find((t) => t.id === selectedId) ?? synths[0]
  if (!track) {
    return (
      <p className="p-4 text-xs text-ink-faint">No synth tracks. Use “+ Add track” to add one.</p>
    )
  }
  const clip = clipAt(doc, track.id, focusBeat)
  const pattern = doc.patterns.find((p) => p.id === clip?.patternId)
  if (!clip || !pattern) {
    return (
      <div className="flex items-center gap-3 p-4 text-xs text-ink-faint">
        {track.name} is silent in this section.
        <button
          type="button"
          className="rounded border border-dashed border-line px-2 py-0.5 text-ink-dim hover:border-accent hover:text-ink"
          onClick={() => update((d) => addSectionClip(d, track.id, focusBeat))}
        >
          + Add pattern here
        </button>
      </div>
    )
  }
  return (
    <PianoRollEditor
      key={pattern.id}
      doc={doc}
      track={track}
      clip={clip}
      pattern={pattern}
      synths={synths}
    />
  )
}

function PianoRollEditor({
  doc,
  track,
  clip,
  pattern,
  synths,
}: {
  doc: ProjectDocument
  track: Track
  clip: Clip
  pattern: Pattern
  synths: Track[]
}) {
  const update = useProjectStore((s) => s.updateDocument)
  const preview = useTransportStore((s) => s.preview)
  const selectTrack = useUiStore((s) => s.selectTrack)
  const [noteBeats, setNoteBeats] = useState(0.5)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const scroller = useRef<HTMLDivElement>(null)
  const surface = useRef<HTMLDivElement>(null)

  const perBar = beatsPerBar(doc.timeSignature)
  const steps = Math.round(pattern.lengthBeats * STEPS_PER_BEAT)
  // The visible range grows to include every note (hummed melodies can sit anywhere).
  const notePitches = pattern.notes.map((n) => n.pitch)
  const presetLow = synthPreset(track.role)?.rangeLow ?? 48
  const low = Math.max(0, Math.min(presetLow, ...notePitches.map((p) => p - 2)))
  const top = Math.min(127, Math.max(low + MIN_ROWS - 1, ...notePitches.map((p) => p + 2)))
  const rows = top - low + 1
  const pitches = Array.from({ length: rows }, (_, i) => top - i)
  const pxPerBeat = STEP_W * STEPS_PER_BEAT
  const live = new Set(pattern.notes.map((n) => n.id))
  const sel = new Set([...selected].filter((id) => live.has(id)))
  const uncertain = pattern.notes.filter((n) => (n.confidence ?? 1) < LOW_CONFIDENCE).length

  // When a pattern opens, scroll so its notes (or the lower octave if empty) are in view.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const center = notePitches.length
      ? notePitches.reduce((a, b) => a + b, 0) / notePitches.length
      : low + 12
    el.scrollTop = (top - center) * ROW_H - el.clientHeight / 2
    // Only when the pattern changes; re-centering on every edit would make the grid jump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const edit = (change: Parameters<typeof updateNotes>[3]) =>
    update((d) => updateNotes(d, pattern.id, sel, change))

  function onGridDown(e: PointerEvent<HTMLDivElement>) {
    surface.current?.focus()
    const rect = e.currentTarget.getBoundingClientRect()
    const step = Math.floor((e.clientX - rect.left) / STEP_W)
    const pitch = top - Math.floor((e.clientY - rect.top) / ROW_H)
    if (step < 0 || step >= steps || pitch < low || pitch > top) return
    setSelected(new Set())
    update((d) =>
      addNote(d, pattern.id, { pitch, startBeat: step / STEPS_PER_BEAT, durationBeats: noteBeats }),
    )
    void preview(track.id, pitch)
  }

  function onNoteDown(e: PointerEvent<HTMLDivElement>, id: string, pitch: number) {
    e.stopPropagation()
    surface.current?.focus()
    const next = new Set(e.shiftKey || e.ctrlKey || e.metaKey ? sel : [])
    if (next.has(id) && (e.shiftKey || e.ctrlKey || e.metaKey)) next.delete(id)
    else next.add(id)
    setSelected(next)
    void preview(track.id, pitch)
  }

  function onNoteDouble(e: MouseEvent<HTMLDivElement>, id: string) {
    e.stopPropagation()
    update((d) => removeNotes(d, pattern.id, new Set([id])))
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      setSelected(new Set(pattern.notes.map((n) => n.id)))
      return
    }
    if (e.key === 'Escape') return setSelected(new Set())
    if (sel.size === 0) return
    const move = noteBeats
    const handlers: Record<string, () => void> = {
      Delete: () => update((d) => removeNotes(d, pattern.id, sel)),
      Backspace: () => update((d) => removeNotes(d, pattern.id, sel)),
      ArrowUp: () => edit((n) => ({ pitch: n.pitch + (e.shiftKey ? 12 : 1) })),
      ArrowDown: () => edit((n) => ({ pitch: n.pitch - (e.shiftKey ? 12 : 1) })),
      ArrowLeft: () => edit((n) => ({ startBeat: Math.max(0, n.startBeat - move) })),
      ArrowRight: () => edit((n) => ({ startBeat: n.startBeat + move })),
      ']': () => edit((n) => ({ durationBeats: n.durationBeats + move })),
      '[': () => edit((n) => ({ durationBeats: Math.max(move, n.durationBeats - move) })),
    }
    const handler = handlers[e.key]
    if (handler) {
      e.preventDefault()
      e.stopPropagation()
      handler()
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-1.5 text-[11px] text-ink-dim">
        <label className="flex items-center gap-1.5">
          Track
          <Select
            aria-label="Piano roll track"
            className="w-32"
            value={track.id}
            onChange={(e) => selectTrack(e.target.value)}
          >
            {synths.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-1.5 whitespace-nowrap">
          Grid
          <Select
            aria-label="Note length"
            className="w-20"
            value={noteBeats}
            onChange={(e) => setNoteBeats(Number(e.target.value))}
          >
            {LENGTHS.map((l) => (
              <option key={l.label} value={l.beats}>
                {l.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-1.5">
          Pattern
          <Select
            aria-label="Pattern length"
            className="w-20"
            value={Math.round(pattern.lengthBeats / perBar)}
            onChange={(e) => update((d) => setPatternBars(d, pattern.id, Number(e.target.value)))}
          >
            {[...new Set([1, 2, 4, 8, 16, Math.round(pattern.lengthBeats / perBar)])].map((n) => (
              <option key={n} value={n}>
                {n} bar{n > 1 ? 's' : ''}
              </option>
            ))}
          </Select>
        </label>
        <Button
          className="h-6"
          title="Snap note starts and lengths to the grid (selected notes, or all)"
          onClick={() =>
            update((d) => quantizePattern(d, pattern.id, noteBeats, sel.size ? sel : undefined))
          }
        >
          Quantize{sel.size ? ` (${sel.size})` : ''}
        </Button>
        {sel.size > 0 && (
          <Button
            className="h-6"
            variant="danger"
            onClick={() => update((d) => removeNotes(d, pattern.id, sel))}
          >
            Delete ({sel.size})
          </Button>
        )}
        <span
          className="truncate text-ink-faint"
          title="Editing this pattern changes every clip that uses it"
        >
          {pattern.name}
          {patternUsage(doc, pattern.id) > 1 && ` · used ${patternUsage(doc, pattern.id)}×`}
          {uncertain > 0 && <span className="text-warn"> · {uncertain} uncertain</span>}
        </span>
        <span
          className="ml-auto shrink-0 text-ink-faint"
          title="Keyboard: arrows move, Shift+↑↓ octave, [ ] length, Delete removes, Ctrl+A selects all"
        >
          Click grid: add · click note: select · double-click: delete · ←→↑↓ [ ] Del
        </span>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
        <div className="relative flex" style={{ width: KEYS_W + steps * STEP_W }}>
          <div className="sticky left-0 z-20 shrink-0 bg-surface-1" style={{ width: KEYS_W }}>
            {pitches.map((p) => (
              <button
                type="button"
                key={p}
                onClick={() => void preview(track.id, p)}
                className={`block w-full border-b border-line/60 pr-1 text-right font-mono text-[9px] ${
                  noteName(p).includes('#')
                    ? 'bg-surface-0 text-ink-faint'
                    : 'bg-surface-3 text-ink-dim'
                }`}
                style={{ height: ROW_H }}
              >
                {p % 12 === 0 ? noteName(p) : ''}
              </button>
            ))}
          </div>
          <div
            ref={surface}
            tabIndex={0}
            aria-label="Piano roll notes"
            data-testid="piano-grid"
            className="relative cursor-crosshair outline-none focus-visible:ring-1 focus-visible:ring-accent/50"
            style={{
              width: steps * STEP_W,
              height: rows * ROW_H,
              backgroundImage: `repeating-linear-gradient(90deg, var(--color-line) 0 1px, transparent 1px ${pxPerBeat}px), repeating-linear-gradient(90deg, #ffffff08 0 1px, transparent 1px ${STEP_W}px)`,
            }}
            onPointerDown={onGridDown}
            onKeyDown={onKey}
          >
            {pitches.map((p, i) => (
              <div
                key={p}
                className={`pointer-events-none absolute left-0 w-full border-b border-line/40 ${
                  isInScale(p, doc.key) ? 'bg-surface-2/60' : 'bg-surface-0/60'
                }`}
                style={{ top: i * ROW_H, height: ROW_H }}
              />
            ))}
            {pattern.notes
              .filter((n) => n.startBeat < pattern.lengthBeats)
              .map((n) => {
                const isSel = sel.has(n.id)
                const low = (n.confidence ?? 1) < LOW_CONFIDENCE
                const conf =
                  n.confidence !== null ? `, ${Math.round(n.confidence * 100)}% confident` : ''
                return (
                  <div
                    key={n.id}
                    role="button"
                    aria-label={`Note ${noteName(n.pitch)} at beat ${n.startBeat + 1}${conf}`}
                    aria-pressed={isSel}
                    title={low ? 'Uncertain detection: check this note' : undefined}
                    onPointerDown={(e) => onNoteDown(e, n.id, n.pitch)}
                    onDoubleClick={(e) => onNoteDouble(e, n.id)}
                    className={`absolute rounded-[3px] border hover:brightness-125 ${
                      isSel ? 'border-white ring-1 ring-white' : 'border-black/30'
                    } ${low ? 'border-dashed !border-warn opacity-60' : ''}`}
                    style={{
                      left: n.startBeat * pxPerBeat,
                      top: (top - n.pitch) * ROW_H + 1,
                      width: Math.max(4, n.durationBeats * pxPerBeat - 1),
                      height: ROW_H - 2,
                      background: track.color,
                    }}
                  />
                )
              })}
            <Playhead
              pxPerBeat={pxPerBeat}
              wrapBeats={pattern.lengthBeats}
              originBeat={clip.startBeat}
              endBeat={clip.startBeat + clip.lengthBeats}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
