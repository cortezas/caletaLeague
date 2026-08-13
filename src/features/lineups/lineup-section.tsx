import { Users } from 'lucide-react'
import { cache } from 'react'

import { EmptyState, SectionLabel, TeamBadge } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatKickoff, plural } from '@/lib/format'
import type { MatchLineupsVM, TeamLineupVM, TeamVM } from '@/lib/view-models'

import { Pitch, shortName } from './pitch'

export interface LineupSectionProps {
  lineups: MatchLineupsVM
  home: TeamVM
  away: TeamVM
  kickoffAt: string
  /** El padding horizontal lo pone la pantalla, que ya tiene el suyo. */
  className?: string
}

/**
 * Un unico "ahora" por peticion. `Date.now()` a pelo dentro del render es una
 * llamada impura (la marca `react-hooks/purity`): memoizarlo con `cache()` deja
 * el componente puro y ademas garantiza que, si la pantalla pintara dos partidos,
 * los dos midieran contra el mismo instante.
 */
const requestNow = cache(() => Date.now())

/**
 * Texto del estado vacio, que es el que se ve la mayor parte del tiempo. La
 * regla no cambia nunca (salen sobre una hora antes del pitido inicial); lo que
 * cambia es cuanto falta, y decirlo evita que alguien recargue doce veces un
 * partido que es el martes que viene.
 */
function waitingCopy(kickoffAt: string, now: number): string {
  const minutes = Math.round((new Date(kickoffAt).getTime() - now) / 60000)

  if (minutes <= 0) {
    return 'Salen sobre una hora antes del pitido inicial; en este partido no llegaron a guardarse.'
  }
  if (minutes <= 75) {
    return 'Salen sobre una hora antes del pitido inicial, así que están al caer.'
  }
  if (minutes < 24 * 60) {
    // Hacia arriba: con `round`, a 76 minutos del partido pondria "queda 1 hora"
    // justo despues de haber dejado de decir "estan al caer", y se leeria como
    // que ya tendrian que estar publicadas.
    const hours = Math.ceil(minutes / 60)
    return `Salen sobre una hora antes del pitido inicial, y para este quedan ${plural(hours, 'hora', 'horas')}.`
  }
  // Hacia abajo, al reves que las horas: dos partidos del MISMO sabado no pueden
  // decir uno "dentro de 2 días" y el otro "dentro de 3" por jugarse a horas
  // distintas. Con `floor` los dos dicen 2, y la fecha exacta va al lado.
  const days = Math.floor(minutes / (24 * 60))
  return `Salen sobre una hora antes del pitido inicial. Este se juega el ${formatKickoff(kickoffAt)}, dentro de ${plural(days, 'día', 'días')}.`
}

function Substitutes({ team, lineup }: { team: TeamVM; lineup: TeamLineupVM | null }) {
  const substitutes = lineup?.substitutes ?? []
  if (substitutes.length === 0) return null

  return (
    <div>
      <div className="flex items-center gap-[7px]">
        <TeamBadge team={team} size={18} />
        <SectionLabel>Suplentes · {team.name}</SectionLabel>
      </div>
      <ul className="mt-[7px] flex flex-wrap gap-x-[12px] gap-y-[4px]">
        {substitutes.map((player, i) => (
          <li key={`${player.name}-${i}`} className="text-[12.5px] font-semibold text-txt2">
            <span className="font-num font-bold tabular-nums text-txt3">{player.number ?? '·'}</span>{' '}
            {shortName(player.name)}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Alineaciones de un partido. NUNCA llama a la API: pinta lo que la capa de
 * datos tenga guardado (ver `getMatchLineups` en `@/lib/data`), que es lo que
 * deja el cron una hora antes del pitido inicial.
 *
 * Nada de aqui es tactil a proposito: es informacion para mirar, no para tocar,
 * asi que no hay ningun destino que tenga que llegar a los 44px.
 */
export function LineupSection({ lineups, home, away, kickoffAt, className }: LineupSectionProps) {
  if (!lineups.available) {
    return (
      <section className={className} aria-label="Alineaciones">
        <EmptyState
          icon={<Users size={30} strokeWidth={1.7} aria-hidden />}
          title="Alineaciones aún no disponibles"
          description={waitingCopy(kickoffAt, requestNow())}
        />
      </section>
    )
  }

  return (
    <section className={cn('flex flex-col gap-[14px]', className)} aria-label="Alineaciones">
      <div className="flex items-baseline justify-between gap-[12px]">
        <h2 className="text-[15px] font-extrabold tracking-[-.02em]">Alineaciones</h2>
        {lineups.fetchedAt && (
          <p className="flex-none text-[11.5px] font-bold text-txt3">
            Guardadas {formatKickoff(lineups.fetchedAt)}
          </p>
        )}
      </div>

      <Pitch home={home} away={away} homeLineup={lineups.home} awayLineup={lineups.away} />

      <Substitutes team={away} lineup={lineups.away} />
      <Substitutes team={home} lineup={lineups.home} />
    </section>
  )
}
