'use client'

import { useActionState, useEffect } from 'react'

import { useToast } from '@/components/ui'
import { cn } from '@/lib/cn'

import { EMOJIS } from './emojis'
import { toggleReactionAction, type ReactionState } from './reaction-actions'

const INITIAL: ReactionState = { ok: false, error: null }

export interface ReactionBarProps {
  matchId: string
  targetId: string
  /** Cuantas de cada emoji lleva esta fila. */
  counts: Record<string, number>
  /** Las que he puesto yo, para pintarlas encendidas. */
  mine: string[]
  /** Nadie se reacciona a si mismo. */
  isMe: boolean
}

/**
 * La barra de reacciones de una fila del pique.
 *
 * Cliente porque necesita el boton; la fila (`PiqueRow`) sigue siendo servidor.
 * Mismo patron que `AdminMoneyForm` con sus acciones.
 *
 * Solo se pintan los emojis que alguien ha usado, mas los seis del menu al
 * desplegar... no: se pintan los seis siempre. Con trece personas y seis emojis
 * caben en una linea, y esconderlos detras de un boton "+" es un toque mas para
 * la unica cosa de esta pantalla que se hace por gusto.
 */
export function ReactionBar({ matchId, targetId, counts, mine, isMe }: ReactionBarProps) {
  const showToast = useToast()
  const [state, action, enviando] = useActionState(toggleReactionAction, INITIAL)

  useEffect(() => {
    if (state.error) showToast(state.error, 'bad')
  }, [state, showToast])

  // A ti mismo no te reaccionas, pero SI ves lo que te han puesto.
  if (isMe) {
    const puestas = EMOJIS.filter((e) => (counts[e] ?? 0) > 0)
    if (puestas.length === 0) return null
    return (
      <div className="mt-[7px] flex flex-wrap gap-[5px] pl-[40px]">
        {puestas.map((emoji) => (
          <span
            key={emoji}
            className="flex min-h-[26px] items-center gap-[4px] rounded-[9px] border border-line bg-sunk px-[7px] text-[12px]"
          >
            {emoji}
            <span className="font-num text-[11px] font-extrabold text-txt2">{counts[emoji]}</span>
          </span>
        ))}
      </div>
    )
  }

  return (
    <form action={action} className="mt-[7px] flex flex-wrap gap-[5px] pl-[40px]">
      <input type="hidden" name="matchId" value={matchId} readOnly />
      <input type="hidden" name="targetId" value={targetId} readOnly />
      {EMOJIS.map((emoji) => {
        const n = counts[emoji] ?? 0
        const puesta = mine.includes(emoji)
        return (
          <button
            key={emoji}
            type="submit"
            name="emoji"
            value={emoji}
            disabled={enviando}
            aria-pressed={puesta}
            aria-label={`Reaccionar con ${emoji}`}
            className={cn(
              'flex min-h-[30px] items-center gap-[4px] rounded-[9px] border px-[8px] text-[13px]',
              'transition-transform duration-100 active:scale-[.92] disabled:opacity-50',
              puesta ? 'border-accent bg-accent-soft' : 'border-line bg-transparent',
            )}
          >
            {emoji}
            {n > 0 && (
              <span
                className={cn(
                  'font-num text-[11px] font-extrabold',
                  puesta ? 'text-accent2' : 'text-txt3',
                )}
              >
                {n}
              </span>
            )}
          </button>
        )
      })}
    </form>
  )
}
