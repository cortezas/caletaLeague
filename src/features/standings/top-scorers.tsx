import { TeamBadge } from '@/components/ui'
import { TEAMS } from '@/lib/laliga'
import type { TeamVM, TopScorerVM, TopScorersVM } from '@/lib/view-models'

/** Cuantos se pintan de cada lista. Diez es lo que cabe sin scroll infinito. */
const TOP = 10

function teamOf(code: TopScorerVM['teamCode']): TeamVM | null {
  if (!code) return null
  const team = TEAMS[code]
  return { code, name: team.name, color: team.color, ink: team.ink }
}

function Fila({ puesto, row, valor }: { puesto: number; row: TopScorerVM; valor: number }) {
  const team = teamOf(row.teamCode)

  return (
    <li className="flex items-center gap-[10px] py-[7px]">
      <span className="w-[18px] flex-none text-right font-num text-[12.5px] font-bold tabular-nums text-txt3">
        {puesto}
      </span>
      {team ? (
        <TeamBadge team={team} size={22} />
      ) : (
        // Un goleador de un equipo que no reconocemos igual se pinta: el hueco
        // mantiene la rejilla y el nombre es lo que importa.
        <span className="size-[22px] flex-none rounded-full bg-card2" aria-hidden />
      )}
      <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-txt">
        {row.name}
      </span>
      <span className="flex-none font-num text-[15px] font-extrabold tabular-nums text-txt">
        {valor}
      </span>
    </li>
  )
}

/**
 * Pichichi y máximo asistente de LaLiga.
 *
 * Sale de `competition_scorers` (migracion 0015), que llena el cron desde
 * football-data.org. La tabla ya traia las asistencias y no las pintaba nadie.
 *
 * VACIO ES UN ESTADO NORMAL, no un fallo: hasta que se juega la primera jornada
 * la API devuelve lista vacia. Por eso el texto de vacio habla de la temporada y
 * no de un problema.
 *
 * Las asistencias van en su propia lista y no como columna al lado de los goles:
 * la API solo las trae para algunos jugadores (el resto llegan a `null`), asi
 * que una columna compartida saldria medio vacia y pareceria rota. Ordenando por
 * asistencias, quien no tiene dato simplemente no aparece.
 */
export function TopScorers({ data }: { data: TopScorersVM }) {
  const goleadores = data.rows.filter((row) => row.goals > 0).slice(0, TOP)

  const asistentes = [...data.rows]
    .filter((row) => (row.assists ?? 0) > 0)
    .sort((a, b) => (b.assists ?? 0) - (a.assists ?? 0) || a.name.localeCompare(b.name, 'es'))
    .slice(0, TOP)

  if (goleadores.length === 0 && asistentes.length === 0) {
    return (
      <section className="rounded-[17px] border border-line bg-card px-[15px] py-[14px]">
        <h2 className="mb-[6px] text-[14.5px] font-extrabold tracking-[-.02em]">Goleadores</h2>
        <p className="text-[12.5px] font-semibold leading-[1.45] text-txt2">
          Todavía no ha marcado nadie en LaLiga. Aparecerán aquí en cuanto ruede el balón.
        </p>
      </section>
    )
  }

  return (
    <div className="flex flex-col gap-[12px]">
      {goleadores.length > 0 && (
        <section className="rounded-[17px] border border-line bg-card px-[15px] py-[13px]">
          <div className="mb-[4px] flex items-baseline justify-between">
            <h2 className="text-[14.5px] font-extrabold tracking-[-.02em]">Pichichi</h2>
            <span className="text-[11px] font-extrabold uppercase tracking-[.09em] text-txt3">
              Goles
            </span>
          </div>
          <ul className="divide-y divide-line">
            {goleadores.map((row, i) => (
              <Fila key={`${row.name}-${row.teamCode}`} puesto={i + 1} row={row} valor={row.goals} />
            ))}
          </ul>
        </section>
      )}

      {asistentes.length > 0 && (
        <section className="rounded-[17px] border border-line bg-card px-[15px] py-[13px]">
          <div className="mb-[4px] flex items-baseline justify-between">
            <h2 className="text-[14.5px] font-extrabold tracking-[-.02em]">Asistencias</h2>
            <span className="text-[11px] font-extrabold uppercase tracking-[.09em] text-txt3">
              Pases de gol
            </span>
          </div>
          <ul className="divide-y divide-line">
            {asistentes.map((row, i) => (
              <Fila
                key={`${row.name}-${row.teamCode}`}
                puesto={i + 1}
                row={row}
                valor={row.assists ?? 0}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
