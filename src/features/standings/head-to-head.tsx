import { Swords } from 'lucide-react'

import { Avatar, EmptyState, SectionLabel } from '@/components/ui'
import { cn } from '@/lib/cn'
import { plural } from '@/lib/format'
import type { HeadToHeadVM } from '@/lib/view-models'

type Row = HeadToHeadVM['rows'][number]

export interface HeadToHeadProps {
  h2h: HeadToHeadVM
}

/** '+12', '-7' o '0'. El signo es la mitad del mensaje, asi que va siempre. */
function diffLabel(diff: number): string {
  return diff > 0 ? `+${diff}` : String(diff)
}

function toneOf(diff: number): string {
  if (diff > 0) return 'text-ok'
  if (diff < 0) return 'text-bad'
  return 'text-txt3'
}

function HeadToHeadRow({ row }: { row: Row }) {
  const diff = row.pointsFor - row.pointsAgainst
  const played = row.wins + row.draws + row.losses

  return (
    <li
      className="flex min-h-[56px] items-center gap-[11px] rounded-[15px] border border-line bg-card px-[13px] py-[10px]"
      aria-label={
        `Contra ${row.displayName}: ${plural(row.wins, 'ganada', 'ganadas')}, ` +
        `${plural(row.draws, 'empatada', 'empatadas')} y ` +
        `${plural(row.losses, 'perdida', 'perdidas')} de ` +
        `${plural(played, 'jornada', 'jornadas')}. ` +
        `${
          diff === 0
            ? 'Empatados a puntos'
            : diff > 0
              ? `${plural(diff, 'punto', 'puntos')} a tu favor`
              : `${plural(Math.abs(diff), 'punto', 'puntos')} en contra`
        }.`
      }
    >
      <Avatar name={row.displayName} color={row.avatarColor} photoUrl={row.avatarUrl} size={34} />
      <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">{row.displayName}</span>

      {/* El balance no se lee como texto: ya va entero en el aria-label de la fila. */}
      <span
        aria-hidden
        className="flex w-[74px] flex-none items-baseline justify-center font-num text-[19px] font-extrabold"
      >
        <span className="text-ok">{row.wins}</span>
        <span className="px-[3px] text-[14px] text-txt3">-</span>
        <span className="text-txt2">{row.draws}</span>
        <span className="px-[3px] text-[14px] text-txt3">-</span>
        <span className="text-bad">{row.losses}</span>
      </span>

      <span
        aria-hidden
        className={cn('w-[42px] flex-none text-right font-num text-[16px] font-extrabold', toneOf(diff))}
      >
        {diffLabel(diff)}
      </span>
    </li>
  )
}

/**
 * Mi balance jornada a jornada contra cada companero de la peña.
 *
 * Va ORDENADO de peor a mejor (lo decide `getHeadToHead`): arriba del todo el
 * que te esta ganando. Las columnas son ganadas-empatadas-perdidas y la
 * diferencia de puntos acumulada, y en movil no cabe mas: el nombre ya se lleva
 * todo el espacio flexible.
 */
export function HeadToHead({ h2h }: HeadToHeadProps) {
  if (h2h.rows.length === 0) {
    return (
      <EmptyState
        icon={<Swords size={34} strokeWidth={1.9} aria-hidden />}
        title="Todavía no hay cara a cara"
        description="Se cuenta con las jornadas ya terminadas. En cuanto se cierre la primera aparece aquí tu balance contra cada uno: ganadas, empatadas y perdidas, y los puntos que le sacas o te saca."
      />
    )
  }

  return (
    <div className="px-[14px] pt-[16px] pb-[30px]">
      <p className="mb-[12px] text-[13px] leading-[1.45] text-txt2">
        Jornada a jornada, quién sumó más puntos. Empieza por quien te va ganando.
      </p>

      <div aria-hidden className="mb-[7px] flex items-center gap-[11px] px-[13px]">
        <span className="flex-1" />
        <SectionLabel className="w-[74px] flex-none text-center">G-E-P</SectionLabel>
        <SectionLabel className="w-[42px] flex-none text-right">DIF</SectionLabel>
      </div>

      <ul className="flex flex-col gap-[6px]">
        {h2h.rows.map((row) => (
          <HeadToHeadRow key={row.memberId} row={row} />
        ))}
      </ul>
    </div>
  )
}
