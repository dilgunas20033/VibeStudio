import { useState } from 'react'
import { BPM_MAX, BPM_MIN } from '../../lib/tempo'
import { humNotes, useHumStore, type HumInstrument } from '../../store/humStore'
import { useProjectStore } from '../../store/projectStore'
import { useUiStore } from '../../store/uiStore'
import { PlanCard } from '../generator/PlanCard'
import { Button, Field, NumberInput, Select } from '../ui'
import { TakeRecorder } from './TakeRecorder'
import { MelodyReview } from './MelodyReview'
import { Waveform } from './Waveform'

const GRIDS = [
  { label: 'Off', value: 0 },
  { label: '1/16', value: 0.25 },
  { label: '1/8', value: 0.5 },
  { label: '1/4', value: 1 },
]

const pct = (v: number) => `${Math.round(v * 100)}%`

/** "Hum a melody": record, review the detected notes, then use them. */
export function HumPanel() {
  const status = useHumStore((s) => s.status)
  const error = useHumStore((s) => s.error)
  const take = useHumStore((s) => s.take)
  const transcription = useHumStore((s) => s.transcription)
  const settings = useHumStore((s) => s.settings)
  const excluded = useHumStore((s) => s.excluded)
  const previewing = useHumStore((s) => s.previewing)
  const prompt = useHumStore((s) => s.prompt)
  const mode = useHumStore((s) => s.mode)
  const building = useHumStore((s) => s.building)
  const plan = useHumStore((s) => s.plan)
  const store = useHumStore.getState()
  const project = useProjectStore((s) => s.current?.document)
  const focus = useUiStore((s) => s.focus)
  const [setTempo, setSetTempo] = useState(true)

  const notes = humNotes({ transcription, settings, excluded })
  const uncertain = notes.filter((n) => (n.confidence ?? 1) < 0.5).length

  return (
    <div className="flex flex-col gap-3 p-3" aria-label="Hum a melody">
      <p className="text-[11px] leading-relaxed text-ink-dim">
        Hum or sing one note at a time (“da da da” works best). Notes are detected with pitch
        tracking, not AI, so check them before using them.
      </p>
      <TakeRecorder store={useHumStore} />
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}

      {take && (
        <div className="flex flex-col gap-1.5">
          <Waveform peaks={take.peaks} seconds={take.seconds} />
          <div className="flex items-center gap-2">
            <audio src={take.url} controls className="h-7 min-w-0 flex-1" aria-label="Play take" />
            <Button onClick={store.retake} title="Discard this take">
              Retake
            </Button>
          </div>
        </div>
      )}

      {status === 'review' && transcription && (
        <>
          <div className="text-[11px] text-ink-dim" data-testid="hum-summary">
            {notes.length} notes · key {transcription.key.root} {transcription.key.mode} (
            {pct(transcription.key.confidence)}) · tuning {transcription.tuningCents > 0 ? '+' : ''}
            {transcription.tuningCents} cents
            {uncertain > 0 && <span className="text-warn"> · {uncertain} uncertain</span>}
          </div>
          {transcription.warnings.map((w) => (
            <p key={w} className="text-[11px] text-warn">
              {w}
            </p>
          ))}
          <MelodyReview
            transcription={transcription}
            notes={notes}
            bpm={settings.bpm}
            transpose={settings.transpose}
            excluded={excluded}
            onToggle={store.toggleExcluded}
          />

          <div className="grid grid-cols-2 gap-2">
            <Field label={`Tempo (${pct(transcription.tempo.confidence)} sure)`}>
              <div className="flex gap-1">
                <NumberInput
                  aria-label="Hum tempo"
                  min={BPM_MIN}
                  max={BPM_MAX}
                  value={settings.bpm}
                  onCommit={(bpm) => store.updateSettings({ bpm })}
                />
                <Button
                  className="px-1.5"
                  title="Half time"
                  onClick={() => store.updateSettings({ bpm: Math.max(BPM_MIN, settings.bpm / 2) })}
                >
                  ÷2
                </Button>
                <Button
                  className="px-1.5"
                  title="Double time"
                  onClick={() => store.updateSettings({ bpm: Math.min(BPM_MAX, settings.bpm * 2) })}
                >
                  ×2
                </Button>
              </div>
            </Field>
            <Field label="Snap to grid">
              <Select
                aria-label="Hum grid"
                value={settings.grid}
                onChange={(e) => store.updateSettings({ grid: Number(e.target.value) })}
              >
                {GRIDS.map((g) => (
                  <option key={g.label} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`Snap strength ${pct(settings.strength)}`}>
              <input
                type="range"
                aria-label="Snap strength"
                min={0}
                max={1}
                step={0.05}
                value={settings.strength}
                disabled={settings.grid === 0}
                onChange={(e) => store.updateSettings({ strength: Number(e.target.value) })}
                className="accent-accent"
              />
            </Field>
            <Field label={`Hide below ${pct(settings.minConfidence)}`}>
              <input
                type="range"
                aria-label="Minimum confidence"
                min={0}
                max={0.9}
                step={0.05}
                value={settings.minConfidence}
                onChange={(e) => store.updateSettings({ minConfidence: Number(e.target.value) })}
                className="accent-accent"
              />
            </Field>
            <Field label={`Octave ${settings.transpose >= 0 ? '+' : ''}${settings.transpose / 12}`}>
              <div className="flex gap-1">
                <Button
                  aria-label="Octave down"
                  onClick={() => store.updateSettings({ transpose: settings.transpose - 12 })}
                >
                  −
                </Button>
                <Button
                  aria-label="Octave up"
                  onClick={() => store.updateSettings({ transpose: settings.transpose + 12 })}
                >
                  +
                </Button>
              </div>
            </Field>
            <Field label="Instrument">
              <Select
                aria-label="Melody instrument"
                value={settings.instrument}
                onChange={(e) =>
                  store.updateSettings({ instrument: e.target.value as HumInstrument })
                }
              >
                <option value="lead">Lead</option>
                <option value="pluck">Pluck</option>
                <option value="keys">Keys</option>
              </Select>
            </Field>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Button
              disabled={!notes.length}
              onClick={() => void (previewing ? store.stopPreview() : store.preview())}
            >
              {previewing ? 'Stop preview' : 'Preview'}
            </Button>
            <Button disabled={!notes.length} onClick={() => void store.downloadMidi()}>
              Download MIDI
            </Button>
          </div>

          <section className="flex flex-col gap-2 rounded-md border border-line bg-surface-2/40 p-2">
            <span className="text-[11px] font-semibold tracking-wide text-ink-dim uppercase">
              Use this melody
            </span>
            {project && project.bpm !== settings.bpm && (
              <label className="flex items-center gap-1.5 text-[11px] text-ink-dim">
                <input
                  type="checkbox"
                  checked={setTempo}
                  onChange={(e) => setSetTempo(e.target.checked)}
                />
                Set the project tempo to {settings.bpm} BPM (now {project.bpm})
              </label>
            )}
            <Button
              disabled={!notes.length}
              onClick={async () => {
                const trackId = await store.addToProject({ setTempo })
                if (trackId) focus(0, trackId, 'piano')
              }}
            >
              {project ? 'Add as a track to this project' : 'Create a project with this melody'}
            </Button>
            <textarea
              aria-label="Beat description for the melody"
              value={prompt}
              maxLength={1000}
              rows={3}
              placeholder="Turn this into a futuristic melodic trap beat with atmospheric synths and heavy bass."
              onChange={(e) => store.setPrompt(e.target.value)}
              className="resize-none rounded-md border border-line bg-surface-0 p-2 text-xs text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
            <div
              className="flex gap-3 text-[11px] text-ink-dim"
              role="radiogroup"
              aria-label="Melody handling"
            >
              {(['keep', 'vary'] as const).map((m) => (
                <label key={m} className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="melody-mode"
                    checked={mode === m}
                    onChange={() => store.setMode(m)}
                  />
                  {m === 'keep' ? 'Keep my notes exactly' : 'Also vary it in the verse'}
                </label>
              ))}
            </div>
            <Button
              variant="primary"
              className="justify-center"
              disabled={!notes.length || building}
              onClick={async () => {
                if (await store.buildBeat()) focus(0, null, 'rack')
              }}
            >
              {building ? 'Building…' : 'Build a beat around it'}
            </Button>
            <p className="text-[10px] text-ink-faint">
              The key and chords follow your melody. Music is written by the procedural composer.
            </p>
          </section>
          {plan && <PlanCard plan={plan} generated />}
        </>
      )}
    </div>
  )
}
