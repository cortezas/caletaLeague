import { cn } from '@/lib/cn'

export interface StatCardProps {
  value: string | number
  label: string
  tone?: 'txt' | 'volt' | 'ok' | 'bad'
  className?: string
}

const TONES = {
  txt: 'text-txt',
  volt: 'text-volt',
  ok: 'text-ok',
  bad: 'text-bad',
} as const

/** Tarjeta de cifra de la rejilla 2x2 del perfil y del resumen de jornada. */
export function StatCard({ value, label, tone = 'txt', className }: StatCardProps) {
  return (
    <div className={cn('rounded-[17px] border border-line bg-card px-[15px] py-[14px]', className)}>
      <div className={cn('font-num text-[28px] font-extrabold tabular-nums leading-none', TONES[tone])}>
        {value}
      </div>
      <div className="mt-[4px] text-[11.5px] font-bold leading-[1.25] text-txt3">{label}</div>
    </div>
  )
}
