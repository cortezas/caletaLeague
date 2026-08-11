'use client'

import { cn } from '@/lib/cn'

export interface SegmentedProps {
  options: Array<{ value: string; label: string }>
  value: string
  onValueChange: (v: string) => void
  size?: 'sm' | 'md'
}

/**
 * Control segmentado sobre pista hundida. El tamano `md` reparte el ancho entre
 * las opciones (Clasificacion, Administrador) y el `sm` las ajusta al texto
 * (fila de Tema en Ajustes).
 */
export function Segmented({ options, value, onValueChange, size = 'md' }: SegmentedProps) {
  const compact = size === 'sm'

  return (
    <div
      role="group"
      className={cn(
        'flex bg-sunk p-[3px]',
        compact ? 'gap-[2px] rounded-[11px]' : 'gap-[3px] rounded-[13px]',
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onValueChange(option.value)}
            className={cn(
              'border-0 font-bold transition-transform duration-100 active:scale-[.97] active:opacity-90',
              compact
                ? 'min-h-[38px] rounded-[9px] px-[14px] text-[12.5px]'
                : 'min-h-[40px] flex-1 rounded-[11px] text-[13.5px]',
              active ? 'bg-card text-txt' : 'bg-transparent text-txt3',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
