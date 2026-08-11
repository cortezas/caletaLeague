import { cn } from '@/lib/cn'
import { initials } from '@/lib/format'

export type AvatarSize = 24 | 30 | 32 | 34 | 38 | 46 | 52 | 62 | 64 | 96

export interface AvatarProps {
  name: string
  color: string
  size: AvatarSize
  /** Anillo del podio: 1.o volt, 2.o #C9D3E0, 3.o #C98B4B. */
  ring?: string
  className?: string
}

/**
 * Cuerpo de letra y radio por tamano, tomados del prototipo.
 * Los dos grandes (64 en perfil, 96 en onboarding) son cuadrados redondeados;
 * el resto son circulos. No es una decision estetica libre: son los dos unicos
 * sitios donde el avatar no compite con otros circulos en la misma fila.
 */
const SPECS: Record<AvatarSize, { font: number; weight: number; radius: string }> = {
  24: { font: 10, weight: 700, radius: '999px' },
  30: { font: 12, weight: 700, radius: '999px' },
  32: { font: 12, weight: 700, radius: '999px' },
  34: { font: 13, weight: 700, radius: '999px' },
  38: { font: 15, weight: 800, radius: '999px' },
  46: { font: 17, weight: 800, radius: '999px' },
  52: { font: 18, weight: 800, radius: '999px' },
  62: { font: 21, weight: 800, radius: '999px' },
  64: { font: 25, weight: 800, radius: '22px' },
  96: { font: 38, weight: 800, radius: '32px' },
}

/**
 * Avatar de iniciales sobre color plano. No hay fotos en el producto.
 * Va `aria-hidden`: el nombre del miembro se renderiza siempre al lado o debajo,
 * y anunciarlo dos veces solo entorpece.
 */
export function Avatar({ name, color, size, ring, className }: AvatarProps) {
  const spec = SPECS[size]

  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex flex-none items-center justify-center font-num text-white', className)}
      style={{
        width: size,
        height: size,
        background: color,
        borderRadius: spec.radius,
        fontSize: spec.font,
        fontWeight: spec.weight,
        letterSpacing: '.02em',
        lineHeight: 1,
        border: ring ? `2.5px solid ${ring}` : undefined,
      }}
    >
      {initials(name)}
    </span>
  )
}
