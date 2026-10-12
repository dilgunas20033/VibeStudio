import { useGeneratorStore } from '../../store/generatorStore'
import { useUiStore } from '../../store/uiStore'
import { Button } from '../ui'
import { GeneratorSettings } from './GeneratorSettings'
import { PlanCard } from './PlanCard'

const EXAMPLE =
  'Dark melodic trap at 145 BPM with a dreamy lead, heavy 808s, rolling hi-hats and atmospheric pads.'

export function GeneratePanel() {
  const req = useGeneratorStore((s) => s.request)
  const status = useGeneratorStore((s) => s.status)
  const plan = useGeneratorStore((s) => s.plan)
  const generated = useGeneratorStore((s) => s.generated)
  const error = useGeneratorStore((s) => s.error)
  const update = useGeneratorStore((s) => s.update)
  const preview = useGeneratorStore((s) => s.preview)
  const generate = useGeneratorStore((s) => s.generate)
  const selectTrack = useUiStore((s) => s.selectTrack)
  const busy = status === 'interpreting' || status === 'generating'

  async function onGenerate() {
    if (await generate()) selectTrack(null, 'rack')
  }

  return (
    <div className="flex flex-col gap-3 p-3" aria-label="AI beat generator">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium tracking-wide text-ink-dim uppercase">
          Describe your beat
        </span>
        <textarea
          aria-label="Beat description"
          value={req.prompt ?? ''}
          maxLength={1000}
          rows={5}
          placeholder={EXAMPLE}
          onChange={(e) => update({ prompt: e.target.value })}
          className="resize-none rounded-md border border-line bg-surface-0 p-2 text-xs text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        <span className="self-end text-[10px] text-ink-faint">
          {(req.prompt ?? '').length}/1000
        </span>
      </label>

      <details className="rounded-md border border-line bg-surface-2/40 px-2 py-1.5">
        <summary className="cursor-pointer text-[11px] text-ink-dim">Settings (optional)</summary>
        <div className="pt-2">
          <GeneratorSettings />
        </div>
      </details>

      <div className="flex gap-1.5">
        <Button disabled={busy} onClick={() => void preview()} title="Show how the prompt is read">
          {status === 'interpreting' ? 'Reading…' : 'Preview'}
        </Button>
        <Button
          variant="primary"
          className="flex-1 justify-center"
          disabled={busy}
          onClick={() => void onGenerate()}
        >
          {status === 'generating' ? 'Generating…' : 'Generate beat'}
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}

      {plan && (
        <>
          <PlanCard plan={plan} generated={generated} />
          {generated && (
            <div className="flex gap-1.5">
              <Button
                disabled={busy}
                onClick={() => {
                  update({ seed: undefined })
                  void onGenerate()
                }}
                title="Same settings, new seed"
              >
                Try another
              </Button>
              <Button
                disabled={busy}
                onClick={() => update({ seed: plan.seed })}
                title="Keep this seed so changes to the settings start from this song"
              >
                Keep seed
              </Button>
            </div>
          )}
        </>
      )}

      {!plan && (
        <p className="text-[10px] leading-relaxed text-ink-faint">
          Generation creates a new, fully editable project: drums, bass, chords and melody as
          separate tracks, arranged into sections. Music is written by a rule-based procedural
          composer.
        </p>
      )}
    </div>
  )
}
