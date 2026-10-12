import { useState } from 'react'
import { api } from '../api/client'
import { renderLoopWav } from '../audio'
import { downloadBlob, safeFileName } from '../lib/download'
import { useProjectStore } from '../store/projectStore'
import { useUiStore } from '../store/uiStore'

type Job = 'wav' | 'midi' | 'midi-track'

/** Export the song as WAV (rendered in the browser) or MIDI (written by the backend). */
export function ExportMenu() {
  const doc = useProjectStore((s) => s.current?.document)
  const selectedId = useUiStore((s) => s.selectedTrackId)
  const [busy, setBusy] = useState<Job | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const selected = doc?.tracks.find((t) => t.id === selectedId)

  async function run(job: Job) {
    if (!doc) return
    setOpen(false)
    setBusy(job)
    setMessage(null)
    const base = safeFileName(doc.name)
    try {
      if (job === 'wav') {
        const result = await renderLoopWav(doc)
        downloadBlob(new Blob([result.wav], { type: 'audio/wav' }), `${base}.wav`)
        console.info('[export] wav', { seconds: result.seconds, peak: result.peak })
        if (result.peak < 1e-4) setMessage('Exported, but the song is silent.')
      } else {
        const ids = job === 'midi-track' && selected ? [selected.id] : undefined
        const blob = await api.exportMidi(doc, ids)
        const suffix = ids && selected ? ` - ${safeFileName(selected.name)}` : ''
        downloadBlob(blob, `${base}${suffix}.mid`)
      }
    } catch (e) {
      console.error('[export] failed', e)
      setMessage(`Export failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  const item =
    'block w-full px-3 py-1.5 text-left text-xs hover:bg-surface-3 disabled:text-ink-faint'
  return (
    <span className="relative flex items-center gap-2">
      {message && (
        <span role="status" className="max-w-56 truncate text-xs text-warn" title={message}>
          {message}
        </span>
      )}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!doc || busy !== null}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 text-xs font-medium hover:bg-surface-3 disabled:text-ink-faint"
      >
        {busy === 'wav' ? 'Rendering…' : busy ? 'Exporting…' : 'Export ▾'}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-8 right-0 z-50 w-56 overflow-hidden rounded-md border border-line bg-surface-2 py-1 shadow-xl"
          onMouseLeave={() => setOpen(false)}
        >
          <button role="menuitem" type="button" className={item} onClick={() => void run('wav')}>
            Audio (WAV, whole song)
          </button>
          <button role="menuitem" type="button" className={item} onClick={() => void run('midi')}>
            MIDI (all tracks)
          </button>
          <button
            role="menuitem"
            type="button"
            className={item}
            disabled={!selected}
            onClick={() => void run('midi-track')}
          >
            MIDI ({selected ? selected.name : 'select a track'})
          </button>
        </div>
      )}
    </span>
  )
}
