import { TeamBadge } from '@/components/ui'
import type { LineupPlayerVM, TeamLineupVM, TeamVM } from '@/lib/view-models'

export interface PitchProps {
  home: TeamVM
  away: TeamVM
  homeLineup: TeamLineupVM | null
  awayLineup: TeamLineupVM | null
}

/** De porteria a delantera. Es el orden de la mitad de ARRIBA; abajo se invierte. */
const ORDER = ['GK', 'DEF', 'MID', 'FWD'] as const

/**
 * Particulas que pertenecen al apellido: sin esto "Rodrigo De Paul" se quedaria
 * en "Paul". Nunca se consume la primera palabra, que es el nombre de pila.
 */
const PARTICLES = new Set([
  'de', 'del', 'da', 'das', 'di', 'do', 'dos', 'van', 'von', 'der', 'den',
  'la', 'le', 'el', 'al', 'bin', 'ben', 'mac', 'mc', 'st',
])

export function shortName(name: string): string {
  const clean = name.trim()
  const parts = clean.split(/\s+/)
  if (parts.length <= 1) return clean

  let i = parts.length - 1
  while (i > 1 && PARTICLES.has(parts[i - 1].toLowerCase())) i--
  return parts.slice(i).join(' ')
}

function PlayerToken({ player, team }: { player: LineupPlayerVM; team: TeamVM }) {
  return (
    // La base de 46px con `flex-wrap` es el seguro: una linea normal (2 a 5
    // jugadores) sigue repartiendose a lo ancho, y una demarcacion rara que
    // amontone ocho en la misma banda salta a una segunda fila en vez de
    // aplastar los dorsales.
    <li className="flex min-w-0 flex-[1_1_46px] flex-col items-center gap-[3px]">
      {/* Dos cercos, y los dos hacen falta: el halo exterior del color del fondo
          despega el dorsal del cesped (si no, un equipo verde como el Betis se
          funde con el campo) y el filo interior perfila la camiseta blanca del
          Madrid, que en tema claro es casi del color del cesped palido. */}
      <span
        className="flex h-[28px] w-[28px] flex-none items-center justify-center rounded-full border border-line2 font-num text-[13.5px] font-bold leading-none ring-2 ring-bg2"
        style={{ background: team.color, color: team.ink }}
      >
        {player.number ?? '·'}
      </span>
      <span className="w-full truncate text-center text-[9.5px] font-bold leading-[1.25] text-txt">
        {shortName(player.name)}
      </span>
    </li>
  )
}

function Half({
  team,
  lineup,
  side,
}: {
  team: TeamVM
  lineup: TeamLineupVM | null
  side: 'top' | 'bottom'
}) {
  const starters = lineup?.starters ?? []
  const lines = ORDER.map((position) => starters.filter((p) => p.position === position))
  // Arriba se lee porteria -> delantera; abajo, al reves.
  const ordered = side === 'top' ? lines : [...lines].reverse()

  if (starters.length === 0) {
    return (
      <div className="flex min-h-[150px] flex-1 items-center justify-center px-[16px]">
        <p className="text-[12px] font-bold text-txt2">Sin alineación de {team.name}</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-[150px] flex-1 flex-col justify-around gap-[10px] px-[6px] py-[12px]">
      {ordered.map((players, index) =>
        players.length === 0 ? null : (
          <ul key={index} className="flex flex-wrap items-start justify-evenly gap-[2px]">
            {players.map((player, i) => (
              <PlayerToken key={`${player.name}-${i}`} player={player} team={team} />
            ))}
          </ul>
        ),
      )}
    </div>
  )
}

function TeamLine({
  team,
  formation,
  role,
}: {
  team: TeamVM
  formation: string | null
  role: string
}) {
  return (
    <div className="flex items-center gap-[8px]">
      <TeamBadge team={team} size={22} />
      <span className="min-w-0 truncate text-[13px] font-extrabold tracking-[-.01em]">
        {team.name}
      </span>
      <span className="text-[10px] font-extrabold uppercase tracking-[.11em] text-txt3">{role}</span>
      {formation && (
        <span className="ml-auto flex-none rounded-[8px] border border-line bg-card2 px-[7px] py-[2px] font-num text-[12px] font-bold tabular-nums text-txt2">
          {formation}
        </span>
      )}
    </div>
  )
}

/**
 * UN SOLO campo vertical con el visitante arriba y el local abajo, no dos campos
 * apilados: dos cespedes duplican el scroll en un movil de 375px y parten en dos
 * un enfrentamiento que se lee mejor de una pieza, como en la tele.
 *
 * Los once se colocan agrupando por `position`, NO interpretando la cadena de
 * formacion: '4-4-2' solo se pinta como texto junto al nombre del equipo.
 */
export function Pitch({ home, away, homeLineup, awayLineup }: PitchProps) {
  return (
    <div className="flex flex-col gap-[9px]">
      <TeamLine team={away} formation={awayLineup?.formation ?? null} role="Visitante" />

      <div
        className="relative overflow-hidden rounded-[20px] border border-line bg-ok-soft"
        /* Franjas de siega con --line: es translucida, asi que en claro sale
           oscura y en oscuro clara sin inventar ningun token nuevo. */
        style={{
          backgroundImage: 'repeating-linear-gradient(180deg, var(--line) 0 34px, transparent 34px 68px)',
        }}
      >
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line2" />
          <div className="absolute left-1/2 top-1/2 h-[78px] w-[78px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-line2" />
          <div className="absolute left-1/2 top-0 h-[42px] w-[54%] -translate-x-1/2 rounded-b-[8px] border border-t-0 border-line2" />
          <div className="absolute bottom-0 left-1/2 h-[42px] w-[54%] -translate-x-1/2 rounded-t-[8px] border border-b-0 border-line2" />
        </div>

        <div className="relative flex flex-col">
          <Half team={away} lineup={awayLineup} side="top" />
          <Half team={home} lineup={homeLineup} side="bottom" />
        </div>
      </div>

      <TeamLine team={home} formation={homeLineup?.formation ?? null} role="Local" />
    </div>
  )
}
