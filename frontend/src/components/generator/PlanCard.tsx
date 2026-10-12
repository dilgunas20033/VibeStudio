import type { GenerationPlan } from '../../types/api'

const GENRE_LABEL: Record<GenerationPlan['genre'], string> = {
  trap: 'Trap',
  drill: 'Drill',
  boombap: 'Boom bap',
  lofi: 'Lo-fi',
  house: 'House',
  pop: 'Pop',
}

const SOURCE_STYLE: Record<string, [string, string]> = {
  user: ['set', 'bg-accent/20 text-accent-strong'],
  prompt: ['from prompt', 'bg-ok/15 text-ok'],
  melody: ['from your take', 'bg-warn/15 text-warn'],
}

function Source({ value }: { value: string | undefined }) {
  if (!value) return null
  const [label, style] = SOURCE_STYLE[value] ?? ['auto', 'bg-surface-3 text-ink-faint']
  return (
    <span className={`shrink-0 rounded px-1 text-[9px] font-medium whitespace-nowrap ${style}`}>
      {label}
    </span>
  )
}

/** Shows how the request was read, where each value came from, and what was approximated. */
export function PlanCard({ plan, generated }: { plan: GenerationPlan; generated: boolean }) {
  const s = plan.sources
  const rows: [string, string, string | undefined][] = [
    ['Genre', GENRE_LABEL[plan.genre], s.genre],
    ['Mood', plan.mood, s.mood],
    ['Tempo', `${plan.bpm} BPM`, s.bpm],
    ['Key', `${plan.key.root} ${plan.key.mode}`, s.keyRoot === 'default' ? s.keyMode : s.keyRoot],
    ['Length', `${plan.bars} bars (${plan.structure})`, s.structure],
    ['Energy', `${Math.round(plan.energy * 100)}%`, s.energy],
    ['Drums', `${Math.round(plan.drumIntensity * 100)}%`, s.drumIntensity],
    ['Bass', `${Math.round(plan.bassIntensity * 100)}%`, s.bassIntensity],
  ]
  if (plan.drumBars) {
    rows.unshift([
      'Groove',
      `${plan.drumBars}-bar groove, ${plan.drumMode === 'expand' ? 'expanded' : 'kept exactly'}`,
      'melody',
    ])
  }
  if (plan.melodyBars) {
    rows.unshift([
      'Melody',
      `${plan.melodyBars} bars on ${plan.melodyInstrument}, ${plan.melodyMode === 'vary' ? 'varied in verse' : 'kept exactly'}`,
      'melody',
    ])
  }
  return (
    <div
      className="rounded-md border border-line bg-surface-0 p-2.5 text-[11px]"
      data-testid="plan-card"
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-semibold">{plan.title}</span>
        <span className="shrink-0 text-[10px] text-ink-faint">
          {generated ? 'Generated' : 'Preview'} · seed {plan.seed}
        </span>
      </div>
      <dl className="space-y-0.5">
        {rows.map(([k, v, src]) => (
          <div key={k} className="flex items-baseline gap-2">
            <dt className="w-12 shrink-0 text-ink-faint">{k}</dt>
            <dd className="flex min-w-0 flex-1 items-baseline justify-between gap-1">
              <span className="truncate capitalize">{v}</span>
              <Source value={src} />
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {plan.instruments.map((i) => (
          <span key={i} className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px]">
            {i}
          </span>
        ))}
        <Source value={s.instruments} />
      </div>
      {plan.warnings.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[10px] text-warn" aria-label="Generation notes">
          {plan.warnings.map((w) => (
            <li key={w}>• {w}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[10px] text-ink-faint">
        Prompt read by{' '}
        {plan.interpreter === 'llm' ? `AI (${plan.interpreterModel ?? 'LLM'})` : 'keyword rules'}.
        Music written by the procedural composer (rule-based, not a neural model).
      </p>
    </div>
  )
}
