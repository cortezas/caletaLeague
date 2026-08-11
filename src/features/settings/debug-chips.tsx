'use client'

import Link from 'next/link'

import { SectionLabel, useToast } from '@/components/ui'

/**
 * Atajos a los estados transversales del handoff (pantalla 12). Es utillaje de
 * desarrollo: la page solo los monta con NODE_ENV === 'development'.
 *
 * Los tres primeros pasan `?estado=` a /jornada. Esa pantalla es del lote B y
 * hoy ignora el parametro: si nadie lo implementa, los chips llevan a la lista
 * normal y no rompen nada. El cuarto si es real: el partido 5 esta cerrado, y
 * abrirlo tiene que dar la tarjeta sellada mas el toast rojo.
 */
const CHIPS = [
  { label: 'Sin jornada activa', href: '/jornada?estado=vacio' },
  { label: 'Cargando', href: '/jornada?estado=cargando' },
  { label: 'Sin conexión', href: '/jornada?estado=error' },
  { label: 'Partido cerrado', href: '/jornada/5', toast: 'Este partido ya está cerrado' },
] as const

export function DebugChips() {
  const showToast = useToast()

  return (
    <section>
      <SectionLabel className="mx-[4px] mb-[8px]">Estados de prueba</SectionLabel>
      <div className="flex flex-wrap gap-[7px]">
        {CHIPS.map((chip) => (
          <Link
            key={chip.label}
            href={chip.href}
            onClick={() => {
              if ('toast' in chip) showToast(chip.toast, 'bad')
            }}
            className="flex min-h-[44px] items-center rounded-[13px] border border-line bg-card px-[15px] text-[13px] font-semibold text-txt2 transition-transform duration-100 active:scale-[.97] active:opacity-90"
          >
            {chip.label}
          </Link>
        ))}
      </div>
    </section>
  )
}
