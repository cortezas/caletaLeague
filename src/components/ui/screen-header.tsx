import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

export type ScreenHeaderSize = 'sm' | 'md' | 'lg'

export interface ScreenHeaderProps {
  title: string
  subtitle?: string
  size?: ScreenHeaderSize
  backHref?: string
  action?: ReactNode
  children?: ReactNode
}

const TITLE: Record<ScreenHeaderSize, string> = {
  sm: 'text-[15px] font-extrabold tracking-[-.02em]',
  md: 'text-[16px] font-extrabold tracking-[-.02em]',
  lg: 'text-[24px] font-extrabold tracking-[-.03em]',
}

/**
 * D9: la renderiza cada page.tsx, nunca el layout de grupo.
 * El padding superior sale del inset seguro: en iPhone en standalone eso es
 * la altura de la barra de estado, en escritorio es 14px.
 */
export function ScreenHeader({
  title,
  subtitle,
  size = 'md',
  backHref,
  action,
  children,
}: ScreenHeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg px-[14px] pt-[calc(env(safe-area-inset-top)+14px)] pb-[12px]">
      <div className="flex items-center gap-[10px]">
        {backHref && (
          <Link
            href={backHref}
            aria-label="Volver"
            className="flex min-h-[44px] min-w-[44px] flex-none items-center justify-center rounded-[13px] border border-line bg-card text-txt transition-transform duration-100 active:scale-[.97] active:opacity-90"
          >
            <ChevronLeft size={18} strokeWidth={2.3} aria-hidden />
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <h1 className={cn('truncate', TITLE[size])}>{title}</h1>
          {subtitle && (
            <p className="mt-[2px] truncate text-[11.5px] font-semibold text-txt3">{subtitle}</p>
          )}
        </div>
        {action}
      </div>
      {children && <div className="mt-[11px]">{children}</div>}
    </header>
  )
}
