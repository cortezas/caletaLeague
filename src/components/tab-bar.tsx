'use client'

import { CalendarDays, Settings, Trophy, User } from 'lucide-react'
import Link, { useLinkStatus } from 'next/link'
import { usePathname } from 'next/navigation'

import { NavSpinner } from '@/components/ui'
import { cn } from '@/lib/cn'

const TABS = [
  { href: '/jornada', label: 'Jornada', Icon: CalendarDays, stroke: 1.9 },
  { href: '/clasificacion', label: 'Clasificación', Icon: Trophy, stroke: 1.9 },
  { href: '/perfil', label: 'Perfil', Icon: User, stroke: 1.9 },
  { href: '/ajustes', label: 'Ajustes', Icon: Settings, stroke: 1.6 },
] as const

/**
 * El icono de la pestaña, o un spinner mientras se navega hacia ella.
 *
 * Va dentro del `<Link>` porque `useLinkStatus` solo funciona ahi. Sustituir el
 * icono en vez de añadir el spinner al lado mantiene la altura de la barra: si
 * se sumara, las cuatro pestañas darian un salto al pulsar una.
 */
function NavSpinnerOrIcon({
  Icon,
  stroke,
}: {
  Icon: (typeof TABS)[number]['Icon']
  stroke: number
}) {
  const { pending } = useLinkStatus()
  if (pending) return <NavSpinner size={24} />
  return <Icon size={24} strokeWidth={stroke} aria-hidden />
}

/**
 * Client Component a proposito: los layouts no se re-renderizan al navegar, asi
 * que un usePathname() dentro del layout server se quedaria obsoleto.
 */
export function TabBar() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg2 px-[6px] pt-[7px] pb-[calc(env(safe-area-inset-bottom)+18px)]"
    >
      <ul className="mx-auto flex max-w-[520px]">
        {TABS.map(({ href, label, Icon, stroke }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-[48px] flex-col items-center justify-center gap-[3px] rounded-[12px]',
                  'transition-transform duration-100 active:scale-[.97]',
                  active ? 'text-accent' : 'text-txt3',
                )}
              >
                {/* Sustituye al icono mientras carga la pestaña: mismo tamaño,
                    asi la barra no da un salto. */}
                <span className="flex h-[24px] items-center justify-center">
                  <NavSpinnerOrIcon Icon={Icon} stroke={stroke} />
                </span>
                <span className="text-[10.5px] font-bold leading-none">{label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
