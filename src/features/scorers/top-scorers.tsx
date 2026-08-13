import { ChevronDown, ChevronUp, Goal } from 'lucide-react'

import { TeamBadge } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatKickoff } from '@/lib/format'
import { TEAMS } from '@/lib/laliga'
import type { TeamCode } from '@/lib/types'
import type { TeamVM, TopScorersVM, TopScorerVM } from '@/lib/view-models'

export interface TopScorersProps {
  scorers: TopScorersVM
  /** Los dos equipos del partido que se esta pronosticando. */
  home: TeamVM
  away: TeamVM
  className?: string
}

/**
 * `TEAMS` es el mapa de los veinte, pero la sigla llega de la API: si algun dia
 * manda una que no tenemos mapeada, mejor fila sin distintivo que fila rota.
 */
function badgeTeam(code: TeamCode): TeamVM | null {
  const team = TEAMS[code]
  if (!team) return null
  return { code, name: team.name, color: team.color, ink: team.ink }
}

function playsHere(scorer: TopScorerVM, home: TeamVM, away: TeamVM): boolean {
  if (scorer.teamCode === null) return false
  return scorer.teamCode === home.code || scorer.teamCode === away.code
}

/** El texto del desplegable cerrado: lo unico que se ve sin tocar nada. */
function subtitleOf(total: number, playing: number): string {
  if (total === 0) return 'Aún no hay goles esta temporada'
  if (playing === 0) return `Ninguno de los ${total} juega este partido`
  if (playing === 1) return `1 de los ${total} juega este partido`
  return `${playing} de los ${total} juegan este partido`
}

function ScorerRow({
  scorer,
  position,
  highlight,
  showAssists,
}: {
  scorer: TopScorerVM
  position: number
  highlight: boolean
  showAssists: boolean
}) {
  const team = scorer.teamCode ? badgeTeam(scorer.teamCode) : null

  return (
    <li
      className={cn(
        'flex items-center gap-[9px] rounded-[11px] px-[8px] py-[7px]',
        highlight && 'bg-accent-soft',
      )}
    >
      <span
        className={cn(
          'w-[19px] flex-none text-right font-num text-[12.5px] font-bold tabular-nums',
          highlight ? 'text-accent2' : 'text-txt3',
        )}
      >
        {position}
      </span>

      {/* Sin sigla mapeada el hueco se reserva igual: si no, las filas de al lado
          bailan y la columna de nombres deja de leerse en vertical. */}
      <span className="flex h-[18px] w-[18px] flex-none items-center justify-center">
        {team && <TeamBadge team={team} size={18} />}
      </span>

      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[13px] font-semibold',
          highlight ? 'text-accent2' : 'text-txt',
        )}
      >
        {scorer.name}
      </span>

      {/* El color no basta: quien no distingue el violeta necesita leerlo. */}
      {highlight && (
        <span className="flex-none rounded-[6px] bg-accent px-[6px] py-[2px] text-[9px] font-extrabold uppercase leading-[1.5] tracking-[.07em] text-accent-ink">
          Juega
        </span>
      )}

      {/* Los numeros pelados no se entienden con lector de pantalla: "12" a secas
          no dice si son goles o asistencias. La palabra va en `sr-only`, que es
          lo unico que no cabe en la columna. */}
      <span className="w-[24px] flex-none text-right font-num text-[15px] font-extrabold tabular-nums text-txt">
        {scorer.goals}
        <span className="sr-only"> {scorer.goals === 1 ? 'gol' : 'goles'}</span>
      </span>

      {showAssists && (
        <span className="w-[22px] flex-none text-right font-num text-[13px] font-bold tabular-nums text-txt3">
          {scorer.assists ?? '·'}
          <span className="sr-only">
            {scorer.assists === null
              ? ' asistencias sin dato'
              : scorer.assists === 1
                ? ' asistencia'
                : ' asistencias'}
          </span>
        </span>
      )}
    </li>
  )
}

/**
 * Maximos goleadores de LaLiga dentro de la pantalla de pronostico.
 *
 * POR QUE UN DESPLEGABLE Y NO UNA LISTA ABIERTA
 * La pantalla ya lleva marcador, MVP, goleadores, asistentes y alineaciones. Una
 * lista de veinte nombres siempre abierta la parte en dos. `<details>` nativo:
 * sin JavaScript, sin hidratacion y con el desplegar/plegar que el sistema ya
 * sabe anunciar al lector de pantalla.
 *
 * POR QUE AQUI Y NO EN UNA PANTALLA APARTE
 * Porque se destacan los que juegan ESTE partido, que son los unicos que se
 * pueden poner de goleador. Esa es toda la gracia: la lista sin el partido
 * delante es una curiosidad, con el partido delante es la ayuda para decidir.
 *
 * Nada de esto llama a ninguna API: pinta lo que la capa de datos tenga
 * guardado, y con la lista vacia (que es lo normal hasta que ruede el balon)
 * dice por que esta vacia en vez de no aparecer.
 */
export function TopScorers({ scorers, home, away, className }: TopScorersProps) {
  const rows = scorers.rows
  const playingCount = rows.filter((scorer) => playsHere(scorer, home, away)).length
  // La columna de asistencias solo existe si alguien tiene el dato: una columna
  // entera de puntitos no informa de nada.
  const showAssists = rows.some((scorer) => scorer.assists !== null)

  return (
    <details className={cn('group rounded-[16px] border border-line bg-card', className)}>
      <summary className="flex min-h-[52px] cursor-pointer list-none items-center gap-[11px] px-[14px] py-[10px] [&::-webkit-details-marker]:hidden">
        <Goal size={17} strokeWidth={2.1} aria-hidden className="flex-none text-txt3" />
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-extrabold tracking-[-.01em] text-txt">
            Máximos goleadores de LaLiga
          </span>
          <span className="block truncate text-[11.5px] font-semibold text-txt3">
            {subtitleOf(rows.length, playingCount)}
          </span>
        </span>
        {/* Dos iconos que se intercambian, y no uno que gira: en esta version de
            Tailwind `group-open:rotate-180` SI encaja con el elemento pero el
            valor acaba resolviendose a 0deg, o sea que la flecha nunca se da la
            vuelta (comprobado en el navegador). El intercambio por `display` no
            depende de nada de eso, y al ser instantaneo tampoco tiene que
            respetar `prefers-reduced-motion`. */}
        <ChevronDown
          size={17}
          strokeWidth={2.4}
          aria-hidden
          className="flex-none text-txt3 group-open:hidden"
        />
        <ChevronUp
          size={17}
          strokeWidth={2.4}
          aria-hidden
          className="hidden flex-none text-txt3 group-open:block"
        />
      </summary>

      <div className="border-t border-line px-[8px] pt-[8px] pb-[10px]">
        {rows.length === 0 ? (
          <p className="px-[8px] py-[10px] text-[12.5px] font-semibold leading-[1.5] text-txt2">
            Todavía no se ha marcado ningún gol esta temporada. La lista aparece sola en cuanto
            empiece a rodar el balón.
          </p>
        ) : (
          <>
            {showAssists && (
              <div
                aria-hidden
                className="flex items-center gap-[9px] px-[8px] pb-[5px] text-[9.5px] font-extrabold uppercase tracking-[.08em] text-txt3"
              >
                <span className="flex-1" />
                <span className="w-[24px] flex-none text-right">G</span>
                <span className="w-[22px] flex-none text-right">A</span>
              </div>
            )}
            <ol className="flex flex-col gap-[1px]">
              {rows.map((scorer, i) => (
                <ScorerRow
                  key={`${scorer.name}-${scorer.teamCode ?? '?'}-${i}`}
                  scorer={scorer}
                  position={i + 1}
                  highlight={playsHere(scorer, home, away)}
                  showAssists={showAssists}
                />
              ))}
            </ol>
          </>
        )}

        {scorers.updatedAt && (
          <p className="px-[8px] pt-[9px] text-[11px] font-bold text-txt3">
            Actualizado {formatKickoff(scorers.updatedAt)}
          </p>
        )}
      </div>
    </details>
  )
}
