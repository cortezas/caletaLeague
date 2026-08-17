'use client'

import { ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'

import { Avatar } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { GameweekStandingsVM } from '@/lib/view-models'

type Row = GameweekStandingsVM['rows'][number]

export interface GameweekAccordionProps {
  rows: Row[]
}

/**
 * Clasificacion de una jornada con desglose desplegable.
 * Acordeon de uno en uno: abrir una fila cierra la anterior.
 */
export function GameweekAccordion({ rows }: GameweekAccordionProps) {
  const [openId, setOpenId] = useState<string | null>(null)
  const baseId = useId()

  return (
    <ul className="flex flex-col gap-[6px]">
      {rows.map((row) => {
        const open = openId === row.memberId
        const panelId = `${baseId}-${row.memberId}`

        return (
          <li
            key={row.memberId}
            className={cn(
              'overflow-hidden rounded-[15px] border',
              // Quien paga se marca en rojo, y gana sobre el resalte de "tú":
              // que te toque pagar es la informacion importante de esa fila.
              row.euros !== null
                ? 'border-bad bg-bad-soft'
                : row.isMe
                  ? 'border-accent bg-accent-soft'
                  : 'border-line bg-card',
            )}
          >
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpenId(open ? null : row.memberId)}
              className="flex min-h-[44px] w-full items-center gap-[11px] px-[13px] py-[11px] text-left transition-transform duration-100 active:scale-[.97] active:opacity-90"
            >
              <span className="w-[18px] flex-none text-center font-num text-[15px] font-bold text-txt3">
                {row.position}
              </span>
              <Avatar name={row.displayName} color={row.avatarColor} photoUrl={row.avatarUrl} size={32} />
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-[14px]',
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
              {/* La cantidad, no un icono: lo que hace falta saber es cuanto. */}
              {row.euros !== null && (
                <span className="flex-none rounded-[8px] bg-bad px-[8px] py-[3px] font-num text-[13px] font-extrabold text-white">
                  {row.euros} €
                </span>
              )}
              <span
                className={cn(
                  'flex-none font-num text-[20px] font-extrabold',
                  row.isMe ? 'text-accent2' : 'text-txt',
                )}
              >
                {row.points}
              </span>
              <ChevronDown
                size={14}
                strokeWidth={2.4}
                aria-hidden
                className="flex-none text-txt3 transition-transform duration-[180ms]"
                style={{ transform: open ? 'rotate(180deg)' : undefined }}
              />
            </button>

            {open && (
              <div id={panelId} className="animate-slidein px-[13px] pt-[2px] pb-[12px]">
                <div aria-hidden className="mb-[10px] h-px bg-line" />
                {row.breakdown.map((entry) => (
                  <div key={entry.matchId} className="flex items-center gap-[9px] py-[5px]">
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-txt2">
                      {entry.label}
                    </span>
                    <span className="font-num text-[13px] font-bold tracking-[.04em] text-txt3">
                      {entry.myScore}
                    </span>
                    <span className="text-[11px] text-txt3">vs</span>
                    <span className="font-num text-[13px] font-bold tracking-[.04em]">
                      {entry.realScore}
                    </span>
                    <span
                      className={cn(
                        'w-[38px] text-right font-num text-[13px] font-extrabold',
                        entry.points > 0 ? 'text-ok' : 'text-txt3',
                      )}
                    >
                      +{entry.points}
                    </span>
                  </div>
                ))}
                {row.pendingCount > 0 && (
                  <div className="mt-[9px] flex items-center justify-between border-t border-line pt-[9px]">
                    <span className="text-[11.5px] font-bold uppercase tracking-[.06em] text-txt3">
                      Partidos por jugar
                    </span>
                    <span className="text-[12.5px] font-bold text-txt2">
                      {row.pendingCount} · sin revelar
                    </span>
                  </div>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
