import { ChevronDown, ChevronUp } from 'lucide-react'

import { Avatar } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { StandingsVM } from '@/lib/view-models'

type Row = StandingsVM['rows'][number]

export interface StandingsRowProps {
  row: Row
}

/** Puestos ganados o perdidos desde la jornada anterior. 0 = guion gris. */
function Trend({ trend }: { trend: number }) {
  if (trend === 0) {
    return (
      <span
        aria-label="Sin cambios"
        className="w-[24px] flex-none text-center text-[13px] font-bold text-txt3"
      >
        –
      </span>
    )
  }

  const up = trend > 0
  const Icon = up ? ChevronUp : ChevronDown

  return (
    <span
      aria-label={`${up ? 'Sube' : 'Baja'} ${Math.abs(trend)} ${Math.abs(trend) === 1 ? 'puesto' : 'puestos'}`}
      className={cn('flex w-[24px] flex-none items-center justify-center gap-[1px]', up ? 'text-ok' : 'text-bad')}
    >
      <Icon size={11} strokeWidth={3.2} aria-hidden />
      <span className="font-num text-[12px] font-extrabold">{Math.abs(trend)}</span>
    </span>
  )
}

/** Filas 4 a 12 de la clasificacion general. La del usuario va destacada. */
export function StandingsRow({ row }: StandingsRowProps) {
  return (
    <li
      className={cn(
        'flex items-center gap-[11px] rounded-[15px] border px-[13px] py-[11px]',
        row.isMe ? 'border-accent bg-accent-soft' : 'border-line bg-card',
      )}
    >
      <span className="w-[20px] flex-none text-center font-num text-[16px] font-bold text-txt3">
        {row.position}
      </span>
      <Avatar name={row.displayName} color={row.avatarColor} size={34} />
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[14.5px]',
          row.isMe ? 'font-extrabold' : 'font-semibold',
        )}
      >
        {row.displayName}
      </span>
      {row.isMe && (
        <span className="flex-none rounded-[7px] bg-accent px-[7px] py-[2px] text-[9.5px] font-extrabold tracking-[.08em] text-accent-ink">
          TÚ
        </span>
      )}
      <Trend trend={row.trend} />
      <span className="flex-none font-num text-[21px] font-extrabold tracking-[.01em]">
        {row.points}
      </span>
    </li>
  )
}
