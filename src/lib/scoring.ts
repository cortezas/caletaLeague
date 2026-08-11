/**
 * Calculo de puntos.
 *
 * IMPORTANTE: en produccion la fuente de verdad es la funcion SQL equivalente
 * (supabase/migrations), alimentada por `leagues.scoring`. Este modulo existe para
 * el modo de desarrollo sin base de datos y para los tests; las dos implementaciones
 * tienen que dar siempre el mismo resultado.
 *
 * Reglas verificadas contra los datos del prototipo:
 *  - `exact` y `x2` son EXCLUYENTES: un marcador exacto suma 3, no 3 + 1.
 *  - cada goleador acertado suma, sin penalizacion por los fallados.
 *  - el bonus de pleno exige el 1X2 correcto en los 10 partidos de la jornada.
 *
 * Los nombres de jugador se comparan con `samePlayer` (src/lib/squads.ts) y no
 * con `===`: se escriben a mano, asi que "Vinicius" y "Vinícius" tienen que
 * puntuar igual. La funcion SQL hace la misma normalizacion.
 */

import { normalizePlayer, samePlayer } from './squads'
import type { MatchResult, PlayerName, Prediction, Scoring } from './types'

export type Sign = '1' | 'X' | '2'

export function sign(home: number, away: number): Sign {
  if (home > away) return '1'
  if (home < away) return '2'
  return 'X'
}

export interface MatchBreakdown {
  exact: boolean
  signHit: boolean
  mvpHit: boolean
  scorersHit: number
  assistsHit: number
  points: number
}

/**
 * Cuantos nombres de `picked` estan en `real`.
 *
 * Deduplica por nombre NORMALIZADO: si alguien escribe "Mbappe" y "Mbappé" en el
 * mismo pronostico es un jugador, no dos, y contarlo dos veces inflaria los puntos.
 * Las listas de goleadores y de asistentes se cuentan por separado: el mismo
 * jugador puede marcar Y asistir en un partido, y son dos aciertos legitimos.
 */
function countHits(picked: PlayerName[], real: PlayerName[]): number {
  const seen = new Set<string>()
  let hits = 0
  for (const name of picked) {
    const key = normalizePlayer(name)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    if (real.some((r) => samePlayer(name, r))) hits += 1
  }
  return hits
}

export function scoreMatch(
  prediction: Prediction,
  result: MatchResult,
  scoring: Scoring,
): MatchBreakdown {
  const exact = prediction.home === result.home && prediction.away === result.away
  const signHit = sign(prediction.home, prediction.away) === sign(result.home, result.away)
  const mvpHit = samePlayer(prediction.mvp, result.mvp)

  const scorersHit = countHits(prediction.scorers, result.scorers)
  const assistsHit = countHits(prediction.assists ?? [], result.assists ?? [])

  let points = 0
  if (exact) points += scoring.exact
  else if (signHit) points += scoring.x2
  if (mvpHit) points += scoring.mvp
  points += scorersHit * scoring.scorer
  points += assistsHit * scoring.assist

  return { exact, signHit, mvpHit, scorersHit, assistsHit, points }
}

export interface GameweekEntry {
  prediction: Prediction | null
  result: MatchResult | null
}

export interface GameweekBreakdown {
  perMatch: (MatchBreakdown | null)[]
  base: number
  plenoBonus: number
  total: number
}

/**
 * `entries` debe traer los 10 partidos de la jornada en orden. Un partido sin
 * pronostico o sin resultado suma 0 y descarta automaticamente el pleno.
 */
export function scoreGameweek(entries: GameweekEntry[], scoring: Scoring): GameweekBreakdown {
  const perMatch = entries.map(({ prediction, result }) =>
    prediction && result ? scoreMatch(prediction, result, scoring) : null,
  )

  const base = perMatch.reduce((sum, m) => sum + (m?.points ?? 0), 0)

  const allPlayed = perMatch.every((m) => m !== null)
  const allSigns = perMatch.every((m) => m?.signHit === true)
  const plenoBonus = allPlayed && allSigns ? scoring.pleno : 0

  return { perMatch, base, plenoBonus, total: base + plenoBonus }
}
