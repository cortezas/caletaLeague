'use client'

import { CalendarDays, Settings, Trophy, User } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@/lib/cn'

const TABS = [
  { href: '/jornada', label: 'Jornada', Icon: CalendarDays, stroke: 1.9 },
  { href: '/clasificacion', label: 'Clasificación', Icon: Trophy, stroke: 1.9 },
  { href: '/perfil', label: 'Perfil', Icon: User, stroke: 1.9 },
  { href: '/ajustes', label: 'Ajustes', Icon: Settings, stroke: 1.6 },
] as const

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
                <Icon size={24} strokeWidth={stroke} aria-hidden />
                <span className="text-[10.5px] font-bold leading-none">{label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
