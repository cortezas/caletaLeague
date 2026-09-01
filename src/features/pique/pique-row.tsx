import { Check, Footprints, Target } from 'lucide-react'

import { Avatar } from '@/components/ui'
import { cn } from '@/lib/cn'

import { ReactionBar } from './reaction-bar'
import { scoreLabel } from '@/lib/format'
import type { PiqueChipKind, PiqueVM } from '@/lib/view-models'

type Row = PiqueVM['rows'][number]

/**
 * Un icono para gol y otro para asistencia. Sin esto, "Pedri" como goleador y
 * "Pedri" como asistente se leen exactamente igual y la fila deja de contar
 * nada: hay gente que aparece en las dos listas del mismo partido.
 *
 * Target = gol, Footprints = asistencia (el pase que lleva al gol).
 * El MVP no lleva icono: su etiqueta ya empieza por "MVP:" y en un chip de
 * 11,5px el ancho se paga caro.
 */
const CHIP_ICON: Record<PiqueChipKind, typeof Target | null> = {
  mvp: null,
  scorer: Target,
  assist: Footprints,
  noGoals: null,
}

export interface PiqueRowProps {
  row: Row
  /** Hace falta para reaccionar: la accion escribe por partido. */
  matchId: string
}

/** Pildora del marcador: verde si clavo el resultado, ambar si solo el 1X2. */
function scoreTone(row: Row): string {
  if (row.exact) return 'bg-ok-soft text-ok'
  if (row.signHit) return 'bg-warn-soft text-warn'
  return 'bg-card2 text-txt3'
}

/** Los 7 puntos son el umbral del prototipo para tenirlos de volt. */
function pointsTone(points: number): string {
  if (points >= 7) return 'text-volt'
  return points > 0 ? 'text-txt' : 'text-txt3'
}

/** Que puso cada uno de la pena en un partido ya jugado. */
export function PiqueRow({ row, matchId }: PiqueRowProps) {
  return (
    <li
      className={cn(
        'rounded-[16px] border px-[12px] py-[10px]',
        row.isMe ? 'border-accent bg-accent-soft' : 'border-line bg-card',
      )}
    >
      <div className="flex items-center gap-[10px]">
        <Avatar name={row.displayName} color={row.avatarColor} photoUrl={row.avatarUrl} size={30} />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[13.5px]',
            row.isMe ? 'font-extrabold' : 'font-semibold',
          )}
        >
          {row.displayName}
        </span>
        <span
          className={cn(
            'flex-none rounded-[9px] px-[9px] py-[3px] font-num text-[15px] font-bold tracking-[.04em]',
            scoreTone(row),
          )}
        >
          {scoreLabel(row.home, row.away)}
        </span>
        <span
          className={cn(
            'w-[42px] flex-none text-right font-num text-[19px] font-extrabold',
            pointsTone(row.points),
          )}
        >
          {row.points}
        </span>
      </div>

      <div className="mt-[8px] flex flex-wrap gap-[5px] pl-[40px]">
        {row.chips.map((chip, index) => {
          const Icon = CHIP_ICON[chip.kind]
          return (
            <span
              key={index}
              className={cn(
                'inline-flex items-center gap-[4px] rounded-[8px] px-[8px] py-[3px] text-[11.5px] font-semibold',
                chip.hit ? 'bg-ok-soft text-ok' : 'bg-card2 text-txt3',
              )}
            >
              {chip.hit && <Check size={9} strokeWidth={4} aria-hidden className="flex-none" />}
              {Icon && <Icon size={11} strokeWidth={2.2} aria-hidden className="flex-none" />}
              {chip.label}
              {/* Sustituto +: el acierto lo hizo su relevo. Sin decirlo, el chip
                  sale verde con un nombre que no esta entre los goleadores del
                  partido y no hay forma de entenderlo. */}
              {chip.via && (
                <span className="font-normal opacity-80">
                  {'→'} {chip.via}
                </span>
              )}
            </span>
          )
        })}
      </div>

      {/* El pique estaba entero en el WhatsApp. Aqui es donde estan los datos. */}
      <ReactionBar
        matchId={matchId}
        targetId={row.memberId}
        counts={row.reactions}
        mine={row.myReactions}
        isMe={row.isMe}
      />
    </li>
  )
}
