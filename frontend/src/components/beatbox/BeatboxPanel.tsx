import { useState } from 'react'
import { BPM_MAX, BPM_MIN } from '../../lib/tempo'
import type { ClassChoice, DetectedDrum } from '../../project/drums'
import { beatboxHits, useBeatboxStore } from '../../store/beatboxStore'
import { useProjectStore } from '../../store/projectStore'
import { useUiStore } from '../../store/uiStore'
import { PlanCard } from '../generator/PlanCard'
import { TakeRecorder } from '../hum/TakeRecorder'
import { Button, Field, NumberInput, Select } from '../ui'
import { DrumGridPreview } from './DrumGridPreview'
import { HitStrip } from './HitStrip'

const GRIDS = [
  { label: 'Off', value: 0 },
  { label: '1/16', value: 0.25 },
  { label: '1/8', value: 0.5 },
  { label: '1/4', value: 1 },
]
const DETECTED: { id: DetectedDrum; label: string }[] = [
  { id: 'kick', label: 'Kick' },
  { id: 'snare', label: 'Snare' },
  { id: 'hihat', label: 'Hi-hat' },
  { id: 'openhat', label: 'Open hat' },
  { id: 'perc', label: 'Perc' },
]
const SOUNDS: { id: ClassChoice; label: string }[] = [
  { id: 'kick', label: 'Kick' },
  { id: 'snare', label: 'Snare' },
  { id: 'clap', label: 'Clap' },
  { id: 'hihat', label: 'Hi-hat' },
  { id: 'openhat', label: 'Open hat' },
  { id: 'perc', label: 'Perc' },
  { id: 'ignore', label: 'Ignore' },
]
const pct = (v: number) => `${Math.round(v * 100)}%`

/** "Beatbox to drums": record, check and correct the detected hits, then use the groove. */
export function BeatboxPanel() {
  const status = useBeatboxStore((s) => s.status)
  const error = useBeatboxStore((s) => s.error)
  const take = useBeatboxStore((s) => s.take)
  const transcription = useBeatboxStore((s) => s.transcription)
  const settings = useBeatboxStore((s) => s.settings)
  const overrides = useBeatboxStore((s) => s.overrides)
  const mapping = useBeatboxStore((s) => s.mapping)
  const previewing = useBeatboxStore((s) => s.previewing)
  const prompt = useBeatboxStore((s) => s.prompt)
  const mode = useBeatboxStore((s) => s.mode)
  const building = useBeatboxStore((s) => s.building)
  const plan = useBeatboxStore((s) => s.plan)
  const store = useBeatboxStore.getState()
  const project = useProjectStore((s) => s.current?.document)
  const focus = useUiStore((s) => s.focus)
  const [setTempo, setSetTempo] = useState(true)

  const hits = beatboxHits({ transcription, settings, overrides, mapping })
  const counts = new Map<string, number>()
  for (const h of hits) counts.set(h.drum, (counts.get(h.drum) ?? 0) + 1)
  const detectedClasses = new Set(transcription?.hits.map((h) => h.drum))

  return (
    <div className="flex flex-col gap-3 p-3" aria-label="Beatbox to drums">
      <p className="text-[11px] leading-relaxed text-ink-dim">
        Beatbox a simple groove: “b” or “boom” for kicks, “k” or “psh” for snares, “t” or “ts” for
        hats. Hits are sorted by how they sound, not by AI, so check them and click any marker to
        fix it.
      </p>
      <TakeRecorder store={useBeatboxStore} />
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {take && !transcription && (
        <div className="flex items-center gap-2">
          <audio src={take.url} controls className="h-7 min-w-0 flex-1" aria-label="Play take" />
        </div>
      )}

      {status === 'review' && transcription && take && (
        <>
          <HitStrip
            transcription={transcription}
            peaks={take.peaks}
            seconds={take.seconds}
            overrides={overrides}
            mapping={mapping}
            onCycle={store.cycleHit}
          />
          <div className="flex items-center gap-2">
            <audio src={take.url} controls className="h-7 min-w-0 flex-1" aria-label="Play take" />
            <Button onClick={store.retake}>Retake</Button>
          </div>
          <div className="text-[11px] text-ink-dim" data-testid="beatbox-summary">
            {hits.length} hits ·{' '}
            {[...counts].map(([d, n]) => `${n} ${d}`).join(', ') || 'none kept'}
          </div>
          {transcription.warnings.map((w) => (
            <p key={w} className="text-[11px] text-warn">
              {w}
            </p>
          ))}
          <DrumGridPreview hits={hits} />

          <div className="grid grid-cols-2 gap-2">
            <Field label={`Tempo (${pct(transcription.tempo.confidence)} sure)`}>
              <div className="flex gap-1">
                <NumberInput
                  aria-label="Beatbox tempo"
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
                aria-label="Beatbox grid"
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
                aria-label="Beatbox snap strength"
                min={0}
                max={1}
                step={0.05}
                value={settings.strength}
                disabled={settings.grid === 0}
                onChange={(e) => store.updateSettings({ strength: Number(e.target.value) })}
                className="accent-accent"
              />
            </Field>
          </div>

          <fieldset className="rounded-md border border-line p-2">
            <legend className="px-1 text-[11px] font-medium tracking-wide text-ink-dim uppercase">
              Sounds
            </legend>
            <div className="grid grid-cols-1 gap-1.5">
              {DETECTED.filter((d) => detectedClasses.has(d.id)).map((d) => (
                <label key={d.id} className="flex items-center gap-1.5 text-[11px] text-ink-dim">
                  <span className="w-20 shrink-0">{d.label} plays</span>
                  <Select
                    aria-label={`Sound for ${d.label}`}
                    value={mapping[d.id]}
                    onChange={(e) => store.setMapping(d.id, e.target.value as ClassChoice)}
                  >
                    {SOUNDS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap gap-1.5">
            <Button
              disabled={!hits.length}
              onClick={() => void (previewing ? store.stopPreview() : store.preview())}
            >
              {previewing ? 'Stop preview' : 'Preview'}
            </Button>
            <Button disabled={!hits.length} onClick={() => void store.downloadMidi()}>
              Download MIDI
            </Button>
          </div>

          <section className="flex flex-col gap-2 rounded-md border border-line bg-surface-2/40 p-2">
            <span className="text-[11px] font-semibold tracking-wide text-ink-dim uppercase">
              Use this groove
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
              disabled={!hits.length}
              onClick={async () => {
                const ids = await store.addToProject({ setTempo })
                if (ids.length) focus(0, ids[0]!, 'rack')
              }}
            >
              {project ? 'Add as drum tracks to this project' : 'Create a project with this groove'}
            </Button>
            <textarea
              aria-label="Beat description for the groove"
              value={prompt}
              maxLength={1000}
              rows={3}
              placeholder="Make this a dark boom bap beat with dusty keys and a deep bass."
              onChange={(e) => store.setPrompt(e.target.value)}
              className="resize-none rounded-md border border-line bg-surface-0 p-2 text-xs text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
            <div
              className="flex gap-3 text-[11px] text-ink-dim"
              role="radiogroup"
              aria-label="Groove handling"
            >
              {(['expand', 'keep'] as const).map((m) => (
                <label key={m} className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="groove-mode"
                    checked={mode === m}
                    onChange={() => store.setMode(m)}
                  />
                  {m === 'expand' ? 'Expand it (hats, fills, variation)' : 'Keep it exactly'}
                </label>
              ))}
            </div>
            <Button
              variant="primary"
              className="justify-center"
              disabled={!hits.length || building}
              onClick={async () => {
                if (await store.expand()) focus(0, null, 'rack')
              }}
            >
              {building ? 'Building…' : 'Build a beat around it'}
            </Button>
            <p className="text-[10px] text-ink-faint">
              Your groove plays in the hook. Expansion and the other parts are written by the
              procedural composer.
            </p>
          </section>
          {plan && <PlanCard plan={plan} generated />}
        </>
      )}
    </div>
  )
}
