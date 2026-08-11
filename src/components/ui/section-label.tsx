import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

export interface SectionLabelProps {
  children: ReactNode
  className?: string
}

export function SectionLabel({ children, className }: SectionLabelProps) {
  return (
    <div className={cn('text-[11px] font-extrabold uppercase tracking-[.11em] text-txt3', className)}>
      {children}
    </div>
  )
}
