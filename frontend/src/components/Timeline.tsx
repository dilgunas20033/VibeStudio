import type { MouseEvent } from 'react'
import { collectEvents, type NoteEvent } from '../audio/schedule'
import { beatsPerBar, loopLengthBeats } from '../project/music'
import { useProjectStore } from '../store/projectStore'
import { useTransportStore } from '../store/transportStore'
import { useUiStore } from '../store/uiStore'
import type { ProjectDocument, Track } from '../types/project.generated'
import { AddTrackMenu } from './AddTrackMenu'
import { Playhead } from './Playhead'
import { TrackHeader } from './TrackHeader'

const HEADER_W = 208
const ROW_H = 44

function Ruler({ doc, px }: { doc: ProjectDocument; px: number }) {
  const seek = useTransportStore((s) => s.seek)
  const focus = useUiStore((s) => s.focus)
  const focusBeat = useUiStore((s) => s.focusBeat)
  const perBar = beatsPerBar(doc.timeSignature)
  const bars = Math.ceil(loopLengthBeats(doc) / perBar)
  const labelEvery = px * perBar < 28 ? 4 : 1
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left
    const beat = Math.floor(x / px / perBar) * perBar
    seek(beat)
    focus(beat)
  }
  return (
    <div className="border-b border-line bg-surface-1" style={{ width: bars * perBar * px }}>
      {doc.sections.length > 0 && (
        <div className="relative h-5 border-b border-line/60" aria-label="Song sections">
          {doc.sections.map((s) => {
            const active = focusBeat >= s.startBeat && focusBeat < s.startBeat + s.lengthBeats
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  seek(s.startBeat)
                  focus(s.startBeat)
                }}
                className={`absolute top-0.5 bottom-0.5 truncate rounded-sm border px-1 text-left text-[10px] font-medium ${
                  active
                    ? 'border-accent/70 bg-accent/25 text-ink'
                    : 'border-line bg-surface-2 text-ink-dim hover:text-ink'
                }`}
                style={{ left: s.startBeat * px + 1, width: s.lengthBeats * px - 2 }}
                title={`${s.name}: bars ${s.startBeat / perBar + 1}–${(s.startBeat + s.lengthBeats) / perBar}`}
              >
                {s.name}
              </button>
            )
          })}
        </div>
      )}
      <div
        className="relative h-6 cursor-pointer"
        onClick={onClick}
        title="Click to move the playhead"
      >
        {Array.from({ length: bars }, (_, i) =>
          i % labelEvery === 0 ? (
            <span
              key={i}
              className="absolute top-0 h-full border-l border-line pl-1 font-mono text-[10px] leading-6 text-ink-dim"
              style={{ left: i * perBar * px }}
            >
              {i + 1}
            </span>
          ) : null,
        )}
      </div>
    </div>
  )
}

/** One lane: clip blocks with a miniature of the notes they play. Click a clip to edit it. */
function Lane({
  doc,
  track,
  notes,
  px,
}: {
  doc: ProjectDocument
  track: Track
  notes: NoteEvent[]
  px: number
}) {
  const focus = useUiStore((s) => s.focus)
  const focusBeat = useUiStore((s) => s.focusBeat)
  const selected = useUiStore((s) => s.selectedTrackId === track.id)
  const perBar = beatsPerBar(doc.timeSignature)
  const length = loopLengthBeats(doc)
  const pitches = notes.map((n) => n.pitch)
  const lo = Math.min(...pitches)
  const span = Math.max(1, Math.max(...pitches) - lo)
  const tab = track.kind === 'drums' ? 'rack' : 'piano'
  return (
    <div className="relative h-full" style={{ width: length * px }}>
      {Array.from({ length: Math.ceil(length / perBar) }, (_, i) => (
        <div
          key={i}
          className="absolute top-0 h-full border-l border-line/60"
          style={{ left: i * perBar * px }}
        />
      ))}
      {doc.clips
        .filter((c) => c.trackId === track.id)
        .map((c) => {
          const focused =
            selected && focusBeat >= c.startBeat && focusBeat < c.startBeat + c.lengthBeats
          const pattern = doc.patterns.find((p) => p.id === c.patternId)
          return (
            <button
              key={c.id}
              type="button"
              aria-label={`Edit ${pattern?.name ?? 'clip'}`}
              onClick={() => focus(c.startBeat, track.id, tab)}
              className={`absolute top-1 bottom-1 overflow-hidden rounded border text-left ${
                focused ? 'ring-2 ring-ink/70' : ''
              }`}
              style={{
                left: c.startBeat * px,
                width: c.lengthBeats * px,
                background: `${track.color}22`,
                borderColor: `${track.color}88`,
              }}
            >
              {c.lengthBeats * px > 60 && (
                <span className="absolute top-0 left-1 text-[9px] text-ink-dim">
                  {pattern?.name}
                </span>
              )}
            </button>
          )
        })}
      {notes.map((n, i) => (
        <div
          key={i}
          className="pointer-events-none absolute h-[3px] rounded-sm"
          style={{
            left: n.beat * px,
            width: Math.max(1.5, n.durationBeats * px - 1),
            top:
              track.kind === 'drums'
                ? ROW_H / 2 - 2
                : 12 + (1 - (n.pitch - lo) / span) * (ROW_H - 20),
            background: track.color,
          }}
        />
      ))}
    </div>
  )
}

function ZoomControls() {
  const zoom = useUiStore((s) => s.zoom)
  const btn = 'h-5 w-5 rounded bg-surface-3 text-xs text-ink-dim hover:text-ink'
  return (
    <span className="ml-auto flex gap-1">
      <button type="button" aria-label="Zoom out" className={btn} onClick={() => zoom(-1)}>
        −
      </button>
      <button type="button" aria-label="Zoom in" className={btn} onClick={() => zoom(1)}>
        +
      </button>
    </span>
  )
}

export function Timeline() {
  const doc = useProjectStore((s) => s.current?.document)
  const selected = useUiStore((s) => s.selectedTrackId)
  const px = useUiStore((s) => s.pxPerBeat)
  if (!doc) return null
  const events = collectEvents(doc)

  return (
    <section aria-label="Timeline" className="min-h-0 flex-1 overflow-auto bg-surface-0">
      <div className="relative inline-block min-w-full">
        <div className="sticky top-0 z-20 flex">
          <div
            className="sticky left-0 z-30 flex shrink-0 items-end border-r border-b border-line bg-surface-1 px-2 pb-1"
            style={{ width: HEADER_W }}
          >
            <span className="text-[11px] font-semibold tracking-wide text-ink-dim uppercase">
              Tracks
            </span>
            <ZoomControls />
          </div>
          <Ruler doc={doc} px={px} />
        </div>
        {doc.tracks.map((t) => (
          <div
            key={t.id}
            className={`flex border-b border-line ${selected === t.id ? 'bg-surface-1' : ''}`}
            style={{ height: ROW_H }}
          >
            <div className="sticky left-0 z-10 shrink-0" style={{ width: HEADER_W }}>
              <TrackHeader track={t} />
            </div>
            <Lane doc={doc} track={t} notes={events.get(t.id) ?? []} px={px} />
          </div>
        ))}
        <div className="sticky left-0 p-2" style={{ width: HEADER_W }}>
          <AddTrackMenu />
        </div>
        {doc.tracks.length === 0 && (
          <p className="px-4 py-2 text-xs text-ink-faint">
            No tracks yet. Add a drum or synth track to start.
          </p>
        )}
        <Playhead pxPerBeat={px} offsetPx={HEADER_W} />
      </div>
    </section>
  )
}
