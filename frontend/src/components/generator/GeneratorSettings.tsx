import type { GenerationRequest } from '../../types/api'
import { useGeneratorStore } from '../../store/generatorStore'
import { NOTE_NAMES } from '../../project/music'
import { Field, Select, TextInput } from '../ui'

type Instrument = NonNullable<GenerationRequest['instruments']>[number]

const GENRES = ['trap', 'drill', 'boombap', 'lofi', 'house', 'pop'] as const
const MOODS = ['dark', 'emotional', 'uplifting', 'chill', 'aggressive', 'dreamy'] as const
const INSTRUMENTS: Instrument[] = [
  'kick', 'snare', 'clap', 'hihat', 'openhat', 'perc', 'bass', 'lead', 'pad', 'pluck', 'keys',
] // prettier-ignore
const LEVELS = [
  { label: 'Low', value: 0.3 },
  { label: 'Medium', value: 0.55 },
  { label: 'High', value: 0.85 },
]

type LevelKey = 'energy' | 'complexity' | 'drumIntensity' | 'bassIntensity' | 'melodicComplexity'

function AutoSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T | null | undefined
  options: readonly T[]
  onChange: (v: T | undefined) => void
}) {
  return (
    <Field label={label}>
      <Select
        aria-label={label}
        value={value ?? ''}
        onChange={(e) => onChange((e.target.value || undefined) as T | undefined)}
      >
        <option value="">Auto</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
    </Field>
  )
}

/** Optional overrides. Every control defaults to Auto, which lets the prompt decide. */
export function GeneratorSettings() {
  const req = useGeneratorStore((s) => s.request)
  const update = useGeneratorStore((s) => s.update)

  const level = (key: LevelKey, label: string) => (
    <Field label={label}>
      <Select
        aria-label={label}
        value={req[key] ?? ''}
        onChange={(e) => update({ [key]: e.target.value ? Number(e.target.value) : undefined })}
      >
        <option value="">Auto</option>
        {LEVELS.map((l) => (
          <option key={l.label} value={l.value}>
            {l.label}
          </option>
        ))}
      </Select>
    </Field>
  )

  const instruments = req.instruments ?? null
  const toggleInstrument = (i: Instrument) => {
    const set = new Set(instruments ?? [])
    if (set.has(i)) set.delete(i)
    else set.add(i)
    const list = INSTRUMENTS.filter((x) => set.has(x))
    update({ instruments: list.length ? (list as GenerationRequest['instruments']) : undefined })
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <AutoSelect
        label="Genre"
        value={req.genre}
        options={GENRES}
        onChange={(genre) => update({ genre })}
      />
      <AutoSelect
        label="Mood"
        value={req.mood}
        options={MOODS}
        onChange={(mood) => update({ mood })}
      />
      <Field label="BPM">
        <TextInput
          aria-label="Generation BPM"
          type="number"
          min={40}
          max={220}
          placeholder="Auto"
          value={req.bpm ?? ''}
          onChange={(e) => {
            const v = e.target.valueAsNumber
            update({ bpm: Number.isFinite(v) && v >= 40 && v <= 220 ? v : undefined })
          }}
        />
      </Field>
      <AutoSelect
        label="Length"
        value={req.structure}
        options={['loop', 'short', 'full'] as const}
        onChange={(structure) => update({ structure })}
      />
      <AutoSelect
        label="Key"
        value={req.keyRoot}
        options={NOTE_NAMES}
        onChange={(keyRoot) => update({ keyRoot })}
      />
      <AutoSelect
        label="Scale"
        value={req.keyMode}
        options={['minor', 'major'] as const}
        onChange={(keyMode) => update({ keyMode })}
      />
      {level('energy', 'Energy')}
      {level('drumIntensity', 'Drums')}
      {level('bassIntensity', 'Bass')}
      {level('melodicComplexity', 'Melody')}
      <div className="col-span-2">
        <span className="text-[11px] font-medium tracking-wide text-ink-dim uppercase">
          Instruments {instruments ? '' : '(auto)'}
        </span>
        <div className="mt-1 flex flex-wrap gap-1">
          {INSTRUMENTS.map((i) => {
            const on = instruments?.includes(i) ?? false
            return (
              <button
                key={i}
                type="button"
                aria-pressed={on}
                onClick={() => toggleInstrument(i)}
                className={`rounded border px-1.5 py-0.5 text-[10px] ${
                  on
                    ? 'border-accent/60 bg-accent/20 text-accent-strong'
                    : 'border-line text-ink-dim'
                }`}
              >
                {i}
              </button>
            )
          })}
        </div>
      </div>
      <Field label="Seed">
        <TextInput
          aria-label="Seed"
          type="number"
          min={0}
          placeholder="Random"
          value={req.seed ?? ''}
          onChange={(e) => {
            const v = Math.round(e.target.valueAsNumber)
            update({ seed: Number.isFinite(v) && v >= 0 ? v : undefined })
          }}
        />
      </Field>
    </div>
  )
}
