import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

export type ChipTone = 'volt' | 'accent' | 'neutral' | 'ok' | 'warn' | 'bad'
export type ChipSize = 'xs' | 'sm'

export interface ChipProps {
  tone: ChipTone
  size?: ChipSize
  uppercase?: boolean
  children: ReactNode
}

const TONE: Record<ChipTone, string> = {
  volt: 'bg-volt text-volt-ink',
  accent: 'bg-accent-soft text-accent2',
  neutral: 'bg-card2 text-txt2',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
}

const SIZE: Record<ChipSize, string> = {
  xs: 'rounded-[6px] px-[7px] py-[3px] text-[10.5px] font-extrabold tracking-[.09em]',
  sm: 'rounded-[8px] px-[9px] py-[4px] text-[11.5px] font-semibold',
}

/**
 * `uppercase` sigue al tamano por defecto: xs es el chip de estado del dossier,
 * que siempre va en mayusculas; sm es una etiqueta normal.
 */
export function Chip({ tone, size = 'xs', uppercase = size === 'xs', children }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex flex-none items-center leading-none whitespace-nowrap',
        SIZE[size],
        TONE[tone],
        uppercase && 'uppercase',
      )}
    >
      {children}
    </span>
  )
}
