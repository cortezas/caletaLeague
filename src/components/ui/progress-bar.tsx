import { cn } from '@/lib/cn'

export interface ProgressBarProps {
  value: number
  max: number
  tone?: 'volt' | 'accent' | 'ok'
  className?: string
}

const TONES = {
  volt: 'bg-volt',
  accent: 'bg-accent',
  ok: 'bg-ok',
} as const

/** Pista hundida de 6px con relleno redondeado. Progreso de jornada, sobre todo. */
export function ProgressBar({ value, max, tone = 'volt', className }: ProgressBarProps) {
  // max 0 es un estado real (jornada sin partidos), no un error: barra vacia.
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0

  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className={cn('h-[6px] overflow-hidden rounded-[99px] bg-sunk', className)}
    >
      <div className={cn('h-full rounded-[99px]', TONES[tone])} style={{ width: `${pct}%` }} />
    </div>
  )
}
