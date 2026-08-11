import { crestFile, kitOf } from '@/lib/crests'
import type { TeamVM } from '@/lib/view-models'

export type TeamBadgeSize = 18 | 22 | 26 | 34 | 44 | 46

export interface TeamBadgeProps {
  team: TeamVM
  size: TeamBadgeSize
}

/** Cuerpo de letra y tracking por tamano, tal cual el prototipo. */
const SPECS: Record<TeamBadgeSize, { font: number; tracking: string }> = {
  18: { font: 8, tracking: '0' },
  22: { font: 9.5, tracking: '0' },
  26: { font: 11, tracking: '.03em' },
  34: { font: 13, tracking: '0' },
  44: { font: 16, tracking: '.03em' },
  46: { font: 16, tracking: '0' },
}

/**
 * Distintivo circular del club: patron de equipacion original mas la sigla de
 * 3 letras. Si el club tiene escudo declarado en `CREST_FILES` se pinta ese en
 * su lugar. Ver src/lib/crests.ts para el por que y para como anadirlos.
 *
 * `aria-hidden` porque el nombre del equipo va siempre visible en la misma fila.
 */
export function TeamBadge({ team, size }: TeamBadgeProps) {
  const spec = SPECS[size]
  const crest = crestFile(team.code)

  if (crest) {
    return (
      <span
        aria-hidden="true"
        className="inline-flex flex-none items-center justify-center rounded-full bg-card2"
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- fichero local
            de tamano fijo y conocido; next/image no aporta nada y anade config */}
        <img
          src={crest}
          alt=""
          width={size}
          height={size}
          className="size-full rounded-full object-contain"
        />
      </span>
    )
  }

  const kit = kitOf(team.code)
  // El patron se atenua en los tamanos pequenos, donde la sigla manda.
  const patternOpacity = size < 26 ? 0.3 : 0.6
  // Halo a contraluz: sin esto una sigla blanca sobre las rayas blancas del
  // Girona o del Betis simplemente desaparece.
  const halo = isLight(team.ink)
    ? '0 0 2px rgba(0,0,0,.9), 0 1px 2px rgba(0,0,0,.65)'
    : '0 0 2px rgba(255,255,255,.9), 0 1px 2px rgba(255,255,255,.65)'

  return (
    <span
      aria-hidden="true"
      className="relative inline-flex flex-none items-center justify-center overflow-hidden rounded-full font-num font-bold"
      style={{
        width: size,
        height: size,
        background: team.color,
        color: team.ink,
        fontSize: spec.font,
        letterSpacing: spec.tracking,
        lineHeight: 1,
      }}
    >
      {kit.kind !== 'plain' && (
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 size-full"
          style={{ opacity: patternOpacity }}
        >
          {kit.kind === 'stripes' &&
            Array.from({ length: kit.count ?? 7 }).map((_, i) =>
              i % 2 === 1 ? (
                <rect
                  key={i}
                  x={(100 / (kit.count ?? 7)) * i}
                  y="0"
                  width={100 / (kit.count ?? 7)}
                  height="100"
                  fill={kit.alt}
                />
              ) : null,
            )}
          {kit.kind === 'halves' && <rect x="50" y="0" width="50" height="100" fill={kit.alt} />}
          {kit.kind === 'sash' && (
            <path d="M 100 0 L 100 34 L 34 100 L 0 100 Z" fill={kit.alt} />
          )}
        </svg>
      )}
      <span className="relative" style={{ textShadow: kit.kind === 'plain' ? undefined : halo }}>
        {team.code}
      </span>
    </span>
  )
}

/** Luminancia relativa aproximada, suficiente para decidir el color del halo. */
function isLight(hex: string): boolean {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6
}
