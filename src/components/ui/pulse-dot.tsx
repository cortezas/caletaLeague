import { cn } from '@/lib/cn'

export interface PulseDotProps {
  tone: 'warn' | 'bad' | 'ok' | 'accent'
  size?: 7 | 8
  /** Segundos por ciclo: 1.4 para 'en juego', 1.6 para la cuenta atras. */
  speed?: 1.4 | 1.6
}

const TONES = {
  warn: 'bg-warn',
  bad: 'bg-bad',
  ok: 'bg-ok',
  accent: 'bg-accent',
} as const

/** Punto de estado en vivo. Decorativo: el estado va escrito al lado. */
export function PulseDot({ tone, size = 7, speed = 1.6 }: PulseDotProps) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block flex-none animate-livedot rounded-full', TONES[tone])}
      // La duracion del token es 1.6s; 1.4s se pisa aqui porque no hay utilidad
      // de Tailwind para una duracion de animacion arbitraria por variante.
      style={{ width: size, height: size, animationDuration: `${speed}s` }}
    />
  )
}
