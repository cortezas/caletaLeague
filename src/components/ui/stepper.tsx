'use client'

import { cn } from '@/lib/cn'

export interface StepperProps {
  value: number
  min: number
  max: number
  step?: number
  onValueChange: (v: number) => void
  /** 52: editor de pronostico (cifra de 62px encima). 44: puntuacion del admin (cifra en linea). */
  size: 44 | 52
  /** Va al `aria-label` del grupo: 'Goles del Sevilla', 'Resultado exacto'... */
  label: string
}

/**
 * Contador de dos botones con clamp. Las dos disposiciones son las del
 * prototipo y no son intercambiables: en el editor la cifra manda sobre los
 * botones (columna), en el admin la cifra es un valor mas de la fila.
 */
export function Stepper({ value, min, max, step = 1, onValueChange, size, label }: StepperProps) {
  const big = size === 52

  function bump(delta: number) {
    // Clamp en el propio control: nadie mas tiene por que saber los limites.
    const next = Math.min(max, Math.max(min, value + delta))
    // Feedback haptico en cada pulsacion, tambien cuando el clamp la bloquea.
    navigator.vibrate?.(8)
    if (next !== value) onValueChange(next)
  }

  const buttonBase = cn(
    'flex flex-none items-center justify-center leading-none font-semibold',
    'transition-transform duration-100 active:scale-[.94] active:opacity-90',
    big ? 'h-[52px] w-[52px] rounded-[17px] text-[24px]' : 'h-[44px] w-[44px] rounded-[13px] text-[20px]',
  )

  const minus = (
    <button
      type="button"
      aria-label={`Restar en ${label}`}
      onClick={() => bump(-step)}
      className={cn(buttonBase, 'border border-line2 bg-card2 text-txt')}
    >
      −
    </button>
  )

  const plus = (
    <button
      type="button"
      aria-label={`Sumar en ${label}`}
      onClick={() => bump(step)}
      className={cn(buttonBase, 'border-0 bg-accent text-accent-ink')}
    >
      +
    </button>
  )

  if (big) {
    return (
      <div role="group" aria-label={label} className="flex flex-col items-center gap-[11px]">
        <span
          aria-live="polite"
          className="font-num text-[62px] font-extrabold tabular-nums leading-[.9] tracking-[-.01em] text-txt"
        >
          {value}
        </span>
        <div className="flex gap-[8px]">
          {minus}
          {plus}
        </div>
      </div>
    )
  }

  return (
    <div role="group" aria-label={label} className="flex flex-none items-center gap-[7px]">
      {minus}
      <span
        aria-live="polite"
        className="min-w-[32px] text-center font-num text-[24px] font-extrabold tabular-nums leading-none text-volt"
      >
        {value}
      </span>
      {plus}
    </div>
  )
}
