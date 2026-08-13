import { Table2 } from 'lucide-react'

import { EmptyState, TeamBadge } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatKickoff } from '@/lib/format'
import { TEAMS } from '@/lib/laliga'
import type { TeamCode } from '@/lib/types'
import type { CompetitionStandingsVM, TeamVM } from '@/lib/view-models'

export interface CompetitionTableProps {
  standings: CompetitionStandingsVM
}

/**
 * Cuantos puestos se tintan arriba y abajo.
 *
 * El descenso NO se cuenta como "las tres ultimas FILAS que hayan llegado", se
 * cuenta por PUESTO sobre el tamano de la competicion. La diferencia se ve hoy
 * mismo: la tabla que sirve la API es la final de 2025/26 y le faltan los clubes
 * que bajaron (no estan en `TEAMS`, que son los 20 de 2026/27), asi que sus
 * ultimas tres filas son los puestos 15, 16 y 18. Tintar esas seria decir que el
 * Sevilla bajo, que es sencillamente falso.
 */
const CHAMPIONS = 3
const RELEGATION = 3
/** LaLiga son 20 equipos, los mismos que hay en `TEAMS`. */
const LEAGUE_SIZE = Object.keys(TEAMS).length

/**
 * Ficha visual del club. Un codigo que no este en `TEAMS` (un ascendido que aun
 * no se ha añadido a laliga.ts) no revienta la tabla: sale con su sigla y un
 * gris neutro, igual que hace `teamVM` en la capa de datos.
 */
function teamOf(code: TeamCode): TeamVM {
  const team = TEAMS[code]
  if (!team) return { code, name: code, color: '#2A2F3A', ink: '#FFFFFF' }
  return { code, name: team.name, color: team.color, ink: team.ink }
}

function goalDiffLabel(diff: number): string {
  return diff > 0 ? `+${diff}` : String(diff)
}

/**
 * La tabla real de LaLiga EA Sports.
 *
 * QUE COLUMNAS Y POR QUE
 * Puesto, escudo, nombre, PJ, DG y PTS. En 375px de ancho el nombre del club ya
 * se lleva todo el espacio flexible, asi que caben tres columnas numericas y no
 * seis. Se van G, E y P (se deducen de PJ y PTS con un vistazo, y ninguna decide
 * nada) y se van GF y GC en favor de DG, que es UNA columna que dice lo mismo y
 * es ademas el primer criterio de desempate de LaLiga. PJ se queda porque sin el
 * no se sabe si un equipo lidera por bueno o por tener un partido mas.
 *
 * Los tres primeros (Champions) y los tres ultimos (descenso) llevan el puesto
 * tintado, con `accent` y `bad`: los dos tokens que ya existen para "esto es lo
 * bueno" y "esto es lo malo". No hay ninguno nuevo.
 */
export function CompetitionTable({ standings }: CompetitionTableProps) {
  if (standings.rows.length === 0) {
    return (
      <EmptyState
        icon={<Table2 size={34} strokeWidth={1.9} aria-hidden />}
        title="La tabla de LaLiga no está disponible"
        description="Se actualiza sola en cuanto LaLiga publica los resultados de la jornada. Vuelve a entrar en un rato."
      />
    )
  }

  // Nunca por debajo de los 20 de LaLiga: una tabla incompleta no puede mover el
  // descenso hacia arriba.
  const lastPosition = Math.max(LEAGUE_SIZE, ...standings.rows.map((row) => row.position))
  const relegationFrom = lastPosition - RELEGATION
  const hasRelegation = standings.rows.some((row) => row.position > relegationFrom)

  return (
    <div className="px-[14px] pt-[16px] pb-[30px]">
      <table className="w-full table-fixed border-separate border-spacing-0">
        <caption className="sr-only">
          Clasificación de LaLiga EA Sports: puesto, equipo, partidos jugados, diferencia de goles y
          puntos.
        </caption>
        <colgroup>
          <col className="w-[30px]" />
          <col />
          <col className="w-[30px]" />
          <col className="w-[38px]" />
          <col className="w-[34px]" />
        </colgroup>
        <thead>
          <tr className="text-[11px] font-extrabold uppercase tracking-[.09em] text-txt3">
            <th scope="col" className="pb-[7px] text-center font-extrabold">
              <span className="sr-only">Puesto</span>
              <span aria-hidden>#</span>
            </th>
            <th scope="col" className="pb-[7px] pl-[8px] text-left font-extrabold">
              Equipo
            </th>
            <th scope="col" className="pb-[7px] text-center font-extrabold">
              <abbr title="Partidos jugados" className="no-underline">
                PJ
              </abbr>
            </th>
            <th scope="col" className="pb-[7px] text-center font-extrabold">
              <abbr title="Diferencia de goles" className="no-underline">
                DG
              </abbr>
            </th>
            <th scope="col" className="pb-[7px] text-right font-extrabold">
              <abbr title="Puntos" className="no-underline">
                PTS
              </abbr>
            </th>
          </tr>
        </thead>
        <tbody>
          {standings.rows.map((row) => {
            const team = teamOf(row.code)
            const diff = row.goalsFor - row.goalsAgainst
            const champions = row.position <= CHAMPIONS
            const relegated = row.position > relegationFrom

            return (
              <tr key={row.code} className="align-middle">
                <td className="border-t border-line py-[9px] text-center">
                  <span
                    className={cn(
                      'inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[7px] font-num text-[14px] font-extrabold',
                      champions && 'bg-accent-soft text-accent',
                      relegated && 'bg-bad-soft text-bad',
                      !champions && !relegated && 'text-txt3',
                    )}
                  >
                    {row.position}
                  </span>
                </td>
                <td className="border-t border-line py-[9px] pl-[8px]">
                  <span className="flex min-w-0 items-center gap-[8px]">
                    <TeamBadge team={team} size={22} />
                    <span className="min-w-0 truncate text-[14px] font-semibold">{team.name}</span>
                  </span>
                </td>
                <td className="border-t border-line py-[9px] text-center font-num text-[15px] font-bold text-txt2">
                  {row.playedGames}
                </td>
                <td
                  className={cn(
                    'border-t border-line py-[9px] text-center font-num text-[15px] font-bold',
                    diff > 0 ? 'text-ok' : diff < 0 ? 'text-bad' : 'text-txt3',
                  )}
                >
                  {goalDiffLabel(diff)}
                </td>
                <td className="border-t border-line py-[9px] text-right font-num text-[18px] font-extrabold">
                  {row.points}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="mt-[14px] flex flex-wrap items-center gap-x-[16px] gap-y-[6px] text-[11.5px] font-semibold text-txt3">
        <span className="flex items-center gap-[6px]">
          <span aria-hidden className="h-[10px] w-[10px] flex-none rounded-[3px] bg-accent" />
          Champions
        </span>
        {hasRelegation && (
          <span className="flex items-center gap-[6px]">
            <span aria-hidden className="h-[10px] w-[10px] flex-none rounded-[3px] bg-bad" />
            Descenso
          </span>
        )}
      </div>

      {standings.updatedAt && (
        <p className="mt-[10px] text-[11.5px] font-semibold text-txt3">
          Actualizado {formatKickoff(standings.updatedAt)}
        </p>
      )}
    </div>
  )
}
