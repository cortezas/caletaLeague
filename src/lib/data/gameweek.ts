/**
 * Jornada activa, resumen, editor de pronostico y pique.
 *
 * DE DONDE SALEN LOS PUNTOS
 * De la vista `prediction_points`, nunca de `src/lib/scoring.ts`. La puntuacion
 * la fija el organizador en `leagues.scoring` y si cambia hay que recalcular la
 * temporada entera de forma consistente: eso solo puede pasar en un sitio, y ese
 * sitio es SQL. `scoring.ts` sigue siendo el espejo para el modo sin backend.
 *
 * LA REGLA DEL SECRETO LA IMPONE RLS
 * `getMatchPique` no filtra pronosticos ajenos a mano. Consulta normal y la
 * politica `predictions_select` decide: los mios siempre, los de los demas solo
 * pasado el pitido inicial. Si alguna vez devolviera de mas, lo que hay que
 * arreglar es la politica, no poner un filtro encima que la tape.
 */

import { formatKickoff, scoreLabel } from '../format'
import { COMPETITION_LABEL } from '../laliga'
import { normalizePlayer, samePlayer } from '../squads'
import type { Prediction } from '../types'
import type { GameweekVM, MatchRowVM, PiqueVM, PredictEditorVM, SummaryVM } from '../view-models'
import {
  effectiveStatus,
  fetchMatchRow,
  fetchMatchRows,
  getDataContext,
  isoUtc,
  resolveActiveGameweek,
  resultOf,
  teamVM,
} from './league'
import type { DataContext, MatchRow } from './league'
import {
  mockGetActiveGameweek,
  mockGetGameweekSummary,
  mockGetMatchEditor,
  mockGetMatchPique,
} from './mock'
import { getSquadsForMatch, getUsedPlayerNames } from './squads'

/* ------------------------------------------------------------------ *
 * 1. Pronosticos y puntos, tal cual salen de la base
 * ------------------------------------------------------------------ */

type PredictionRow = {
  match_id: string
  member_id: string
  home: number
  away: number
  mvp: string | null
  scorers: string[] | null
  assists: string[] | null
  no_goals: boolean
}

type PointsRow = {
  match_id: string
  member_id: string
  points: number
  exact_hit: boolean | null
  sign_hit: boolean | null
  mvp_hit: boolean | null
}

function predictionOf(row: PredictionRow): Prediction {
  return {
    home: row.home,
    away: row.away,
    mvp: row.mvp,
    scorers: row.scorers ?? [],
    assists: row.assists ?? [],
    // D19(a): `noGoals` es flag explicito, jamas se deduce de scorers.length === 0.
    noGoals: row.no_goals,
  }
}

async function fetchPredictions(
  ctx: DataContext,
  matchIds: string[],
  memberId?: string,
): Promise<PredictionRow[]> {
  if (matchIds.length === 0) return []

  let query = ctx.supabase
    .from('predictions')
    // `assists` incluida a proposito: sin ella el VM llega con `undefined` y
    // cualquier `.map()` sobre las asistencias revienta al renderizar.
    .select('match_id, member_id, home, away, mvp, scorers, assists, no_goals')
    .in('match_id', matchIds)
  if (memberId) query = query.eq('member_id', memberId)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as unknown as PredictionRow[]
}

async function fetchPoints(
  ctx: DataContext,
  matchIds: string[],
  memberId?: string,
): Promise<PointsRow[]> {
  if (matchIds.length === 0) return []

  let query = ctx.supabase
    .from('prediction_points')
    .select('match_id, member_id, points, exact_hit, sign_hit, mvp_hit')
    .in('match_id', matchIds)
  if (memberId) query = query.eq('member_id', memberId)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as unknown as PointsRow[]
}

/* ------------------------------------------------------------------ *
 * 2. Fila de partido
 * ------------------------------------------------------------------ */

function matchRowVM(
  row: MatchRow,
  prediction: Prediction | null,
  points: PointsRow | undefined,
  now: number,
): MatchRowVM {
  const status = effectiveStatus(row, now)
  const result = resultOf(row, now)
  const scored = result !== null && points !== undefined

  return {
    id: row.id,
    home: teamVM(row.home_code),
    away: teamVM(row.away_code),
    kickoffAt: isoUtc(row.kickoff_at),
    kickoffLabel: formatKickoff(row.kickoff_at),
    kickoffProvisional: row.kickoff_provisional,
    status,
    myPrediction: prediction,
    result,
    myPoints: scored ? points.points : null,
    exactHit: scored ? points.exact_hit === true : false,
  }
}

/** Las filas de la jornada activa con MI pronostico y MIS puntos. */
async function myGameweekRows(
  ctx: DataContext,
  gameweekId: string,
): Promise<{ rows: MatchRowVM[]; matches: MatchRow[] }> {
  const matches = await fetchMatchRows(ctx, gameweekId)
  const ids = matches.map((m) => m.id)

  const [predictions, points] = await Promise.all([
    fetchPredictions(ctx, ids, ctx.memberId),
    fetchPoints(ctx, ids, ctx.memberId),
  ])

  const byMatch = new Map(predictions.map((p) => [p.match_id, predictionOf(p)]))
  const pointsByMatch = new Map(points.map((p) => [p.match_id, p]))

  return {
    matches,
    rows: matches.map((row) =>
      matchRowVM(row, byMatch.get(row.id) ?? null, pointsByMatch.get(row.id), ctx.now),
    ),
  }
}

/* ------------------------------------------------------------------ *
 * 3. Las cuatro funciones publicas
 * ------------------------------------------------------------------ */

export async function getActiveGameweek(): Promise<GameweekVM> {
  const ctx = await getDataContext()
  if (!ctx) return mockGetActiveGameweek()

  const active = await resolveActiveGameweek()
  // Una peña recien creada, sin calendario sembrado. No es un error: no hay
  // jornada que enseñar y la pantalla pinta su estado vacio.
  if (!active) {
    return {
      number: 0,
      competitionLabel: COMPETITION_LABEL,
      deadlineAt: null,
      deadlineLabel: null,
      matches: [],
      predictedCount: 0,
      totalCount: 0,
    }
  }

  const { rows } = await myGameweekRows(ctx, active.id)
  const firstOpen = rows.find((row) => row.status === 'open') ?? null

  return {
    number: active.number,
    competitionLabel: COMPETITION_LABEL,
    deadlineAt: firstOpen ? firstOpen.kickoffAt : null,
    // Guion largo SIN espacios: es como lo pinta el eyebrow del prototipo.
    deadlineLabel: firstOpen ? `Cierra ${firstOpen.home.name}–${firstOpen.away.name}` : null,
    matches: rows,
    predictedCount: rows.filter((row) => row.myPrediction !== null).length,
    totalCount: rows.length, // D19(b): nunca el literal 10
  }
}

export async function getGameweekSummary(): Promise<SummaryVM> {
  const ctx = await getDataContext()
  if (!ctx) return mockGetGameweekSummary()

  const active = await resolveActiveGameweek()
  if (!active) {
    return {
      gameweekNumber: 0,
      rows: [],
      predictedCount: 0,
      missingCount: 0,
      firstMissingMatchId: null,
    }
  }

  const { rows } = await myGameweekRows(ctx, active.id)

  const predictedCount = rows.filter((row) => row.myPrediction !== null).length
  const firstMissing = rows.find((row) => row.status === 'open' && row.myPrediction === null) ?? null

  return {
    gameweekNumber: active.number,
    rows: rows.map((row, index) => ({
      index: index + 1,
      matchId: row.id,
      label: `${row.home.name} – ${row.away.name}`,
      myScore: row.myPrediction ? scoreLabel(row.myPrediction.home, row.myPrediction.away) : null,
      status: row.status,
      points: row.myPoints,
    })),
    predictedCount,
    missingCount: rows.length - predictedCount,
    firstMissingMatchId: firstMissing ? firstMissing.id : null,
  }
}

/** `null` si el partido no existe o no es visible para este usuario. */
export async function getMatchEditor(matchId: string): Promise<PredictEditorVM | null> {
  const ctx = await getDataContext()
  if (!ctx) return mockGetMatchEditor(matchId)

  const row = await fetchMatchRow(ctx, matchId)
  if (!row) return null

  const [predictions, points, squads, suggestions] = await Promise.all([
    fetchPredictions(ctx, [row.id], ctx.memberId),
    fetchPoints(ctx, [row.id], ctx.memberId),
    getSquadsForMatch(row.home_code, row.away_code),
    getUsedPlayerNames(),
  ])

  const mine = predictions.length > 0 ? predictionOf(predictions[0]) : null
  const match = matchRowVM(row, mine, points[0], ctx.now)

  return {
    match,
    editable: match.status === 'open',
    squads: squads.map((squad) => ({ ...teamVM(squad.code), players: squad.players })),
    suggestions,
    initialDraft: {
      home: mine?.home ?? 0,
      away: mine?.away ?? 0,
      mvp: mine?.mvp ?? null,
      scorers: mine?.scorers ?? [],
      assists: mine?.assists ?? [],
      noGoals: mine?.noGoals ?? false,
    },
    scoring: ctx.scoring,
  }
}

/** `null` si el partido no existe, no es visible, o aun no esta jugado (no se revela). */
export async function getMatchPique(matchId: string): Promise<PiqueVM | null> {
  const ctx = await getDataContext()
  if (!ctx) return mockGetMatchPique(matchId)

  const row = await fetchMatchRow(ctx, matchId)
  if (!row) return null

  const result = resultOf(row, ctx.now)
  if (!result) return null

  const [predictions, points] = await Promise.all([
    fetchPredictions(ctx, [row.id]),
    fetchPoints(ctx, [row.id]),
  ])

  const pointsByMember = new Map(points.map((p) => [p.member_id, p]))
  const memberById = new Map(ctx.members.map((m) => [m.memberId, m]))

  // Goleadores reales distintos, normalizados: "Vinicius" y "Vinícius" escritos
  // por dos personas distintas son el mismo gol.
  const realScorers = new Set(result.scorers.map(normalizePlayer).filter((n) => n !== ''))
  // Las asistencias reales van por su cuenta: un partido puede tener goleadores
  // metidos y las asistencias todavia en blanco, y al reves.
  const realAssists = new Set(result.assists.map(normalizePlayer).filter((n) => n !== ''))
  const goalless = result.home + result.away === 0
  const hasScorerData = realScorers.size > 0 || goalless

  const entries = predictions
    .map((raw) => {
      const member = memberById.get(raw.member_id)
      if (!member) return null

      const prediction = predictionOf(raw)
      const score = pointsByMember.get(raw.member_id)
      const mvpHit = score?.mvp_hit === true

      const chips: PiqueVM['rows'][number]['chips'] = [
        { kind: 'mvp', label: `MVP: ${prediction.mvp ?? '—'}`, hit: mvpHit },
      ]
      if (prediction.noGoals) chips.push({ kind: 'noGoals', label: 'Sin goles', hit: goalless })
      for (const scorer of prediction.scorers) {
        chips.push({
          kind: 'scorer',
          label: scorer,
          hit: result.scorers.some((real) => samePlayer(real, scorer)),
        })
      }
      // Detras de los goles y con `kind` propio: el mismo nombre puede estar en
      // las dos listas y hay que poder distinguir de que acierto se habla.
      for (const assist of prediction.assists) {
        chips.push({
          kind: 'assist',
          label: assist,
          hit: result.assists.some((real) => samePlayer(real, assist)),
        })
      }

      return {
        prediction,
        mvpHit,
        row: {
          memberId: member.memberId,
          displayName: member.displayName,
          avatarColor: member.avatarColor,
          isMe: member.memberId === ctx.memberId,
          home: prediction.home,
          away: prediction.away,
          mvp: prediction.mvp,
          scorers: prediction.scorers,
          assists: prediction.assists,
          points: score?.points ?? 0,
          exact: score?.exact_hit === true,
          signHit: score?.sign_hit === true,
          chips,
        },
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => b.row.points - a.row.points)

  const rows = entries.map((entry) => entry.row)

  // Destacados contados sobre los pronosticos reales, nunca cableados.
  const exactCount = rows.filter((r) => r.exact).length
  const mvpCount = entries.filter((e) => e.mvpHit).length
  const scorersCount = goalless
    ? entries.filter((e) => e.prediction.noGoals).length
    : entries.filter((e) =>
        result.scorers.every((real) => e.prediction.scorers.some((s) => samePlayer(s, real))),
      ).length
  // Mismo criterio que los goleadores, para que las dos cifras se lean igual:
  // quien tenia TODOS los asistentes reales en su lista.
  const assistsCount = entries.filter((e) =>
    result.assists.every((real) => e.prediction.assists.some((a) => samePlayer(a, real))),
  ).length
  const anyoneGuessedAssists = entries.some((e) => e.prediction.assists.length > 0)

  const realScore = scoreLabel(result.home, result.away, '–')
  const assistLabel =
    realAssists.size === 1 ? 'la asistencia' : `las ${realAssists.size} asistencias`

  const highlights: PiqueVM['highlights'] = [
    {
      value: String(exactCount),
      tone: 'ok',
      text:
        exactCount > 0
          ? `clavaron el ${realScore} exacto. Se reparten ${ctx.scoring.exact} puntos cada uno.`
          : `nadie clavó el ${realScore} exacto. La peña, en blanco.`,
    },
    // El MVP lo designa el organizador: mientras no lo haga no hay a quien contar.
    result.mvp
      ? {
          value: String(mvpCount),
          tone: 'accent',
          text:
            mvpCount > 0
              ? `vieron el MVP de ${result.mvp}. El resto, a mirar.`
              : `nadie vio el MVP de ${result.mvp}. Ni uno.`,
        }
      : {
          value: '—',
          tone: 'accent',
          text: 'el MVP lo pone el organizador y este partido aún no lo tiene.',
        },
    hasScorerData
      ? {
          value: String(scorersCount),
          tone: 'neutral',
          text: goalless
            ? scorersCount > 0
              ? 'acertaron que no habría goles.'
              : 'nadie acertó que no habría goles.'
            : scorersCount > 0
              ? `acertaron los ${realScorers.size} goleadores enteros.`
              : `nadie acertó los ${realScorers.size} goleadores. Ni de casualidad.`,
        }
      : {
          value: '—',
          tone: 'neutral',
          text: 'los goleadores los mete el organizador y aún no están.',
        },
  ]

  // El cuarto destacado solo sale si hay algo que contar: con asistencias reales,
  // o con alguien que las pronosticó y sigue esperando el dato. Un '—' permanente
  // en los 380 partidos seria ruido, no informacion.
  if (realAssists.size > 0) {
    highlights.push({
      value: String(assistsCount),
      tone: 'neutral',
      text:
        assistsCount > 0
          ? `acertaron ${assistLabel} del partido.`
          : `nadie acertó ${assistLabel}. Ahí no llegó ninguno.`,
    })
  } else if (anyoneGuessedAssists) {
    highlights.push({
      value: '—',
      tone: 'neutral',
      text: 'las asistencias las mete el organizador y aún no están.',
    })
  }

  const mine = predictions.find((p) => p.member_id === ctx.memberId) ?? null

  return {
    match: matchRowVM(
      row,
      mine ? predictionOf(mine) : null,
      pointsByMember.get(ctx.memberId),
      ctx.now,
    ),
    highlights,
    rows,
    // Cuantos PUSIERON algo, no cuantos son en la peña. La fila del VM exige un
    // marcador (`home`/`away` son numeros obligatorios) y quien no pronostico no
    // tiene ninguno: inventarle un 0-0 seria meterle en la boca algo que no dijo.
    memberCount: rows.length,
  }
}
