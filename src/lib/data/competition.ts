/**
 * LaLiga de verdad: clasificacion y maximos goleadores, LEIDOS DE NUESTRA BASE.
 *
 * ESTE FICHERO NO LLAMA A LA API. NUNCA. Quien pide a football-data.org es el
 * cron (`/api/sync` -> `src/lib/football-data/competition.ts`) y guarda en
 * `competition_standings` y `competition_scorers` (migracion 0015). Aqui solo se
 * lee. Doce personas abriendo la pantalla de goleadores no pueden ser doce
 * peticiones.
 *
 * NINGUNA DE LAS DOS LANZA. Ni devuelven `null`. Sin ingesta todavia, sin
 * Supabase configurado, con la tabla sin migrar o con la red caida, devuelven
 * `{ updatedAt: null, rows: [] }` y la pantalla dice que aun no hay datos.
 *
 * Esto no es prudencia decorativa: la racha de la fila de partido sale de
 * `getCompetitionStandings()`, y los goleadores se piden desde la pantalla de
 * pronostico. Si cualquiera de las dos lanzara, una ayuda que falta se llevaria
 * por delante la unica pantalla que la peña NECESITA que funcione el sabado a
 * las 19:30.
 *
 * QUIEN DECIDE SI SE VE: las politicas de 0015, no este codigo. Se consulta con
 * el cliente del USUARIO (`ctx.supabase`), asi que quien no ha entrado recibe
 * cero filas de Postgres. Las dos tablas son datos publicos de LaLiga y no
 * llevan `league_id`: no hay nada que filtrar por peña, y por eso aqui no hay
 * ningun `if` que lo compruebe.
 */

import { TEAMS } from '../laliga'
import type { TeamCode } from '../types'
import type { CompetitionStandingsVM, TeamFormVM, TopScorerVM, TopScorersVM } from '../view-models'
import { getDataContext } from './league'

/**
 * Cuantos goleadores devuelve `getTopScorers()` cuando no se le dice.
 *
 * La ingesta guarda 30; esto es lo que se pinta por defecto. Quien quiera la
 * lista larga pasa el numero: `getTopScorers(30)`.
 */
const DEFAULT_LIMIT = 10

/** Tope duro. Mas alla de lo que guarda la ingesta no hay nada que devolver. */
const MAX_LIMIT = 100

/**
 * Un `team_code` guardado se convierte en `TeamCode` solo si es uno de los 20 de
 * ESTA temporada. La restriccion de la tabla garantiza el formato (3 mayusculas)
 * pero no que el equipo siga en Primera: si la ingesta hubiera escrito un codigo
 * de otra epoca, la pantalla intentaria pintar un escudo que no existe. Se
 * devuelve `null` y el goleador sale sin equipo, que es un estado previsto.
 */
function toTeamCode(raw: unknown): TeamCode | null {
  if (typeof raw !== 'string') return null
  return raw in TEAMS ? (raw as TeamCode) : null
}

/**
 * La racha guardada es `text[]` y la 0015 obliga a que solo tenga W, D o L. Se
 * vuelve a filtrar al leer porque `jsonb`/`text[]` llegan sin tipo por PostgREST
 * y una letra rara pintaria un cuadradito vacio en la fila del partido.
 */
function toForm(raw: unknown): Array<'W' | 'D' | 'L'> {
  if (!Array.isArray(raw)) return []
  const out: Array<'W' | 'D' | 'L'> = []
  for (const entry of raw) {
    if (entry === 'W' || entry === 'D' || entry === 'L') out.push(entry)
  }
  return out
}

function toInt(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : 0
}

/** `null` es "la API no lo da", que no es cero. Se conserva la diferencia. */
function toIntOrNull(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : null
}

/**
 * El instante de la foto. Todas las filas de una misma pasada comparten
 * `updated_at` (lo escribe la ingesta de golpe), asi que el maximo es "cuando se
 * trajo esta tabla" y no "cuando se toco la ultima fila".
 */
function latest(rows: Array<{ updated_at?: unknown }>): string | null {
  let best: string | null = null
  for (const row of rows) {
    const value = typeof row.updated_at === 'string' ? row.updated_at : null
    if (value === null) continue
    if (best === null || value > best) best = value
  }
  return best
}

/**
 * La clasificacion real de LaLiga, ordenada por posicion.
 *
 * Puede venir INCOMPLETA y no es un fallo: la ingesta salta los equipos que no
 * casan con uno de nuestros 20 ids. Mientras la API siga sirviendo la tabla
 * final de la temporada pasada faltaran los tres ascendidos (DEP, MAL y RAC) y
 * sobraran los tres descendidos, que se descartan al entrar.
 */
export async function getCompetitionStandings(): Promise<CompetitionStandingsVM> {
  try {
    const ctx = await getDataContext()
    // Sin backend (modo mock) no hay clasificacion: no se inventa una tabla.
    if (!ctx) return { updatedAt: null, rows: [] }

    const { data, error } = await ctx.supabase
      .from('competition_standings')
      .select('team_code, position, points, played_games, goals_for, goals_against, form, updated_at')
      .order('position', { ascending: true })

    // Un error aqui (tabla sin migrar, red caida) se trata igual que "no hay
    // clasificacion". Ver la cabecera: esto alimenta la fila de partido.
    if (error || !data) return { updatedAt: null, rows: [] }

    const rows: TeamFormVM[] = []
    for (const row of data) {
      const code = toTeamCode(row.team_code)
      if (!code) continue
      rows.push({
        code,
        position: toInt(row.position),
        points: toInt(row.points),
        playedGames: toInt(row.played_games),
        goalsFor: toInt(row.goals_for),
        goalsAgainst: toInt(row.goals_against),
        form: toForm(row.form),
      })
    }

    return { updatedAt: latest(data), rows }
  } catch {
    // Incluye `NoMemberError`: quien no es de la peña no ve nada, y enterarse de
    // eso es cosa de `requireMember()`, no de esta funcion.
    return { updatedAt: null, rows: [] }
  }
}

/**
 * Los maximos goleadores de LaLiga, del que mas lleva al que menos.
 *
 * ESTAR VACIA ES UN ESTADO NORMAL, no un fallo: hasta que se juegue la primera
 * jornada la API devuelve lista vacia y la tabla esta vacia a proposito.
 *
 * @param limit cuantos devolver. Por defecto 10, tope 100. Un numero raro (0,
 *   negativo, decimal, NaN) cae en el valor por defecto en vez de devolver una
 *   lista vacia que pareceria "aun no ha marcado nadie".
 */
export async function getTopScorers(limit: number = DEFAULT_LIMIT): Promise<TopScorersVM> {
  const size =
    Number.isFinite(limit) && limit >= 1 ? Math.min(Math.trunc(limit), MAX_LIMIT) : DEFAULT_LIMIT

  try {
    const ctx = await getDataContext()
    if (!ctx) return { updatedAt: null, rows: [] }

    const { data, error } = await ctx.supabase
      .from('competition_scorers')
      .select('rank, player_name, team_code, goals, assists, updated_at')
      .order('rank', { ascending: true })
      .limit(size)

    if (error || !data) return { updatedAt: null, rows: [] }

    const rows: TopScorerVM[] = []
    for (const row of data) {
      const name = typeof row.player_name === 'string' ? row.player_name.trim() : ''
      // Un goleador sin nombre no se pinta. La ingesta ya lo evita; este es el
      // segundo cerrojo, y sale mas barato que una fila en blanco en la lista.
      if (name === '') continue
      rows.push({
        name,
        teamCode: toTeamCode(row.team_code),
        goals: toInt(row.goals),
        assists: toIntOrNull(row.assists),
      })
    }

    return { updatedAt: latest(data), rows }
  } catch {
    return { updatedAt: null, rows: [] }
  }
}
