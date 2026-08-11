/**
 * Perfil del usuario: puesto, estadisticas de temporada, grafica y racha.
 *
 * Todas las cifras salen de las vistas SQL. Las tres que el prototipo tenia
 * cableadas (11 exactos, 62% de 1X2, racha de 3) pasan a calcularse:
 *  - los exactos y el 1X2, contando los flags `exact_hit` / `sign_hit` de
 *    `prediction_points`, que ya vienen decididos por SQL;
 *  - la racha, comparando mi total de cada jornada con la media de la peña en
 *    esa misma jornada, ambos de `gameweek_points`.
 *
 * Con la liga recien empezada casi todo vale 0 y la grafica sale vacia. Es lo
 * correcto: preferible un perfil en blanco que un historico inventado.
 */

import type { ProfileVM } from '../view-models'
import { getDataContext, getLeagueGameweeks, getPlayedGameweekIds } from './league'
import type { DataContext, GameweekRow } from './league'
import { mockGetProfile } from './mock'

/** Jornadas que pinta la grafica de barras del handoff (pantalla 9). */
const CHART_LENGTH = 10

/** Hasta donde se mira hacia atras para la racha. Mas seria ruido. */
const STREAK_WINDOW = 12

/** Una "racha" de una sola jornada no es una racha. */
const MIN_STREAK = 2

type StandingsRow = { member_id: string; total_points: number; position: number }
type GameweekPointsRow = { member_id: string; gameweek_id: string; total_points: number }
type PredictionPointsRow = { match_id: string; exact_hit: boolean | null; sign_hit: boolean | null }

export async function getProfile(): Promise<ProfileVM> {
  const ctx = await getDataContext()
  if (!ctx) return mockGetProfile()

  const [gameweeks, playedGameweekIds] = await Promise.all([
    getLeagueGameweeks(),
    getPlayedGameweekIds(),
  ])
  const playedGameweeks = gameweeks.filter((gw) => playedGameweekIds.has(gw.id))

  const [standings, myGameweeks, accuracy, streak] = await Promise.all([
    myStandingsRow(ctx),
    myGameweekPoints(ctx),
    seasonAccuracy(ctx),
    streakOf(ctx, playedGameweeks),
  ])

  const pointsByGameweek = new Map(myGameweeks.map((row) => [row.gameweek_id, row.total_points]))

  // D19(c): el maximo es dinamico, no el literal 23. Empate a puntos -> la
  // jornada mas antigua, que es la que llego antes a esa marca.
  let best: { number: number; points: number } = { number: 0, points: 0 }
  for (const gw of gameweeks) {
    const points = pointsByGameweek.get(gw.id) ?? 0
    if (points > best.points || best.number === 0) best = { number: gw.number, points }
  }

  const chart = playedGameweeks
    .slice(-CHART_LENGTH)
    .map((gw) => ({ gameweek: gw.number, points: pointsByGameweek.get(gw.id) ?? 0 }))

  return {
    displayName: ctx.displayName,
    avatarColor: ctx.avatarColor,
    position: standings?.position ?? ctx.members.length,
    memberCount: ctx.members.length,
    leagueName: ctx.leagueName,
    totalPoints: standings?.total_points ?? 0,
    stats: {
      totalPoints: standings?.total_points ?? 0,
      exactHits: accuracy.exactHits,
      signAccuracy: accuracy.signAccuracy, // porcentaje entero
      bestGameweekPoints: best.points,
      bestGameweekNumber: best.number,
    },
    chart,
    streak,
  }
}

async function myStandingsRow(ctx: DataContext): Promise<StandingsRow | null> {
  const { data, error } = await ctx.supabase
    .from('standings')
    .select('member_id, total_points, position')
    .eq('league_id', ctx.leagueId)
    .eq('member_id', ctx.memberId)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as unknown as StandingsRow | null
}

async function myGameweekPoints(ctx: DataContext): Promise<GameweekPointsRow[]> {
  const { data, error } = await ctx.supabase
    .from('gameweek_points')
    .select('member_id, gameweek_id, total_points')
    .eq('league_id', ctx.leagueId)
    .eq('member_id', ctx.memberId)
  if (error) throw error
  return (data ?? []) as unknown as GameweekPointsRow[]
}

/**
 * Exactos y porcentaje de 1X2 de toda la temporada.
 *
 * El denominador son MIS pronosticos sobre partidos ya jugados, no todos: un
 * partido sin resultado no es un 1X2 fallado, es un 1X2 que aun no se ha
 * resuelto. Por eso hace falta el conjunto de partidos jugados: en
 * `prediction_points` un fallo y un partido pendiente tienen los dos `sign_hit`
 * a false y desde ahi no se distinguen.
 */
async function seasonAccuracy(
  ctx: DataContext,
): Promise<{ exactHits: number; signAccuracy: number }> {
  const [played, mine] = await Promise.all([
    ctx.supabase
      .from('matches')
      .select('id, gameweeks!inner(league_id)')
      .eq('gameweeks.league_id', ctx.leagueId)
      .eq('status', 'played'),
    ctx.supabase
      .from('prediction_points')
      .select('match_id, exact_hit, sign_hit')
      .eq('league_id', ctx.leagueId)
      .eq('member_id', ctx.memberId),
  ])

  if (played.error) throw played.error
  if (mine.error) throw mine.error

  const playedIds = new Set(
    ((played.data ?? []) as unknown as Array<{ id: string }>).map((row) => row.id),
  )
  const rows = ((mine.data ?? []) as unknown as PredictionPointsRow[]).filter((row) =>
    playedIds.has(row.match_id),
  )

  const exactHits = rows.filter((row) => row.exact_hit === true).length
  const signHits = rows.filter((row) => row.sign_hit === true).length

  return {
    exactHits,
    signAccuracy: rows.length > 0 ? Math.round((signHits / rows.length) * 100) : 0,
  }
}

/**
 * Jornadas seguidas (de la ultima hacia atras) puntuando por encima de la media
 * de la peña. La media incluye al propio usuario, que es lo que significa "la
 * media de la peña"; con un solo miembro nunca hay racha, y es correcto.
 */
async function streakOf(
  ctx: DataContext,
  playedGameweeks: GameweekRow[],
): Promise<ProfileVM['streak']> {
  const window = playedGameweeks.slice(-STREAK_WINDOW)
  if (window.length === 0) return null

  const { data, error } = await ctx.supabase
    .from('gameweek_points')
    .select('member_id, gameweek_id, total_points')
    .eq('league_id', ctx.leagueId)
    .in(
      'gameweek_id',
      window.map((gw) => gw.id),
    )
  if (error) throw error

  const rows = (data ?? []) as unknown as GameweekPointsRow[]

  const byGameweek = new Map<string, number[]>()
  const mineByGameweek = new Map<string, number>()
  for (const row of rows) {
    const bucket = byGameweek.get(row.gameweek_id) ?? []
    bucket.push(row.total_points)
    byGameweek.set(row.gameweek_id, bucket)
    if (row.member_id === ctx.memberId) mineByGameweek.set(row.gameweek_id, row.total_points)
  }

  let count = 0
  for (let i = window.length - 1; i >= 0; i--) {
    const all = byGameweek.get(window[i].id) ?? []
    const mine = mineByGameweek.get(window[i].id)
    if (all.length === 0 || mine === undefined) break
    const average = all.reduce((sum, value) => sum + value, 0) / all.length
    if (mine <= average) break
    count += 1
  }

  if (count < MIN_STREAK) return null

  return {
    count,
    title: `Racha de ${count} jornadas`,
    text: `Llevas ${count} jornadas seguidas puntuando por encima de la media de la peña.`,
  }
}
