import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { SectionLabel } from '@/components/ui'
import { cn } from '@/lib/cn'

export interface SettingsGroupProps {
  /** Eyebrow en mayusculas encima de la tarjeta. */
  title: string
  /** El borde `accent` marca la tarjeta de organizador. */
  tone?: 'default' | 'accent'
  children: ReactNode
}

/**
 * Seccion de Ajustes: eyebrow + tarjeta agrupada de radio 18. Las filas se
 * separan con un filete, por eso el `overflow-hidden` (si no, la ultima linea
 * sobresaldria del radio).
 */
export function SettingsGroup({ title, tone = 'default', children }: SettingsGroupProps) {
  return (
    <section>
      <SectionLabel className="mx-[4px] mb-[8px]">{title}</SectionLabel>
      <div
        className={cn(
          'divide-y divide-line overflow-hidden rounded-[18px] border bg-card',
          tone === 'accent' ? 'border-accent' : 'border-line',
        )}
      >
        {children}
      </div>
    </section>
  )
}

export interface SettingsRowProps {
  label: string
  /** Segunda linea bajo la etiqueta. */
  hint?: string
  /** Valor a la derecha. Excluyente con `control`. */
  value?: ReactNode
  valueTone?: 'txt3' | 'accent2'
  /** Cuadro de 38px a la izquierda (siglas de la pena, icono de escudo...). */
  leading?: ReactNode
  /** Control interactivo a la derecha (el selector de tema). */
  control?: ReactNode
  /** Convierte la fila en enlace y le anade el chevron. */
  href?: string
}

/**
 * Fila de ajuste. Alto minimo 50 aunque solo lleve una linea: es un destino
 * tactil cuando hay `href`, y la rejilla tiene que ser regular cuando no.
 */
export function SettingsRow({
  label,
  hint,
  value,
  valueTone = 'txt3',
  leading,
  control,
  href,
}: SettingsRowProps) {
  const body = (
    <>
      {leading}
      <span className="min-w-0 flex-1">
        <span className={cn('block text-[14.5px]', hint ? 'font-bold' : 'font-semibold')}>
          {label}
        </span>
        {hint && <span className="block text-[12px] font-semibold text-txt3">{hint}</span>}
      </span>
      {value !== undefined && (
        <span
          className={cn(
            'flex-none text-[13px] font-semibold',
            valueTone === 'accent2' ? 'text-accent2' : 'text-txt3',
          )}
        >
          {value}
        </span>
      )}
      {control}
      {href && <ChevronRight size={16} strokeWidth={2.3} className="flex-none text-txt3" aria-hidden />}
    </>
  )

  const shell = 'flex min-h-[50px] w-full items-center gap-[12px] px-[15px] py-[13px] text-left'

  if (href) {
    return (
      <Link
        href={href}
        className={cn(shell, 'transition-transform duration-100 active:scale-[.97] active:opacity-90')}
      >
        {body}
      </Link>
    )
  }

  return <div className={shell}>{body}</div>
}
