import { useState } from 'react'
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react'

type Variant = 'primary' | 'ghost' | 'danger'

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-white hover:bg-accent-strong disabled:bg-surface-3 disabled:text-ink-faint',
  ghost: 'bg-surface-2 text-ink hover:bg-surface-3 border border-line disabled:text-ink-faint',
  danger: 'bg-danger/15 text-danger hover:bg-danger/25 border border-danger/30',
}

export function Button({
  variant = 'ghost',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...props}
    />
  )
}

const fieldClass =
  'h-7 w-full rounded-md border border-line bg-surface-0 px-2 text-xs text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none'

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${fieldClass} ${props.className ?? ''}`} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${fieldClass} ${props.className ?? ''}`} />
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium tracking-wide text-ink-dim uppercase">{label}</span>
      {children}
    </label>
  )
}

export function Panel({
  title,
  actions,
  children,
  className = '',
}: {
  title: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-lg border border-line bg-surface-1 ${className}`}>
      <header className="flex h-9 items-center justify-between border-b border-line px-3">
        <h2 className="text-xs font-semibold tracking-wide text-ink-dim uppercase">{title}</h2>
        {actions}
      </header>
      <div className="p-3">{children}</div>
    </section>
  )
}

/**
 * Numeric input that keeps a local text draft while focused, so the field can be
 * cleared and retyped. In-range values commit as you type; blur clamps and commits.
 */
export function NumberInput({
  value,
  min,
  max,
  integer = false,
  onCommit,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'min' | 'max' | 'onChange' | 'type'> & {
  value: number
  min: number
  max: number
  integer?: boolean
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const normalize = (v: number) => {
    const n = integer ? Math.round(v) : Math.round(v * 100) / 100
    return Math.min(max, Math.max(min, n))
  }
  return (
    <TextInput
      {...rest}
      type="number"
      min={min}
      max={max}
      value={draft ?? String(value)}
      onChange={(e) => {
        setDraft(e.target.value)
        const v = e.target.valueAsNumber
        if (Number.isFinite(v) && v >= min && v <= max) onCommit(normalize(v))
      }}
      onBlur={() => {
        const v = draft === null ? NaN : Number.parseFloat(draft)
        onCommit(normalize(Number.isFinite(v) ? v : value))
        setDraft(null)
      }}
    />
  )
}
