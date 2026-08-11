import { cn } from '@/lib/cn'

/**
 * El degradado mide 320px y `shim` lo desplaza de -320 a +320: por eso el
 * `background-size` fijo, sin el la animacion no recorre nada.
 */
const SHIM =
  'animate-shim bg-[linear-gradient(90deg,var(--card),var(--card2)_40%,var(--card)_80%)] bg-[length:320px_100%]'

export interface SkeletonProps {
  height: number
  radius?: number
  className?: string
}

export function Skeleton({ height, radius = 18, className }: SkeletonProps) {
  // Alturas y radios arbitrarios en runtime: Tailwind no puede generarlos.
  return <div aria-hidden style={{ height, borderRadius: radius }} className={cn(SHIM, className)} />
}

export interface SkeletonListProps {
  heights: number[]
  className?: string
}

export function SkeletonList({ heights, className }: SkeletonListProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Cargando"
      className={cn('flex flex-col gap-[10px]', className)}
    >
      {heights.map((height, i) => (
        <Skeleton key={i} height={height} />
      ))}
    </div>
  )
}
