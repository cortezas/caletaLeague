'use client'

import { Star } from 'lucide-react'
import { useActionState, useEffect } from 'react'

import { Chip, useToast } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { AdminMatchVM } from '@/lib/view-models'

import { setStarMatchAction, type SaveState } from './actions'

const INITIAL: SaveState = { ok: false, error: null }

export interface AdminStarFormProps {
  gameweekId: string
  gameweekNumber: number
  matches: AdminMatchVM[]
}

/**
 * El partido estrella de la jornada: el que vale doble.
 *
 * UNO por jornada, y lo impone un indice unico parcial en la base (migracion
 * 0034), no un acuerdo de palabra. Volver a pulsar el que ya lo es lo quita.
 *
 * SOLO ANTES DEL PRIMER PITIDO. Doblar los puntos de un partido cuando la gente
 * ya ha pronosticado sabiendo que valia lo normal es cambiar las reglas a mitad
 * de mano. La accion tambien lo comprueba en servidor: esto solo evita ofrecer
 * un boton que va a rebotar.
 */
export function AdminStarForm({ gameweekId, gameweekNumber, matches }: AdminStarFormProps) {
  const showToast = useToast()
  const [state, action, guardando] = useActionState(setStarMatchAction, INITIAL)

  useEffect(() => {
    if (state.ok) showToast('Partido estrella actualizado.')
    else if (state.error) showToast(state.error, 'bad')
  }, [state, showToast])

  const estrella = matches.find((m) => m.multiplier > 1) ?? null
  const empezada = matches.some((m) => m.status !== 'open')

  return (
    <div className="rounded-[17px] border border-line bg-card px-[14px] py-[13px]">
      <div className="mb-[5px] flex items-center gap-[8px]">
        <Star size={15} strokeWidth={2.4} aria-hidden className="flex-none text-accent2" />
        <span className="text-[13px] font-extrabold">Partido estrella</span>
        {estrella && <Chip tone="accent">x2</Chip>}
      </div>

      <p className="mb-[12px] text-[11.5px] font-semibold leading-[1.45] text-txt3">
        {empezada
          ? `La jornada ${gameweekNumber} ya ha empezado. El partido estrella se elige antes del primer pitido: doblar los puntos con la gente ya pronosticada es cambiar las reglas a mitad de mano.`
          : 'Los puntos de ese partido valen el doble, para todos. Sale marcado con una x2 en la jornada y en el editor. Vuelve a pulsarlo para quitarlo.'}
      </p>

      <form action={action} className="flex flex-col gap-[7px]">
        <input type="hidden" name="gameweekId" value={gameweekId} readOnly />
        {matches.map((match) => {
          const activo = match.multiplier > 1
          return (
            <button
              key={match.id}
              type="submit"
              name="matchId"
              // Volver a pulsar el que ya lo es manda vacio, y eso lo quita.
              value={activo ? '' : match.id}
              disabled={empezada || guardando}
              aria-pressed={activo}
              className={cn(
                'flex min-h-[46px] items-center gap-[9px] rounded-[13px] border px-[13px] text-left',
                'text-[13.5px] font-bold transition-transform duration-100 active:scale-[.98]',
                'disabled:opacity-50',
                activo
                  ? 'border-accent bg-accent-soft text-accent2'
                  : 'border-line2 bg-transparent text-txt',
              )}
            >
              <Star
                size={15}
                strokeWidth={2.4}
                aria-hidden
                className={cn('flex-none', activo ? 'text-accent2' : 'text-txt3')}
                fill={activo ? 'currentColor' : 'none'}
              />
              <span className="min-w-0 flex-1 truncate">{match.label}</span>
              {activo && <span className="flex-none font-num text-[13px] font-extrabold">x2</span>}
            </button>
          )
        })}
      </form>
    </div>
  )
}
