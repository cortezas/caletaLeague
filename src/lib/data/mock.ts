/**
 * RESPALDO de la capa de datos: lo que se sirve cuando NO hay Supabase configurado.
 *
 * No se borra. `data/{gameweek,standings,profile,league,squads}.ts` ya consultan la
 * base de datos de verdad, pero eligen: si `isSupabaseConfigured` es false (nadie ha
 * copiado `.env.example` a `.env.local`), delegan aqui. Asi la app arranca, se puede
 * ver entera y se puede trabajar en las pantallas sin levantar nada.
 *
 * Dos fuentes:
 *  - `src/lib/laliga.ts`: los 20 equipos y el calendario real de las 38 jornadas;
 *  - `src/lib/seed.ts`: los 12 de la pena y sus cifras de temporada.
 *
 * Los VM que devuelve son el contrato definitivo: lo que salga de aqui es
 * exactamente lo que renderizan las pantallas.
 *
 * Tres cosas se calculan y NO se cablean:
 *  - el estado de cada partido sale del reloj contra `kickoffAt`;
 *  - los puntos y los aciertos salen siempre de `src/lib/scoring.ts`;
 *  - los destacados del pique se cuentan sobre los pronosticos generados.
 *
 * SIN JUGADORES. Los pronosticos y los resultados de demostracion llevan el MVP,
 * los goleadores y los asistentes vacios a proposito: el plan gratuito de
 * football-data.org no da plantillas y aqui no se inventan futbolistas. Los nombres
 * llegan por el panel de admin (`src/lib/squads.ts`), y hasta entonces las pantallas
 * los pintan como "Sin designar" / "Falta el MVP".
 */

import type { MemberSession } from '../auth'
import { formatKickoff, scoreLabel } from '../format'
import { COMPETITION_LABEL, GAMEWEEKS, TEAMS, currentGameweek, gameweek } from '../laliga'
import type { CalendarGameweek } from '../laliga'
import { scoreGameweek, scoreMatch } from '../scoring'
import { LEAGUE, MY_GAMEWEEK_HISTORY, PEOPLE, STANDINGS, TREND } from '../seed'
import { normalizePlayer, samePlayer, squadOf } from '../squads'
import { DEFAULT_SCORING } from '../types'
import type { Match, MatchResult, MatchStatus, Prediction, Scoring, TeamCode } from '../types'
import type {
  AdminMatchVM,
  GameweekStandingsVM,
  GameweekVM,
  LeagueSettingsVM,
  MatchRowVM,
  PiqueVM,
  PredictEditorVM,
  ProfileVM,
  StandingsVM,
  SummaryVM,
  TeamVM,
} from '../view-models'

/* ------------------------------------------------------------------ *
 * 1. Estado del partido, derivado del reloj
 * ------------------------------------------------------------------ */

/**
 * Un partido con descanso y descuento no llega a dos horas: pasadas, se da por
 * jugado. Es la unica forma de que la demo ensene partidos abiertos, en juego y
 * jugados en la misma jornada sin cablear estados que envejecen mal.
 *
 * `locked` no se puede derivar del reloj (es "sellado pero sin datos", una decision
 * de la ingesta, no del tiempo) y por eso el mock no lo produce; la variante visual
 * sigue implementada en `match-row.tsx` para cuando la fase C traiga el estado real.
 */
const MATCH_DURATION_MS = 2 * 60 * 60 * 1000

function statusAt(kickoffAt: string, now: number): MatchStatus {
  const kickoff = Date.parse(kickoffAt)
  if (now < kickoff) return 'open'
  if (now < kickoff + MATCH_DURATION_MS) return 'live'
  return 'played'
}

/* ------------------------------------------------------------------ *
 * 2. Pronosticos y resultados generados
 * ------------------------------------------------------------------ */

/**
 * PRNG determinista sembrado por (memberId, matchId) o por matchId: siempre da lo
 * mismo en servidor y en cliente, asi que no hay mismatch de hidratacion ni hace
 * falta un fichero de datos con 380 partidos x 12 pronosticos.
 */
function fnv1a(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 0..3 goles con el 1 y el 2 pesando doble: la distribucion tipica de LaLiga. */
const GOAL_WEIGHTS = [0, 1, 1, 2, 2, 3]

function goalsFrom(next: () => number): number {
  return GOAL_WEIGHTS[Math.floor(next() * GOAL_WEIGHTS.length)]
}

/** Resultado real de un partido ya jugado. Sin jugadores de ningun tipo: ver cabecera. */
function generatedResult(matchId: string): MatchResult {
  const next = mulberry32(fnv1a(`result:${matchId}`))
  return { home: goalsFrom(next), away: goalsFrom(next), mvp: '', scorers: [], assists: [] }
}

/** Pronostico de un miembro para un partido. Sin jugadores de ningun tipo: ver cabecera. */
function generatedPrediction(memberId: string, matchId: string): Prediction {
  const next = mulberry32(fnv1a(`${memberId}:${matchId}`))
  const home = goalsFrom(next)
  const away = goalsFrom(next)
  // D19(a): `noGoals` es flag explicito. Aqui es cierto solo si el pronostico es 0-0.
  return { home, away, mvp: null, scorers: [], assists: [], noGoals: home + away === 0 }
}

/* ------------------------------------------------------------------ *
 * 3. Vista de una jornada
 * ------------------------------------------------------------------ */

/**
 * Cuantos de los ultimos partidos abiertos dejo YO sin pronosticar. Sin esto la
 * jornada siempre saldria completa y no se verian ni la fila "Sin pronosticar" ni
 * el aviso de partidos pendientes del resumen.
 */
const MY_UNPREDICTED_TAIL = 2

interface GameweekView {
  number: number
  matches: Match[]
  /** Ids que YO he dejado sin pronosticar. */
  myMissing: Set<string>
}

function viewOf(gw: CalendarGameweek, now: number): GameweekView {
  const matches: Match[] = gw.matches.map((m) => {
    const status = statusAt(m.kickoffAt, now)
    return {
      id: m.id,
      home: m.home,
      away: m.away,
      kickoffAt: m.kickoffAt,
      kickoffProvisional: m.kickoffProvisional,
      status,
      result: status === 'played' ? generatedResult(m.id) : undefined,
    }
  })

  const open = matches.filter((m) => m.status === 'open')

  return {
    number: gw.number,
    matches,
    myMissing: new Set(open.slice(-MY_UNPREDICTED_TAIL).map((m) => m.id)),
  }
}

/** La jornada por defecto: la del cierre mas proximo. Ver `currentGameweek`. */
function activeView(now: number): GameweekView {
  return viewOf(currentGameweek(new Date(now)), now)
}

/**
 * Las vecinas dentro del calendario, no 1 y 38 cableados: si algun dia se siembra
 * media temporada, las flechas tienen que morir donde muere el calendario.
 */
function navOf(number: number): Pick<GameweekVM, 'hasPrev' | 'hasNext' | 'prevNumber' | 'nextNumber'> {
  const index = GAMEWEEKS.findIndex((g) => g.number === number)
  const prev = index > 0 ? GAMEWEEKS[index - 1] : null
  const next = index >= 0 && index < GAMEWEEKS.length - 1 ? GAMEWEEKS[index + 1] : null
  return {
    hasPrev: prev !== null,
    hasNext: next !== null,
    prevNumber: prev?.number ?? null,
    nextNumber: next?.number ?? null,
  }
}

/** Un partido puede venir de cualquiera de las 38 jornadas, no solo de la activa. */
function findMatch(matchId: string, now: number): { view: GameweekView; match: Match } | null {
  const gw = GAMEWEEKS.find((g) => g.matches.some((m) => m.id === matchId))
  if (!gw) return null

  const view = viewOf(gw, now)
  const match = view.matches.find((m) => m.id === matchId)
  return match ? { view, match } : null
}

function myPredictionOf(view: GameweekView, myId: string, match: Match): Prediction | null {
  return view.myMissing.has(match.id) ? null : generatedPrediction(myId, match.id)
}

function predictionOf(view: GameweekView, memberId: string, myId: string, match: Match): Prediction | null {
  return memberId === myId
    ? myPredictionOf(view, myId, match)
    : generatedPrediction(memberId, match.id)
}

/* ------------------------------------------------------------------ *
 * 4. Helpers de VM
 * ------------------------------------------------------------------ */

/** `TEAMS` trae ademas `fullName` y `city`, que el VM de pantalla no necesita. */
function teamVM(code: TeamCode): TeamVM {
  const team = TEAMS[code]
  return { code, name: team.name, color: team.color, ink: team.ink }
}

/** 'Sevilla – Valencia' (guion largo con espacios, como el prototipo). */
function matchLabel(match: Match): string {
  return `${TEAMS[match.home].name} – ${TEAMS[match.away].name}`
}

function resultOf(match: Match): MatchResult | null {
  return match.status === 'played' && match.result ? match.result : null
}

function matchRowVM(match: Match, myPrediction: Prediction | null, scoring: Scoring): MatchRowVM {
  const result = resultOf(match)
  const breakdown = myPrediction && result ? scoreMatch(myPrediction, result, scoring) : null

  return {
    id: match.id,
    home: teamVM(match.home),
    away: teamVM(match.away),
    kickoffAt: match.kickoffAt,
    kickoffLabel: formatKickoff(match.kickoffAt),
    kickoffProvisional: match.kickoffProvisional,
    status: match.status,
    myPrediction,
    result,
    myPoints: breakdown ? breakdown.points : null,
    exactHit: breakdown ? breakdown.exact : false,
  }
}

function myRows(view: GameweekView, myId: string, scoring: Scoring): MatchRowVM[] {
  return view.matches.map((m) => matchRowVM(m, myPredictionOf(view, myId, m), scoring))
}

/**
 * El miembro del seed, que es "yo" mientras no haya Supabase configurado.
 *
 * Vive AQUI y no en `lib/auth.ts` para romper el ciclo de imports: ahora
 * `auth.ts` depende de la capa de datos (para resolver la sesion real) y la
 * capa de datos no puede depender de `auth.ts`. La direccion es una sola:
 * auth -> data. En seco, `requireMember()` devuelve exactamente esto.
 */
export function mockMemberSession(): MemberSession {
  const me = PEOPLE.find((p) => p.isMe)
  // El seed sin miembro `isMe` seria un error de datos, no un caso de UI.
  if (!me) throw new Error('seed sin miembro isMe')
  return {
    memberId: me.id,
    userId: `user-${me.id}`,
    displayName: me.displayName,
    avatarColor: me.avatarColor,
    leagueId: 'lg-caleta',
    leagueName: LEAGUE.name,
    // En el prototipo el usuario organiza: /ajustes enseña la tarjeta de admin.
    isAdmin: true,
  }
}

/** Contexto comun: quien soy, que puntuacion rige y en que instante se pinta todo. */
async function context() {
  const member = mockMemberSession()
  return { member, myId: member.memberId, now: Date.now(), scoring: DEFAULT_SCORING }
}

/**
 * Nombres distintos que la pena ya ha usado, para el autocompletado del editor
 * cuando no hay plantilla. Se recorren los resultados reales y los pronosticos de
 * los 12 en las jornadas ya empezadas, y se deduplica por nombre normalizado
 * quedandose con la PRIMERA forma escrita: asi no conviven "Mbappe" y "Mbappé".
 *
 * Hoy devuelve [] porque ni los resultados ni los pronosticos generados llevan
 * jugadores (ver cabecera). La funcion existe igualmente para que la fase C solo
 * tenga que cambiar la fuente por un `select distinct`, no la forma del VM.
 */
function usedPlayerNames(now: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  const add = (name: string | null) => {
    if (!name) return
    const key = normalizePlayer(name)
    if (key === '' || seen.has(key)) return
    seen.add(key)
    out.push(name)
  }

  for (const gw of GAMEWEEKS) {
    // Una jornada que no ha empezado no tiene ni resultados ni pronosticos
    // revelables: recorrer las 38 enteras seria trabajo tirado.
    if (gw.matches.every((m) => statusAt(m.kickoffAt, now) === 'open')) continue

    const view = viewOf(gw, now)
    for (const match of view.matches) {
      const result = resultOf(match)
      if (result) {
        add(result.mvp)
        result.scorers.forEach(add)
        result.assists.forEach(add)
      }
      for (const person of PEOPLE) {
        const prediction = generatedPrediction(person.id, match.id)
        add(prediction.mvp)
        prediction.scorers.forEach(add)
        prediction.assists.forEach(add)
      }
    }
  }

  return out
}

/* ------------------------------------------------------------------ *
 * 5. Las 9 funciones de la capa de datos
 * ------------------------------------------------------------------ */

function gameweekVM(
  view: GameweekView,
  myId: string,
  scoring: Scoring,
  isDefault: boolean,
): GameweekVM {
  const matches = myRows(view, myId, scoring)
  const firstOpen = matches.find((m) => m.status === 'open') ?? null

  return {
    number: view.number,
    competitionLabel: COMPETITION_LABEL,
    deadlineAt: firstOpen ? firstOpen.kickoffAt : null,
    // Guion largo SIN espacios: es como lo pinta el eyebrow del prototipo.
    deadlineLabel: firstOpen ? `Cierra ${firstOpen.home.name}–${firstOpen.away.name}` : null,
    matches,
    predictedCount: matches.filter((m) => m.myPrediction !== null).length,
    totalCount: matches.length, // D19(b): nunca el literal 10
    ...navOf(view.number),
    isDefault,
  }
}

export async function mockGetActiveGameweek(): Promise<GameweekVM> {
  const { myId, now, scoring } = await context()
  return gameweekVM(activeView(now), myId, scoring, true)
}

/** `null` si esa jornada no esta en el calendario. */
export async function mockGetGameweek(n: number): Promise<GameweekVM | null> {
  const gw = gameweek(n)
  if (!gw) return null

  const { myId, now, scoring } = await context()
  const isDefault = currentGameweek(new Date(now)).number === n

  return gameweekVM(viewOf(gw, now), myId, scoring, isDefault)
}

/** Sin argumento, el repaso de la jornada por defecto. `null` si el numero no existe. */
export async function mockGetGameweekSummary(n?: number): Promise<SummaryVM | null> {
  const { myId, now, scoring } = await context()

  const gw = n === undefined ? currentGameweek(new Date(now)) : gameweek(n)
  if (!gw) return null

  const view = viewOf(gw, now)
  const matches = myRows(view, myId, scoring)

  const rows = matches.map((m, i) => ({
    index: i + 1,
    matchId: m.id,
    label: `${m.home.name} – ${m.away.name}`,
    myScore: m.myPrediction ? scoreLabel(m.myPrediction.home, m.myPrediction.away) : null,
    status: m.status,
    points: m.myPoints,
  }))

  const predictedCount = matches.filter((m) => m.myPrediction !== null).length
  const firstMissing = matches.find((m) => m.status === 'open' && m.myPrediction === null) ?? null

  return {
    gameweekNumber: view.number,
    rows,
    predictedCount,
    missingCount: matches.length - predictedCount,
    firstMissingMatchId: firstMissing ? firstMissing.id : null,
  }
}

export async function mockGetMatchEditor(matchId: string): Promise<PredictEditorVM | null> {
  const { myId, now, scoring } = await context()
  const found = findMatch(matchId, now)
  if (!found) return null

  const { view, match } = found
  const myPrediction = myPredictionOf(view, myId, match)

  return {
    match: matchRowVM(match, myPrediction, scoring),
    editable: match.status === 'open',
    // Sin plantillas cargadas por el organizador, `squadOf` devuelve []: el
    // selector se queda vacio y el nombre se escribe a mano.
    squads: [match.home, match.away].map((code) => ({ ...teamVM(code), players: squadOf(code) })),
    suggestions: usedPlayerNames(now),
    initialDraft: {
      home: myPrediction?.home ?? 0,
      away: myPrediction?.away ?? 0,
      mvp: myPrediction?.mvp ?? null,
      scorers: myPrediction?.scorers ?? [],
      assists: myPrediction?.assists ?? [],
      // D19(a): `noGoals` es flag explicito, jamas se deduce de scorers.length === 0.
      noGoals: myPrediction?.noGoals ?? false,
    },
    scoring,
  }
}

export async function mockGetMatchPique(matchId: string): Promise<PiqueVM | null> {
  const { myId, now, scoring } = await context()
  const found = findMatch(matchId, now)
  if (!found) return null

  const { view, match } = found

  // Los pronosticos ajenos no se revelan hasta que el partido esta jugado.
  const result = resultOf(match)
  if (!result) return null

  // Goleadores reales distintos. Se cuentan normalizados: "Vinicius" y "Vinícius"
  // escritos por dos personas distintas son el mismo gol.
  const realScorers = new Set(result.scorers.map(normalizePlayer))
  // Las asistencias reales van por su cuenta: no son la pareja de cada gol.
  const realAssists = new Set(result.assists.map(normalizePlayer))
  const goalless = result.home + result.away === 0
  // Sin goleadores reales no hay nada que comparar, salvo que el partido acabara 0-0.
  const hasScorerData = realScorers.size > 0 || goalless

  const entries = PEOPLE.map((person) => {
    const prediction = predictionOf(view, person.id, myId, match) ?? {
      home: 0,
      away: 0,
      mvp: null,
      scorers: [],
      assists: [],
    }
    const breakdown = scoreMatch(prediction, result, scoring)

    const chips: PiqueVM['rows'][number]['chips'] = [
      { kind: 'mvp', label: `MVP: ${prediction.mvp ?? '—'}`, hit: breakdown.mvpHit },
    ]
    if (prediction.noGoals) chips.push({ kind: 'noGoals', label: 'Sin goles', hit: goalless })
    for (const scorer of prediction.scorers) {
      chips.push({
        kind: 'scorer',
        label: scorer,
        hit: result.scorers.some((real) => samePlayer(real, scorer)),
      })
    }
    for (const assist of prediction.assists) {
      chips.push({
        kind: 'assist',
        label: assist,
        hit: result.assists.some((real) => samePlayer(real, assist)),
      })
    }

    return {
      prediction,
      row: {
        memberId: person.id,
        displayName: person.displayName,
        avatarColor: person.avatarColor,
        isMe: person.id === myId,
        home: prediction.home,
        away: prediction.away,
        mvp: prediction.mvp,
        scorers: prediction.scorers,
        assists: prediction.assists,
        points: breakdown.points,
        exact: breakdown.exact,
        signHit: breakdown.signHit,
        chips,
      },
    }
  }).sort((a, b) => b.row.points - a.row.points)

  const rows = entries.map((e) => e.row)

  // Destacados calculados sobre los pronosticos reales, nunca cableados.
  const exactCount = rows.filter((r) => r.exact).length
  const mvpCount = rows.filter((r) => samePlayer(r.mvp, result.mvp)).length
  const scorersCount = goalless
    ? entries.filter((e) => e.prediction.noGoals).length
    : entries.filter((e) =>
        result.scorers.every((real) => e.prediction.scorers.some((s) => samePlayer(s, real))),
      ).length
  const assistsCount = entries.filter((e) =>
    result.assists.every((real) => e.prediction.assists.some((a) => samePlayer(a, real))),
  ).length
  const anyoneGuessedAssists = entries.some((e) => e.prediction.assists.length > 0)

  const realScore = scoreLabel(result.home, result.away, '–')
  const assistLabel = realAssists.size === 1 ? 'la asistencia' : `las ${realAssists.size} asistencias`

  const highlights: PiqueVM['highlights'] = [
    {
      value: String(exactCount),
      tone: 'ok',
      text: exactCount > 0
        ? `clavaron el ${realScore} exacto. Se reparten ${scoring.exact} puntos cada uno.`
        : `nadie clavó el ${realScore} exacto. La peña, en blanco.`,
    },
    // El MVP lo designa el organizador: mientras no lo haga no hay a quien contar.
    result.mvp
      ? {
          value: String(mvpCount),
          tone: 'accent',
          text: mvpCount > 0
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
            ? (scorersCount > 0 ? 'acertaron que no habría goles.' : 'nadie acertó que no habría goles.')
            : (scorersCount > 0
                ? `acertaron los ${realScorers.size} goleadores enteros.`
                : `nadie acertó los ${realScorers.size} goleadores. Ni de casualidad.`),
        }
      : {
          value: '—',
          tone: 'neutral',
          text: 'los goleadores los mete el organizador y aún no están.',
        },
  ]

  // Mismo criterio que en la capa real: el destacado de asistencias solo aparece
  // si hay algo que contar. En este modo nunca hay nombres, asi que no sale.
  if (realAssists.size > 0) {
    highlights.push({
      value: String(assistsCount),
      tone: 'neutral',
      text: assistsCount > 0
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

  return {
    match: matchRowVM(match, myPredictionOf(view, myId, match), scoring),
    highlights,
    rows,
    memberCount: PEOPLE.length,
  }
}

export async function mockGetSeasonStandings(): Promise<StandingsVM> {
  const { myId } = await context()

  const rows = PEOPLE
    .map((person, index) => ({
      memberId: person.id,
      displayName: person.displayName,
      avatarColor: person.avatarColor,
      points: STANDINGS[index],
      trend: TREND[index],
      isMe: person.id === myId,
    }))
    .sort((a, b) => b.points - a.points)
    .map((row, index) => ({ position: index + 1, ...row }))

  return { leagueName: LEAGUE.name, rows }
}

export async function mockGetGameweekStandings(n: number): Promise<GameweekStandingsVM | null> {
  const gw = gameweek(n)
  if (!gw) return null

  const { myId, now, scoring } = await context()
  const view = viewOf(gw, now)

  const playedMatches = view.matches.filter((m) => resultOf(m) !== null)
  const pendingCount = view.matches.length - playedMatches.length

  const rows = PEOPLE
    .map((person) => {
      const entries = view.matches.map((m) => ({
        prediction: predictionOf(view, person.id, myId, m),
        result: resultOf(m),
      }))
      const total = scoreGameweek(entries, scoring)

      const breakdown = playedMatches.map((m) => {
        const prediction = predictionOf(view, person.id, myId, m)
        const result = resultOf(m)!
        return {
          matchId: m.id,
          label: matchLabel(m),
          myScore: prediction ? scoreLabel(prediction.home, prediction.away) : scoreLabel(null, null),
          realScore: scoreLabel(result.home, result.away),
          points: prediction ? scoreMatch(prediction, result, scoring).points : 0,
        }
      })

      return {
        memberId: person.id,
        displayName: person.displayName,
        avatarColor: person.avatarColor,
        points: total.total,
        isMe: person.id === myId,
        breakdown,
        pendingCount,
      }
    })
    .sort((a, b) => b.points - a.points)
    .map((row, index) => ({ position: index + 1, ...row }))

  const played = playedMatches.length
  const inPlay = view.matches.some((m) => m.status === 'live' || m.status === 'locked')
  const prefix = played === view.matches.length ? 'Finalizada' : played > 0 || inPlay ? 'En juego' : 'Por jugar'

  return {
    number: n,
    hasPrev: n > 1,
    hasNext: n < GAMEWEEKS.length,
    statusLabel: `${prefix} · ${played} de ${view.matches.length} partidos`,
    rows,
  }
}

/**
 * `exactHits` y `signAccuracy` son cifras de temporada de la pena, no de LaLiga:
 * no se pueden calcular sin el historico de pronosticos. Se toman del prototipo
 * (11 aciertos exactos, 62% de 1X2). En la fase C salen de la vista SQL.
 */
const SEASON_EXACT_HITS = 11
const SEASON_SIGN_ACCURACY = 62
const STREAK_COUNT = 3

export async function mockGetProfile(): Promise<ProfileVM> {
  const { member } = await context()
  const standings = await mockGetSeasonStandings()

  const myRow = standings.rows.find((r) => r.isMe) ?? standings.rows[0]

  // D19(c): el maximo es dinamico, no el literal 23.
  const bestPoints = Math.max(...MY_GAMEWEEK_HISTORY.map((g) => g.points))
  const best = MY_GAMEWEEK_HISTORY.find((g) => g.points === bestPoints)!

  return {
    displayName: member.displayName,
    avatarColor: member.avatarColor,
    position: myRow.position,
    memberCount: PEOPLE.length,
    leagueName: LEAGUE.name,
    totalPoints: myRow.points,
    stats: {
      totalPoints: myRow.points,
      exactHits: SEASON_EXACT_HITS,
      signAccuracy: SEASON_SIGN_ACCURACY, // porcentaje entero
      bestGameweekPoints: bestPoints,
      bestGameweekNumber: best.gameweek,
    },
    chart: MY_GAMEWEEK_HISTORY.map((g) => ({ gameweek: g.gameweek, points: g.points })),
    streak: {
      count: STREAK_COUNT,
      title: `Racha de ${STREAK_COUNT} jornadas`,
      text: 'Llevas tres jornadas seguidas puntuando por encima de la media de la peña.',
    },
  }
}

export async function mockGetLeagueSettings(): Promise<LeagueSettingsVM> {
  const { member } = await context()
  return {
    leagueName: LEAGUE.name,
    inviteCode: LEAGUE.inviteCode,
    memberCount: PEOPLE.length,
    isAdmin: member.isAdmin,
    scoring: DEFAULT_SCORING,
    displayName: member.displayName,
    avatarColor: member.avatarColor,
  }
}

/**
 * Plantillas de los dos equipos de un partido, en orden [local, visitante].
 * Sin base de datos `SQUADS` esta vacio, asi que siempre devuelve `players: []`
 * y el editor cae en modo texto libre. Es el caso normal en este modo.
 */
export async function mockGetSquadsForMatch(
  homeCode: TeamCode,
  awayCode: TeamCode,
): Promise<Array<{ code: TeamCode; players: string[] }>> {
  return [homeCode, awayCode].map((code) => ({ code, players: squadOf(code) }))
}

/** Nombres que la pena ya ha usado. Hoy `[]`: ver `usedPlayerNames`. */
export async function mockGetUsedPlayerNames(): Promise<string[]> {
  const { now } = await context()
  return usedPlayerNames(now)
}

export async function mockGetAdminMatches(): Promise<AdminMatchVM[]> {
  const { now } = await context()
  const view = activeView(now)

  return view.matches.map((match) => {
    const result = resultOf(match)
    return {
      id: match.id,
      label: matchLabel(match),
      status: match.status,
      result,
      missingMvp: match.status === 'played' && !result?.mvp,
      players: [...squadOf(match.home), ...squadOf(match.away)],
    }
  })
}
