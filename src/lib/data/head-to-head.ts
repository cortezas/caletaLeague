/**
 * Cara a cara de la peña: mi balance, jornada a jornada, contra cada companero.
 *
 * NO LLAMA A NINGUNA API. Todo sale de `public.gameweek_points`, la misma vista
 * que ya pinta la clasificacion y el perfil. Aqui no se suma ni un punto: se
 * comparan totales que ya ha calculado SQL.
 *
 * QUE CUENTA COMO "JORNADA JUGADA"
 * Solo las jornadas con TODOS sus partidos en 'played', no las que llevan alguno.
 * Dos razones, y las dos importan en 2026/27:
 *  - la jornada 1 va del 15 al 27 de agosto por los aplazamientos del Mundial, o
 *    sea que estaria doce dias a medias; un "3-1-0" que se da la vuelta cada
 *    tarde no es un balance, es ruido.
 *  - el bonus de pleno de `gameweek_points` solo entra con la jornada entera
 *    jugada, asi que a mitad de jornada la comparacion ni siquiera es la buena.
 * Por eso NO se usa `getPlayedGameweekIds()`, que es "con al menos uno jugado" y
 * sirve para otras cosas (la tendencia de la clasificacion, la grafica del perfil).
 *
 * RLS
 * `gameweek_points` lleva `security_invoker = true`: cada uno ve lo de SU peña y
 * nada mas. Aqui, ademas, se filtra por `league_id` y se recorre `ctx.members`
 * (que ya viene recortado a mi liga), asi que una fila ajena que se colase por la
 * vista no llegaria a pintarse. No se toca ninguna politica.
 */

import type { HeadToHeadVM } from '../view-models'
import { getDataContext } from './league'
import type { DataContext } from './league'
import { mockGetGameweekStandings } from './mock'

type Row = HeadToHeadVM['rows'][number]

type GameweekPointsRow = { member_id: string; gameweek_id: string; total_points: number }
type MatchStatusRow = { gameweek_id: string; status: string }

/** Tope de jornadas que se recorren en modo mock (una liga son 38). */
const MOCK_GAMEWEEKS = 38

/**
 * Nunca lanza por falta de datos: sin jornadas terminadas devuelve `rows: []` y
 * la pantalla pinta su estado vacio. `NoMemberError` SI sale (viene de
 * `getDataContext`): quien no tiene ficha no debe ver una tabla en blanco, debe
 * acabar en /onboarding, y de eso se encarga `requireMember()`.
 */
export async function getHeadToHead(): Promise<HeadToHeadVM> {
  const ctx = await getDataContext()
  if (!ctx) return mockHeadToHead()

  try {
    return { rows: await tallyFromSupabase(ctx) }
  } catch (error) {
    // Un fallo de consulta no puede tumbar la pantalla de Clasificacion entera:
    // se degrada al estado vacio y queda el rastro en el log del servidor.
    console.error('[head-to-head] no se pudo calcular el cara a cara:', error)
    return { rows: [] }
  }
}

async function tallyFromSupabase(ctx: DataContext): Promise<Row[]> {
  const finishedIds = await finishedGameweekIds(ctx)
  if (finishedIds.length === 0) return []

  const { data, error } = await ctx.supabase
    .from('gameweek_points')
    .select('member_id, gameweek_id, total_points')
    .eq('league_id', ctx.leagueId)
    .in('gameweek_id', finishedIds)
  if (error) throw error

  const rows = (data ?? []) as unknown as GameweekPointsRow[]

  // member -> jornada -> puntos. `gameweek_points` emite una fila por miembro y
  // jornada aunque no haya pronosticado (total 0), asi que las dos partes de
  // cada comparacion existen siempre.
  const byMember = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const bucket = byMember.get(row.member_id) ?? new Map<string, number>()
    bucket.set(row.gameweek_id, row.total_points)
    byMember.set(row.member_id, bucket)
  }

  const mine = byMember.get(ctx.memberId) ?? new Map<string, number>()

  const result = ctx.members
    .filter((member) => member.memberId !== ctx.memberId)
    .map((member) => {
      const theirs = byMember.get(member.memberId) ?? new Map<string, number>()
      const tally = compare(finishedIds, mine, theirs)
      return {
        memberId: member.memberId,
        displayName: member.displayName,
        avatarColor: member.avatarColor,
        avatarUrl: member.avatarUrl,
        ...tally,
      }
    })

  return sortByPain(result)
}

/** Ids de las jornadas de MI liga con todos sus partidos jugados. */
async function finishedGameweekIds(ctx: DataContext): Promise<string[]> {
  const { data, error } = await ctx.supabase
    .from('matches')
    .select('gameweek_id, status, gameweeks!inner(league_id)')
    .eq('gameweeks.league_id', ctx.leagueId)
  if (error) throw error

  const total = new Map<string, number>()
  const played = new Map<string, number>()
  for (const row of (data ?? []) as unknown as MatchStatusRow[]) {
    total.set(row.gameweek_id, (total.get(row.gameweek_id) ?? 0) + 1)
    if (row.status === 'played') {
      played.set(row.gameweek_id, (played.get(row.gameweek_id) ?? 0) + 1)
    }
  }

  return [...total.entries()]
    .filter(([id, count]) => count > 0 && played.get(id) === count)
    .map(([id]) => id)
}

function compare(
  gameweekIds: string[],
  mine: Map<string, number>,
  theirs: Map<string, number>,
): Omit<Row, 'memberId' | 'displayName' | 'avatarColor' | 'avatarUrl'> {
  let wins = 0
  let draws = 0
  let losses = 0
  let pointsFor = 0
  let pointsAgainst = 0

  for (const id of gameweekIds) {
    const me = mine.get(id) ?? 0
    const other = theirs.get(id) ?? 0
    pointsFor += me
    pointsAgainst += other
    if (me > other) wins += 1
    else if (me === other) draws += 1
    else losses += 1
  }

  return { wins, draws, losses, pointsFor, pointsAgainst }
}

/**
 * Primero contra quien voy PEOR. La pantalla existe para dar pique, y lo que
 * pica es ver arriba del todo a quien te esta ganando: si el que te barre sale
 * el ultimo de una lista de once, no lo ve nadie.
 * Criterio: balance (ganadas menos perdidas) ascendente; a igualdad, diferencia
 * de puntos ascendente; y de ultimo desempate el nombre, para que el orden sea
 * estable entre recargas.
 */
function sortByPain(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => {
    const balance = a.wins - a.losses - (b.wins - b.losses)
    if (balance !== 0) return balance
    const diff = a.pointsFor - a.pointsAgainst - (b.pointsFor - b.pointsAgainst)
    if (diff !== 0) return diff
    return a.displayName.localeCompare(b.displayName, 'es')
  })
}

/**
 * Modo sin Supabase configurado. Se reconstruye desde `mockGetGameweekStandings`,
 * que ya reparte los puntos de cada jornada del prototipo; una jornada cuenta
 * cuando tiene desglose, que en el mock equivale a tener partidos jugados.
 */
async function mockHeadToHead(): Promise<HeadToHeadVM> {
  const numbers = Array.from({ length: MOCK_GAMEWEEKS }, (_, i) => i + 1)
  const gameweeks = (await Promise.all(numbers.map((n) => mockGetGameweekStandings(n))))
    .filter((gw) => gw !== null)
    .filter((gw) => gw.rows.some((row) => row.breakdown.length > 0))

  if (gameweeks.length === 0) return { rows: [] }

  const tally = new Map<string, Row>()

  for (const gameweek of gameweeks) {
    const me = gameweek.rows.find((row) => row.isMe)
    if (!me) continue

    for (const row of gameweek.rows) {
      if (row.isMe) continue
      const current = tally.get(row.memberId) ?? {
        memberId: row.memberId,
        displayName: row.displayName,
        avatarColor: row.avatarColor,
        avatarUrl: row.avatarUrl,
        wins: 0,
        draws: 0,
        losses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      }
      current.pointsFor += me.points
      current.pointsAgainst += row.points
      if (me.points > row.points) current.wins += 1
      else if (me.points === row.points) current.draws += 1
      else current.losses += 1
      tally.set(row.memberId, current)
    }
  }

  return { rows: sortByPain([...tally.values()]) }
}
