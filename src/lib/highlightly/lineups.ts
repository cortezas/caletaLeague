/**
 * Alineaciones: el once, el banquillo y quien ha apostado por alguien que NO esta.
 *
 * PARA QUE SIRVE
 * Media hora antes del pitido inicial se sabe quien juega. Si Curro tiene a
 * Mbappé de goleador y Mbappé no esta ni en el banquillo, avisarle a tiempo vale
 * mas que cualquier otra funcion de esta app.
 *
 * ESTE FICHERO NO MANDA NADA. Devuelve la lista de "apuestas a jugador no
 * convocado" y ahi se acaba su trabajo. El envio vive en `src/lib/push/`, que es
 * de otro lote. Como engancharlo esta en docs/EVENTOS.md, seccion 6.
 *
 * LO QUE NO SABEMOS (y hay que decirlo)
 * **No esta verificado que `GET /lineups/{matchId}` devuelva algo ANTES del
 * partido.** Puede que la API solo publique la alineacion cuando el partido ya
 * ha empezado, y entonces el aviso llegaria tarde y esta funcion no serviria
 * para lo que se penso. Solo se puede comprobar el sabado 15 a las 18:30, una
 * hora antes del Alavés-Getafe. Hasta entonces, todo lo de aqui esta escrito
 * pero NO enchufado a ningun cron, a proposito.
 *
 * COSTE: 1 peticion por partido. Una jornada entera son 10 peticiones de las
 * 100 del dia, y hay que pedirlas cerca del pitido inicial, no antes.
 *
 * SOLO SERVIDOR.
 */

import { normalizePlayer } from '@/lib/squads'
import type { TeamCode } from '@/lib/types'
import { getMatchLineups, type HlFetchOptions } from './client'
import { resolveHighlightlyTeam } from './match-link'
import type { HlLineupPlayer, HlLineupSide } from './types'

// ---------------------------------------------------------------------------
// Lectura de la respuesta
// ---------------------------------------------------------------------------

/** Un jugador de la alineacion, ya limpio. */
export interface LineupPlayer {
  /** Nombre COMPLETO, tal cual lo da la API ("Ayoze Pérez"). */
  name: string
  number: number | null
  position: string | null
  /** Id de Highlightly. Mismo espacio que `HlEvent.playerId`. */
  id: string | null
}

export interface TeamLineup {
  /** Nombre del equipo segun la API, sin traducir. */
  apiName: string | null
  /** `null` si el nombre no esta en `HIGHLIGHTLY_TEAM_ALIASES`. */
  code: TeamCode | null
  formation: string | null
  starters: LineupPlayer[]
  substitutes: LineupPlayer[]
  /** Once + banquillo: el universo de gente que puede jugar este partido. */
  available: LineupPlayer[]
}

export interface MatchLineups {
  home: TeamLineup
  away: TeamLineup
  /** `true` si los dos equipos traen al menos un titular. */
  complete: boolean
}

/**
 * `initialLineup` puede venir como lista plana o como lista de lineas (el dibujo
 * tactico agrupado por posicion). Se aplanan las dos formas: aqui no interesa la
 * formacion, interesa quien esta.
 */
function flattenPlayers(raw: HlLineupPlayer[] | HlLineupPlayer[][] | null | undefined): LineupPlayer[] {
  if (!Array.isArray(raw)) return []
  const flat: HlLineupPlayer[] = []
  for (const entry of raw) {
    if (Array.isArray(entry)) flat.push(...entry)
    else if (entry) flat.push(entry)
  }
  const out: LineupPlayer[] = []
  const seen = new Set<string>()
  for (const player of flat) {
    const name = player?.name?.trim()
    if (!name) continue
    const key = normalizePlayer(name)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    const number = Number(player.number)
    out.push({
      name,
      number: Number.isFinite(number) ? number : null,
      position: player.position?.trim() || null,
      id: player.id === null || player.id === undefined ? null : String(player.id),
    })
  }
  return out
}

function readSide(side: HlLineupSide | null | undefined, resolveCode: (name: string | null) => TeamCode | null): TeamLineup {
  const apiName = side?.name?.trim() || null
  const starters = flattenPlayers(side?.initialLineup)
  const substitutes = flattenPlayers(side?.substitutes)
  return {
    apiName,
    code: resolveCode(apiName),
    formation: side?.formation?.trim() || null,
    starters,
    substitutes,
    available: [...starters, ...substitutes],
  }
}

/**
 * Trae la alineacion de un partido. **1 peticion.**
 *
 * `matchId` es el id de HIGHLIGHTLY, no el nuestro: sale de `linkMatches()` en
 * `match-link.ts` (`pair.api.apiId`). Pasar aqui un `matches.id` de Supabase
 * devuelve 404, no un error entendible.
 */
export async function getLineups(
  apiMatchId: string | number,
  options: HlFetchOptions = {},
): Promise<MatchLineups> {
  const resolveCode = (name: string | null) => (name ? resolveHighlightlyTeam(name) : null)

  const payload = await getMatchLineups(apiMatchId, options)
  const home = readSide(payload.homeTeam, resolveCode)
  const away = readSide(payload.awayTeam, resolveCode)
  return {
    home,
    away,
    complete: home.starters.length > 0 && away.starters.length > 0,
  }
}

// ---------------------------------------------------------------------------
// Quien ha apostado por alguien que no esta
// ---------------------------------------------------------------------------

/** Un pronostico, con lo justo para comprobarlo contra la alineacion. */
export interface PredictionPlayers {
  memberId: string
  /** Para el texto del aviso. */
  displayName?: string
  mvp?: string | null
  scorers?: string[] | null
  assists?: string[] | null
}

/** Un jugador pronosticado que no esta convocado, y en que casilla estaba. */
export interface MissingPick {
  memberId: string
  displayName?: string
  player: string
  slot: 'mvp' | 'scorer' | 'assist'
}

export interface MissingPicksResult {
  /** `false` cuando la alineacion no esta completa: entonces `picks` va vacio. */
  usable: boolean
  reason?: string
  picks: MissingPick[]
  /** Cuantos nombres se han comprobado. Para saber si el resultado dice algo. */
  checked: number
}

/**
 * Quien de la peña ha apostado por alguien que NO esta en la convocatoria.
 *
 * REGLA DE PRUDENCIA: si la alineacion no esta completa (falta un equipo, o
 * ninguno de los dos trae titulares) NO se devuelve nada. Un aviso falso de
 * "tu goleador no juega" a media peña es peor que no avisar: el que lo reciba
 * cambiara un pronostico que estaba bien, y encima dejara de fiarse del aviso
 * la proxima vez, que es cuando si sera verdad.
 *
 * La comparacion usa `normalizePlayer`, la misma de `samePlayer` y de
 * `norm_player` en SQL: si aqui se comparase de otra forma, esta funcion diria
 * "no esta convocado" de alguien que el calculo de puntos si reconoce.
 *
 * Un nombre vacio no se comprueba: "no he elegido goleador" no es un fallo.
 */
export function findMissingPicks(
  lineups: MatchLineups,
  predictions: PredictionPlayers[],
): MissingPicksResult {
  if (!lineups.complete) {
    return {
      usable: false,
      reason:
        'La alineacion no esta completa (falta algun equipo o ningun titular). No se avisa a nadie: ' +
        'un aviso falso de "tu goleador no juega" hace mas dano que no avisar.',
      picks: [],
      checked: 0,
    }
  }

  const available = new Set<string>()
  for (const player of [...lineups.home.available, ...lineups.away.available]) {
    const key = normalizePlayer(player.name)
    if (key !== '') available.add(key)
  }

  const picks: MissingPick[] = []
  let checked = 0

  const check = (
    prediction: PredictionPlayers,
    raw: string | null | undefined,
    slot: MissingPick['slot'],
  ) => {
    const name = raw?.trim()
    if (!name) return
    const key = normalizePlayer(name)
    if (key === '') return
    checked += 1
    if (available.has(key)) return
    picks.push({
      memberId: prediction.memberId,
      displayName: prediction.displayName,
      player: name,
      slot,
    })
  }

  for (const prediction of predictions) {
    check(prediction, prediction.mvp, 'mvp')
    for (const scorer of prediction.scorers ?? []) check(prediction, scorer, 'scorer')
    for (const assist of prediction.assists ?? []) check(prediction, assist, 'assist')
  }

  return { usable: true, picks, checked }
}

/**
 * Agrupa los avisos por miembro: una notificacion por persona, no una por
 * jugador. Tres jugadores fuera son tres lineas del mismo mensaje, no tres
 * vibraciones seguidas en el movil.
 */
export function groupMissingPicksByMember(
  picks: MissingPick[],
): Array<{ memberId: string; displayName?: string; players: string[] }> {
  const byMember = new Map<string, { memberId: string; displayName?: string; players: string[] }>()
  for (const pick of picks) {
    const entry = byMember.get(pick.memberId) ?? {
      memberId: pick.memberId,
      displayName: pick.displayName,
      players: [],
    }
    if (!entry.players.includes(pick.player)) entry.players.push(pick.player)
    byMember.set(pick.memberId, entry)
  }
  return [...byMember.values()]
}
