import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

export type CardRadius = 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 22

export interface CardProps {
  children: ReactNode
  className?: string
  as?: 'div' | 'section' | 'article'
  radius?: CardRadius
  elevated?: boolean
}

/**
 * Tailwind escanea el fuente en busca de clases literales: un
 * `rounded-[${radius}px]` interpolado no generaria ninguna utilidad.
 */
const RADIUS: Record<CardRadius, string> = {
  13: 'rounded-[13px]',
  14: 'rounded-[14px]',
  15: 'rounded-[15px]',
  16: 'rounded-[16px]',
  17: 'rounded-[17px]',
  18: 'rounded-[18px]',
  19: 'rounded-[19px]',
  20: 'rounded-[20px]',
  22: 'rounded-[22px]',
}

export function Card({
  children,
  className,
  as: Tag = 'div',
  radius = 18,
  elevated = false,
}: CardProps) {
  return (
    <Tag className={cn('border border-line bg-card', RADIUS[radius], elevated && 'shadow-card', className)}>
      {children}
    </Tag>
  )
}
