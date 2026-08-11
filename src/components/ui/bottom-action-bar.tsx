import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

export interface BottomActionBarProps {
  children: ReactNode
  className?: string
}

/**
 * D8: fixed sobre el scroll del documento, no dentro de un scroller anidado.
 * La pantalla que la use tiene que reservar el hueco con padding-bottom propio.
 */
export function BottomActionBar({ children, className }: BottomActionBarProps) {
  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg2',
        'px-[14px] pt-[12px] pb-[calc(env(safe-area-inset-bottom)+16px)]',
        className,
      )}
    >
      <div className="mx-auto flex max-w-[520px] items-center gap-[11px]">{children}</div>
    </div>
  )
}
