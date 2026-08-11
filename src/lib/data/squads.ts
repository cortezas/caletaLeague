/**
 * Plantillas de un partido y nombres que la peña ya ha usado.
 *
 * PARA QUE SIRVE CADA UNA
 *  - `getSquadsForMatch` alimenta los CHIPS de jugador del editor. La ingesta
 *    llena `team_squads` desde football-data.org y el organizador la corrige a
 *    mano; si de un equipo no hay fila, devuelve `[]` y el editor cae solo en
 *    modo texto libre.
 *  - `getUsedPlayerNames` alimenta el autocompletado. El texto libre sigue
 *    disponible SIEMPRE, no solo cuando falta la plantilla: la ficha del
 *    Atlético en la API trae 5 jugadores y a otros equipos les faltan fichajes,
 *    asi que obligar a elegir de la lista dejaria tirada a la peña.
 *
 * DEDUPLICACION
 * Se deduplica por nombre NORMALIZADO (`normalizePlayer`) y se conserva la
 * PRIMERA forma escrita, para que no convivan "Mbappe" y "Mbappé" en el
 * desplegable. Es la misma regla que aplica `public.norm_player` en SQL al
 * puntuar, asi que lo que se sugiere y lo que puntua no pueden discrepar.
 */

import { normalizePlayer } from '../squads'
import type { TeamCode } from '../types'
import { getDataContext, getLeagueSquads } from './league'
import { mockGetSquadsForMatch, mockGetUsedPlayerNames } from './mock'

export type MatchSquad = { code: TeamCode; players: string[] }

/**
 * Plantillas de los dos equipos, en orden [local, visitante]. Nunca `null`:
 * un equipo sin fila en `team_squads` sale con `players: []`.
 */
export async function getSquadsForMatch(
  homeCode: TeamCode,
  awayCode: TeamCode,
): Promise<MatchSquad[]> {
  const ctx = await getDataContext()
  if (!ctx) return mockGetSquadsForMatch(homeCode, awayCode)

  const squads = await getLeagueSquads()
  return [homeCode, awayCode].map((code) => ({ code, players: squads.get(code) ?? [] }))
}

/**
 * Cuantos pronosticos se miran para el autocompletado. Con 12 personas y 380
 * partidos la temporada entera son ~4560 filas, y PostgREST corta en 1000
 * (`max_rows` de supabase/config.toml). Se pide menos a proposito y ordenado por
 * fecha de edicion descendente: lo reciente es lo que alguien va a volver a
 * escribir, y una lista de sugerencias no gana nada por ser exhaustiva.
 */
const PREDICTION_SAMPLE = 500
const RESULT_SAMPLE = 200

type NameRow = { mvp: string | null; scorers: string[] | null; assists: string[] | null }
type ResultRow = {
  real_mvp: string | null
  real_scorers: string[] | null
  real_assists: string[] | null
}

/**
 * Nombres distintos ya usados en la peña, de mas reciente a mas antiguo.
 *
 * Primero los de los RESULTADOS reales (los escribe el organizador, asi que son
 * la forma canonica del nombre) y despues los de los pronosticos. Vacio mientras
 * nadie haya escrito ninguno, que es el estado normal al arrancar la liga.
 *
 * No filtra pronosticos ajenos a mano: RLS ya solo deja ver los mios y los de
 * partidos que ya han empezado. Si aqui apareciera un nombre de mas, el fallo
 * estaria en la politica, no en esta consulta.
 */
export async function getUsedPlayerNames(): Promise<string[]> {
  const ctx = await getDataContext()
  if (!ctx) return mockGetUsedPlayerNames()

  const [results, predictions] = await Promise.all([
    ctx.supabase
      .from('matches')
      .select('real_mvp, real_scorers, real_assists, kickoff_at, gameweeks!inner(league_id)')
      .eq('gameweeks.league_id', ctx.leagueId)
      .eq('status', 'played')
      .order('kickoff_at', { ascending: false })
      .limit(RESULT_SAMPLE),
    ctx.supabase
      .from('predictions')
      .select('mvp, scorers, assists, updated_at, members!inner(league_id)')
      .eq('members.league_id', ctx.leagueId)
      .order('updated_at', { ascending: false })
      .limit(PREDICTION_SAMPLE),
  ])

  if (results.error) throw results.error
  if (predictions.error) throw predictions.error

  const seen = new Set<string>()
  const out: string[] = []

  const add = (name: string | null | undefined) => {
    if (!name) return
    const key = normalizePlayer(name)
    if (key === '' || seen.has(key)) return
    seen.add(key)
    out.push(name)
  }

  // Las tres listas alimentan la misma bolsa de sugerencias: quien ya ha asistido
  // es candidato a marcar y al reves, y el selector es el mismo en los tres casos.
  for (const row of (results.data ?? []) as unknown as ResultRow[]) {
    add(row.real_mvp)
    ;(row.real_scorers ?? []).forEach(add)
    ;(row.real_assists ?? []).forEach(add)
  }
  for (const row of (predictions.data ?? []) as unknown as NameRow[]) {
    add(row.mvp)
    ;(row.scorers ?? []).forEach(add)
    ;(row.assists ?? []).forEach(add)
  }

  return out
}
