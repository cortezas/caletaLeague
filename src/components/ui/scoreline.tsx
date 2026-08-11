import { scoreLabel } from '@/lib/format'

export type ScorelineSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'
export type ScorelineTone = 'txt' | 'txt3' | 'accent2' | 'ok' | 'warn'

export interface ScorelineProps {
  home: number | null
  away: number | null
  size: ScorelineSize
  tone?: ScorelineTone
  /** U+2013 (guion medio) por defecto; el guion corto solo donde el ancho aprieta. */
  separator?: '–' | '-'
}

/**
 * Escala de marcador del handoff: 19 fila / 30 pildora de fila / 40 sellado /
 * 54 resultado real / 62 editor de pronostico. El interletraje se abre en los
 * tamanos pequenos y se cierra en los grandes, que es lo que hace Barlow.
 */
const SPECS: Record<ScorelineSize, { font: number; leading: number; tracking: string }> = {
  xs: { font: 19, leading: 1, tracking: '.04em' },
  sm: { font: 30, leading: 1, tracking: '.04em' },
  md: { font: 40, leading: 1, tracking: '.02em' },
  lg: { font: 54, leading: 0.9, tracking: '.01em' },
  xl: { font: 62, leading: 0.9, tracking: '-.01em' },
}

const TONES: Record<ScorelineTone, string> = {
  txt: 'text-txt',
  txt3: 'text-txt3',
  accent2: 'text-accent2',
  ok: 'text-ok',
  warn: 'text-warn',
}

/** Marcador. Con cualquiera de los dos lados a null pinta el placeholder '· ·'. */
export function Scoreline({ home, away, size, tone = 'txt', separator = '–' }: ScorelineProps) {
  const spec = SPECS[size]

  return (
    <span
      className={`font-num font-extrabold tabular-nums ${TONES[tone]}`}
      style={{ fontSize: spec.font, lineHeight: spec.leading, letterSpacing: spec.tracking }}
    >
      {scoreLabel(home, away, separator)}
    </span>
  )
}
