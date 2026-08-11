/**
 * Clasificacion general y clasificacion de una jornada.
 *
 * Los puntos y el puesto salen de las vistas SQL (`standings`, `gameweek_points`,
 * `prediction_points`), que llevan `security_invoker = true` (D14) y por tanto
 * respetan RLS: cada uno ve la clasificacion de SU peña y de ninguna otra.
 * Aqui no se vuelve a sumar nada.
 *
 * La unica cifra que no da ninguna vista es la TENDENCIA (puestos ganados o
 * perdidos respecto a la jornada anterior), porque es una comparacion entre dos
 * clasificaciones y no un total. Se calcula restando a cada uno lo que hizo en
 * la ultima jornada jugada, que sigue siendo dato de la vista: no se recalcula
 * ni un punto.
 */

import { scoreLabel } from '../format'
import type { GameweekStandingsVM, StandingsVM } from '../view-models'
import {
  effectiveStatus,
  fetchMatchRows,
  getDataContext,
  getLeagueGameweeks,
  getPlayedGameweekIds,
  matchLabel,
  resultOf,
} from './league'
import type { DataContext } from './league'
import { mockGetGameweekStandings, mockGetSeasonStandings } from './mock'

type StandingsRow = {
  member_id: string
  display_name: string
  avatar_color: string
  total_points: number
  position: number
}

type GameweekPointsRow = {
  member_id: string
  gameweek_id: string
  gameweek_number: number
  total_points: number
}

/**
 * Puesto con empates a la manera clasica (1, 2, 2, 4), igual que el `rank()` de
 * la vista `standings`. Sin esto, dos empatados a puntos saldrian con puestos
 * distintos segun la vista que los pinte.
 */
function rankBy(points: number[]): number[] {
  const sorted = [...points].sort((a, b) => b - a)
  return points.map((value) => sorted.indexOf(value) + 1)
}

export async function getSeasonStandings(): Promise<StandingsVM> {
  const ctx = await getDataContext()
  if (!ctx) return mockGetSeasonStandings()

  const { data, error } = await ctx.supabase
    .from('standings')
    .select('member_id, display_name, avatar_color, total_points, position')
    .eq('league_id', ctx.leagueId)
    .order('position', { ascending: true })
    .order('display_name', { ascending: true })
  if (error) throw error

  const rows = (data ?? []) as unknown as StandingsRow[]
  const trend = await trendByMember(ctx, rows)

  return {
    leagueName: ctx.leagueName,
    rows: rows.map((row) => ({
      position: row.position,
      memberId: row.member_id,
      displayName: row.display_name,
      avatarColor: row.avatar_color,
      points: row.total_points,
      trend: trend.get(row.member_id) ?? 0,
      isMe: row.member_id === ctx.memberId,
    })),
  }
}

/**
 * Puestos ganados o perdidos en la ultima jornada jugada.
 *
 * En vez de recalcular la clasificacion historica se resta a cada total lo que
 * esa persona hizo en la ultima jornada: eso da la tabla de ANTES de jugarla, y
 * la diferencia de puestos es la tendencia. Son 12 filas de consulta, no 456.
 *
 * Todo a cero mientras no se haya jugado ninguna jornada, que es lo honesto: sin
 * jornada anterior nadie ha subido ni bajado.
 */
async function trendByMember(
  ctx: DataContext,
  rows: StandingsRow[],
): Promise<Map<string, number>> {
  const empty = new Map<string, number>()
  if (rows.length === 0) return empty

  const [gameweeks, playedIds] = await Promise.all([getLeagueGameweeks(), getPlayedGameweekIds()])
  const played = gameweeks.filter((gw) => playedIds.has(gw.id))
  const last = played[played.length - 1]
  if (!last) return empty

  const { data, error } = await ctx.supabase
    .from('gameweek_points')
    .select('member_id, gameweek_id, gameweek_number, total_points')
    .eq('gameweek_id', last.id)
  if (error) throw error

  const lastPoints = new Map(
    ((data ?? []) as unknown as GameweekPointsRow[]).map((row) => [row.member_id, row.total_points]),
  )

  const before = rows.map((row) => row.total_points - (lastPoints.get(row.member_id) ?? 0))
  const beforePositions = rankBy(before)

  return new Map(rows.map((row, index) => [row.member_id, beforePositions[index] - row.position]))
}

/** `null` si esa jornada no existe en la liga del usuario. */
export async function getGameweekStandings(n: number): Promise<GameweekStandingsVM | null> {
  const ctx = await getDataContext()
  if (!ctx) return mockGetGameweekStandings(n)

  const gameweeks = await getLeagueGameweeks()
  const index = gameweeks.findIndex((gw) => gw.number === n)
  if (index === -1) return null
  const gameweek = gameweeks[index]

  const matches = await fetchMatchRows(ctx, gameweek.id)
  const playedMatches = matches.filter((row) => resultOf(row, ctx.now) !== null)
  const playedIds = playedMatches.map((row) => row.id)

  const [totals, predictions, points] = await Promise.all([
    ctx.supabase
      .from('gameweek_points')
      .select('member_id, gameweek_id, gameweek_number, total_points')
      .eq('gameweek_id', gameweek.id),
    // Solo de partidos JUGADOS: son los unicos que entran en el desglose y, no
    // por casualidad, los unicos cuyos pronosticos ajenos deja ver RLS.
    playedIds.length > 0
      ? ctx.supabase
          .from('predictions')
          .select('match_id, member_id, home, away')
          .in('match_id', playedIds)
      : null,
    playedIds.length > 0
      ? ctx.supabase
          .from('prediction_points')
          .select('match_id, member_id, points')
          .in('match_id', playedIds)
      : null,
  ])

  if (totals.error) throw totals.error
  if (predictions?.error) throw predictions.error
  if (points?.error) throw points.error

  const totalByMember = new Map(
    ((totals.data ?? []) as unknown as GameweekPointsRow[]).map((row) => [
      row.member_id,
      row.total_points,
    ]),
  )

  const key = (matchId: string, memberId: string) => `${matchId}:${memberId}`

  const scoreByKey = new Map(
    ((predictions?.data ?? []) as unknown as Array<{
      match_id: string
      member_id: string
      home: number
      away: number
    }>).map((row) => [key(row.match_id, row.member_id), scoreLabel(row.home, row.away)]),
  )

  const pointsByKey = new Map(
    ((points?.data ?? []) as unknown as Array<{
      match_id: string
      member_id: string
      points: number
    }>).map((row) => [key(row.match_id, row.member_id), row.points]),
  )

  const pendingCount = matches.length - playedMatches.length

  const ordered = [...ctx.members].sort(
    (a, b) => (totalByMember.get(b.memberId) ?? 0) - (totalByMember.get(a.memberId) ?? 0),
  )
  const positions = rankBy(ordered.map((member) => totalByMember.get(member.memberId) ?? 0))

  const rows = ordered.map((member, i) => ({
    position: positions[i],
    memberId: member.memberId,
    displayName: member.displayName,
    avatarColor: member.avatarColor,
    points: totalByMember.get(member.memberId) ?? 0,
    isMe: member.memberId === ctx.memberId,
    breakdown: playedMatches.map((row) => {
      const result = resultOf(row, ctx.now)
      return {
        matchId: row.id,
        label: matchLabel(row),
        // '· ·' cuando esa persona no pronostico ese partido. No es un 0-0.
        myScore: scoreByKey.get(key(row.id, member.memberId)) ?? scoreLabel(null, null),
        realScore: scoreLabel(result?.home, result?.away),
        points: pointsByKey.get(key(row.id, member.memberId)) ?? 0,
      }
    }),
    pendingCount,
  }))

  const inPlay = matches.some((row) => {
    const status = effectiveStatus(row, ctx.now)
    return status === 'live' || status === 'locked'
  })
  const prefix =
    matches.length > 0 && playedMatches.length === matches.length
      ? 'Finalizada'
      : playedMatches.length > 0 || inPlay
        ? 'En juego'
        : 'Por jugar'

  return {
    number: n,
    hasPrev: index > 0,
    hasNext: index < gameweeks.length - 1,
    statusLabel: `${prefix} · ${playedMatches.length} de ${matches.length} partidos`,
    rows,
  }
}
