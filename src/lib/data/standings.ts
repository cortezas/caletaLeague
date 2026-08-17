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

import { duesForGameweek } from '../dues'
import { scoreLabel } from '../format'
import type { GameweekStandingsVM, SeasonDuesVM, StandingsVM } from '../view-models'
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
  avatar_url: string | null
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
    .select('member_id, display_name, avatar_color, avatar_url, total_points, position')
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
      avatarUrl: row.avatar_url,
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
          // `sign_hit` entra por el desempate de los pagos: con puntuaciones
          // bajas el empate abajo es el caso normal, no la excepcion.
          .select('match_id, member_id, points, sign_hit')
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

  /**
   * Los pagos SOLO con la jornada entera jugada. Señalar al ultimo a media
   * jornada genera piques por nada, y el orden de abajo se mueve con cada
   * partido que entra.
   */
  const complete = matches.length > 0 && pendingCount === 0

  const predictionsMade = new Map<string, number>()
  for (const row of (predictions?.data ?? []) as unknown as Array<{ member_id: string }>) {
    predictionsMade.set(row.member_id, (predictionsMade.get(row.member_id) ?? 0) + 1)
  }

  const signHits = new Map<string, number>()
  for (const row of (points?.data ?? []) as unknown as Array<{
    member_id: string
    sign_hit: boolean | null
  }>) {
    if (row.sign_hit === true) signHits.set(row.member_id, (signHits.get(row.member_id) ?? 0) + 1)
  }

  const dues = complete
    ? duesForGameweek(
        ctx.members.map((member) => ({
          memberId: member.memberId,
          points: totalByMember.get(member.memberId) ?? 0,
          predictionsMade: predictionsMade.get(member.memberId) ?? 0,
          signHits: signHits.get(member.memberId) ?? 0,
        })),
      )
    : new Map<string, number>()

  const ordered = [...ctx.members].sort(
    (a, b) => (totalByMember.get(b.memberId) ?? 0) - (totalByMember.get(a.memberId) ?? 0),
  )
  const positions = rankBy(ordered.map((member) => totalByMember.get(member.memberId) ?? 0))

  const rows = ordered.map((member, i) => ({
    position: positions[i],
    memberId: member.memberId,
    displayName: member.displayName,
    avatarColor: member.avatarColor,
        avatarUrl: member.avatarUrl,
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
    // `null` = no paga (o la jornada no ha acabado). Nunca 0: un 0 se leeria
    // como "paga cero euros", que no es lo mismo que "no le toca pagar".
    euros: dues.get(member.memberId) ?? null,
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

/**
 * Lo que lleva pagado cada uno en la temporada.
 *
 * Se agrega en SQL (`public.season_dues`, migracion 0023) y no aqui: sumarlo en
 * memoria obligaria a traerse todos los pronosticos de la temporada, y PostgREST
 * corta a 1000 filas. Con 15 personas y 380 partidos son ~5.700, asi que el
 * acumulado saldria corto Y EN SILENCIO. Con dinero en medio eso no vale.
 *
 * Solo cuenta jornadas ACABADAS. Todo a cero es el estado normal hasta que se
 * juegue la primera entera, y la pantalla lo dice asi en vez de sonar a error.
 */
export async function getSeasonDues(): Promise<SeasonDuesVM> {
  const ctx = await getDataContext()
  if (!ctx) return { rows: [], total: 0 }

  const { data, error } = await ctx.supabase.rpc('season_dues')
  // Un fallo aqui no puede tumbar la clasificacion: se devuelve vacio y la
  // seccion no se pinta. Los puntos, que es lo importante, siguen saliendo.
  if (error) return { rows: [], total: 0 }

  const euros = new Map(
    ((data ?? []) as unknown as Array<{ member_id: string; euros: number }>).map((row) => [
      row.member_id,
      row.euros,
    ]),
  )

  const rows = ctx.members
    .map((member) => ({
      memberId: member.memberId,
      displayName: member.displayName,
      avatarColor: member.avatarColor,
      avatarUrl: member.avatarUrl,
      euros: euros.get(member.memberId) ?? 0,
      isMe: member.memberId === ctx.memberId,
    }))
    // De mas a menos deuda: la lista existe para ver quien va pagando.
    .sort((a, b) => b.euros - a.euros || a.displayName.localeCompare(b.displayName, 'es'))

  return { rows, total: rows.reduce((sum, row) => sum + row.euros, 0) }
}
