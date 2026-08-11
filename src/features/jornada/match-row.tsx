import { ChevronRight, Lock } from 'lucide-react'
import Link from 'next/link'

import { PulseDot, TeamBadge } from '@/components/ui'
import { cn } from '@/lib/cn'
import { scoreLabel } from '@/lib/format'
import type { MatchRowVM, TeamVM } from '@/lib/view-models'

export interface MatchRowProps {
  match: MatchRowVM
}

/**
 * Las cinco variantes de la tabla del handoff (README, "3. Jornada actual").
 * `todo` y `predicted` son el mismo status 'open': lo que las separa es tener
 * pronostico o no.
 */
type RowVariant = 'todo' | 'predicted' | 'locked' | 'live' | 'played'

function variantOf(match: MatchRowVM): RowVariant {
  if (match.status === 'played') return 'played'
  if (match.status === 'live') return 'live'
  if (match.status === 'locked') return 'locked'
  return match.myPrediction ? 'predicted' : 'todo'
}

const CHIP_LABEL: Record<RowVariant, string> = {
  todo: 'Sin pronosticar',
  predicted: 'Pronosticado',
  locked: 'Cerrado',
  live: 'En juego',
  played: 'Jugado',
}

/**
 * Chip local en vez de <Chip>: la variante `locked` pide card2 sobre txt3 y esa
 * pareja no existe entre los seis tonos cerrados de la primitiva. El resto de
 * medidas son las mismas que Chip size="xs".
 */
const CHIP_TONE: Record<RowVariant, string> = {
  todo: 'bg-volt text-volt-ink',
  predicted: 'bg-accent-soft text-accent2',
  locked: 'bg-card2 text-txt3',
  live: 'bg-bad-soft text-bad',
  played: 'bg-card2 text-txt2',
}

const SURFACE: Record<RowVariant, string> = {
  // El degradado arranca en accent-soft y muere en card al 46%: es lo que hace
  // que la unica fila sin pronosticar destaque sin gritar.
  todo: 'border-accent bg-[linear-gradient(180deg,var(--accent-soft)_0%,var(--card)_46%)]',
  predicted: 'border-line bg-card',
  locked: 'border-line bg-bg2',
  live: 'border-line bg-card',
  played: 'border-line bg-card',
}

/** El circulo baja de 26 a 22 px y el nombre de 14.5 a 13 px en la rejilla de escritorio. */
function TeamLine({ team, dimmed }: { team: TeamVM; dimmed: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-[9px] lg:gap-[8px]">
      <span className="flex-none lg:hidden">
        <TeamBadge team={team} size={26} />
      </span>
      <span className="hidden flex-none lg:inline-flex">
        <TeamBadge team={team} size={22} />
      </span>
      <span
        className={cn(
          'min-w-0 truncate text-[14.5px] font-semibold lg:text-[13px]',
          dimmed ? 'text-txt2' : 'text-txt',
        )}
      >
        {team.name}
      </span>
    </span>
  )
}

/** Marcador propio compacto de las variantes sellada y en juego. */
function MyScore({ match }: { match: MatchRowVM }) {
  return (
    <span className="font-num text-[13px] font-bold tracking-[.04em] text-txt3">
      {scoreLabel(match.myPrediction?.home, match.myPrediction?.away)}
    </span>
  )
}

function Tail({ match, variant }: { match: MatchRowVM; variant: RowVariant }) {
  if (variant === 'todo') {
    return (
      <span className="inline-flex items-center gap-[7px] whitespace-nowrap rounded-[14px] bg-accent px-[15px] py-[11px] text-[13.5px] font-extrabold text-accent-ink">
        Pronosticar
        <ChevronRight size={14} strokeWidth={2.6} aria-hidden />
      </span>
    )
  }

  if (variant === 'predicted') {
    return (
      <span className="flex items-center gap-[9px]">
        <span className="flex items-center gap-[5px] rounded-[12px] bg-accent-soft px-[11px] py-[6px]">
          <span className="min-w-[17px] text-center font-num text-[30px] font-bold leading-none tabular-nums text-accent2">
            {match.myPrediction?.home}
          </span>
          <span className="font-num text-[20px] font-bold leading-none text-txt3">–</span>
          <span className="min-w-[17px] text-center font-num text-[30px] font-bold leading-none tabular-nums text-accent2">
            {match.myPrediction?.away}
          </span>
        </span>
        <ChevronRight size={16} strokeWidth={2.2} className="flex-none text-txt3" aria-hidden />
      </span>
    )
  }

  if (variant === 'locked') {
    return (
      <span className="flex items-center gap-[8px]">
        <MyScore match={match} />
        <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[12px] border border-line text-txt3">
          <Lock size={15} strokeWidth={2.1} aria-hidden />
        </span>
      </span>
    )
  }

  if (variant === 'live') {
    return (
      <span className="flex items-center gap-[8px]">
        <MyScore match={match} />
        <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[12px] bg-bad-soft">
          <PulseDot tone="bad" size={8} speed={1.4} />
        </span>
      </span>
    )
  }

  return (
    <span className="flex items-center gap-[10px]">
      <span className="flex flex-col items-end gap-[2px]">
        <span className="text-[9.5px] font-extrabold uppercase tracking-[.08em] text-txt3">Tú</span>
        <span
          className={cn(
            'font-num text-[15px] font-bold tabular-nums',
            match.exactHit ? 'text-ok' : 'text-txt3',
          )}
        >
          {scoreLabel(match.myPrediction?.home, match.myPrediction?.away)}
        </span>
      </span>
      <span aria-hidden className="h-[34px] w-px flex-none bg-line" />
      <span className="font-num text-[30px] font-extrabold leading-none tabular-nums text-txt">
        {scoreLabel(match.result?.home, match.result?.away)}
      </span>
    </span>
  )
}

/**
 * Fila de partido. Server Component envuelto en <Link>: el partido jugado abre
 * el pique y cualquier otro estado abre el editor, que ya se encarga de
 * mostrar el estado sellado si el plazo se paso (README 4b).
 */
export function MatchRow({ match }: MatchRowProps) {
  const variant = variantOf(match)
  const href = variant === 'played' ? `/partido/${match.id}` : `/jornada/${match.id}`

  const rightText =
    variant === 'predicted'
      ? 'Editable'
      : variant === 'locked'
        ? 'Sellado'
        : variant === 'live'
          ? 'Se revela al final'
          : variant === 'played'
            ? `+${match.myPoints ?? 0} pts`
            : null

  const rightTone =
    variant === 'predicted'
      ? 'text-accent2'
      : variant === 'played' && (match.myPoints ?? 0) > 0
        ? 'text-ok'
        : 'text-txt3'

  return (
    <Link
      href={href}
      className={cn(
        'block overflow-hidden rounded-[19px] border shadow-card transition-transform duration-100',
        'active:scale-[.97] active:opacity-90 lg:rounded-[16px] lg:shadow-none',
        SURFACE[variant],
      )}
    >
      <span className="flex items-center gap-[7px] px-[13px] pt-[9px] pb-[7px]">
        <span
          className={cn(
            'inline-flex flex-none items-center rounded-[6px] px-[7px] py-[3px] text-[10.5px] font-extrabold uppercase leading-none tracking-[.09em] whitespace-nowrap lg:text-[9.5px]',
            CHIP_TONE[variant],
          )}
        >
          {CHIP_LABEL[variant]}
        </span>
        <span className="min-w-0 truncate text-[11.5px] font-semibold text-txt3 lg:text-[11px]">
          {match.kickoffLabel}
        </span>
        {/* Sin esto, una hora provisional se lee como si fuera la definitiva y
            alguien se puede perder el cierre de su pronostico. */}
        {match.kickoffProvisional && (
          <span
            title="LaLiga aún no ha publicado el horario definitivo"
            className="flex-none rounded-[6px] bg-card2 px-[6px] py-[2px] text-[9.5px] font-extrabold uppercase leading-[1.4] tracking-[.08em] text-txt3"
          >
            Por confirmar
          </span>
        )}
        <span className="flex-1" />
        {rightText && (
          <span className={cn('flex-none text-[11.5px] font-bold lg:text-[11px]', rightTone)}>
            {rightText}
          </span>
        )}
      </span>

      <span className="flex items-center gap-[10px] px-[13px] pt-[2px] pb-[13px]">
        <span className="flex min-w-0 flex-1 flex-col gap-[7px] lg:gap-[6px]">
          <TeamLine team={match.home} dimmed={variant === 'locked'} />
          <TeamLine team={match.away} dimmed={variant === 'locked'} />
        </span>
        <span className="flex flex-none items-center gap-[9px]">
          <Tail match={match} variant={variant} />
        </span>
      </span>
    </Link>
  )
}
