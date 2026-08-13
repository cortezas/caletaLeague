/**
 * Cliente de Highlightly (`https://soccer.highlightly.net`).
 *
 * Autenticacion: cabecera `x-rapidapi-key`. Nunca en la query string (acabaria
 * en los logs del proxy y en el historial del navegador).
 *
 * CUOTA: 100 PETICIONES AL DIA. No es una recomendacion, es el plan entero.
 * Todo el modulo esta construido alrededor de ese numero:
 *   - una peticion por DIA de partidos para listar (`getMatchesByDate`);
 *   - una peticion por PARTIDO terminado que aun no tenga goleadores
 *     (`getMatchEvents`);
 *   - las alineaciones (`getMatchLineups`) se piden a mano, no van en el cron.
 * El desglose real por jornada esta en docs/EVENTOS.md.
 *
 * `RequestBudget` cuenta las peticiones de una pasada y CORTA cuando se llega al
 * tope. Sin ese corte, un bucle con un filtro mal escrito se come la cuota del
 * dia en un minuto y deja la peña sin goleadores hasta mañana.
 *
 * SOLO SERVIDOR. `HIGHLIGHTLY_API_KEY` no lleva prefijo `NEXT_PUBLIC_` a
 * proposito: si viajara al navegador, cualquiera quemaria las 100 peticiones.
 */

import type { HlErrorBody, HlEvent, HlLeague, HlLineupsResponse, HlListResponse, HlMatch } from './types'

const API_BASE = 'https://soccer.highlightly.net'

/**
 * `leagueId` de LaLiga en Highlightly, segun `GET /leagues?leagueName=La Liga`.
 * Se deja configurable por si la API renumera: `HIGHLIGHTLY_LALIGA_ID`.
 */
export const LALIGA_LEAGUE_ID = Number(process.env.HIGHLIGHTLY_LALIGA_ID ?? 119924)

/**
 * La clave se lee en cada llamada y no al importar el modulo, igual que en
 * `football-data/squads.ts`: asi un despliegue que anade la variable no necesita
 * reiniciar el proceso para que el paso empiece a funcionar.
 */
function readKey(): string | undefined {
  const key = process.env.HIGHLIGHTLY_API_KEY?.trim()
  return key ? key : undefined
}

/**
 * `false` si falta la clave. Quien llame TIENE que mirar esto antes: sin clave el
 * paso se SALTA con un aviso, nunca revienta la ingesta de football-data.org,
 * que es la que sostiene el calendario y sin la cual no se puede ni jugar.
 */
export const isHighlightlyConfigured = Boolean(readKey())

/** Error de la API o del transporte, con lo justo para decidir si reintentar. */
export class HighlightlyError extends Error {
  /** Codigo HTTP. 0 si ni siquiera hubo respuesta (red caida, timeout). */
  readonly status: number
  /** Cuerpo textual de la API, cuando lo manda. */
  readonly detail: string | null

  constructor(message: string, status: number, detail: string | null = null) {
    super(message)
    this.name = 'HighlightlyError'
    this.status = status
    this.detail = detail
  }

  /**
   * 429 y 5xx son transitorios. El 403 NO lo es: es "falta la cabecera" o "se
   * acabo la cuota del dia", y en los dos casos reintentar solo gasta mas.
   */
  get retryable(): boolean {
    return this.status === 429 || this.status === 0 || this.status >= 500
  }

  /** `true` cuando el mensaje huele a cuota agotada. Corta la pasada entera. */
  get quotaExhausted(): boolean {
    if (this.status === 429) return true
    const haystack = `${this.message} ${this.detail ?? ''}`.toLowerCase()
    return /quota|limit|exceed/.test(haystack)
  }
}

// ---------------------------------------------------------------------------
// Presupuesto de peticiones
// ---------------------------------------------------------------------------

/** Se lanza al agotar el presupuesto de la pasada. No es un fallo de la API. */
export class BudgetExhaustedError extends Error {
  readonly spent: number
  readonly limit: number
  constructor(spent: number, limit: number) {
    super(
      `Presupuesto de peticiones agotado: ${spent}/${limit} en esta pasada. El plan gratuito de ` +
        'Highlightly da 100 peticiones AL DIA; el resto de partidos se resuelven en la siguiente ' +
        'pasada del cron.',
    )
    this.name = 'BudgetExhaustedError'
    this.spent = spent
    this.limit = limit
  }
}

/**
 * Contador de peticiones de UNA pasada.
 *
 * No sabe cuantas se han gastado hoy: la API no devuelve cabeceras de cuota
 * restante que hayamos podido verificar (ver docs/EVENTOS.md). Lo que hace es
 * garantizar que una sola pasada no pueda gastar mas de lo que se le autoriza,
 * que es la parte que SI esta en nuestra mano.
 */
export class RequestBudget {
  private used = 0
  constructor(readonly limit: number) {}

  get spent(): number {
    return this.used
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.used)
  }

  /** Reserva una peticion. Lanza `BudgetExhaustedError` si ya no queda. */
  take(): void {
    if (this.used >= this.limit) throw new BudgetExhaustedError(this.used, this.limit)
    this.used += 1
  }
}

// ---------------------------------------------------------------------------
// Transporte
// ---------------------------------------------------------------------------

export interface HlFetchOptions {
  /** Corta la peticion si la API no contesta. Por defecto 15 s. */
  timeoutMs?: number
  /** Contador de la pasada. Si se pasa, cada llamada reserva una unidad. */
  budget?: RequestBudget
  signal?: AbortSignal
}

async function hlFetch<T>(
  path: string,
  query: Record<string, string | number | undefined> = {},
  options: HlFetchOptions = {},
): Promise<T> {
  const key = readKey()
  if (!key) {
    // `Error` pelado y no `HighlightlyError`: esta ultima marca como reintentable
    // todo lo que no llego a la red, y una clave que falta no se arregla
    // reintentando. Un cron que lo tratara como transitorio repetiria la misma
    // pasada fallida para siempre.
    throw new Error(
      'Falta HIGHLIGHTLY_API_KEY. Los goleadores y las asistencias se leen de Highlightly; sin ' +
        'clave ese paso se salta y el organizador los sigue metiendo a mano desde /ajustes/admin. ' +
        'El calendario y los marcadores NO dependen de esta clave.',
    )
  }

  // El presupuesto se reserva ANTES de salir a la red: si se contara despues, un
  // fallo de red no descontaria y el bucle podria dar mil vueltas.
  options.budget?.take()

  const url = new URL(`${API_BASE}${path}`)
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(name, String(value))
  }

  let response: Response
  try {
    response = await fetch(url, {
      headers: { 'x-rapidapi-key': key, Accept: 'application/json' },
      // Datos en vivo: este paso jamas debe leer de una cache intermedia.
      cache: 'no-store',
      signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? 15_000),
    })
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    throw new HighlightlyError(`No se pudo contactar con Highlightly: ${reason}`, 0)
  }

  if (!response.ok) {
    let detail: string | null = null
    try {
      const body = (await response.json()) as HlErrorBody
      detail = body.error ?? body.message ?? null
    } catch {
      /* ante un 502 del CDN el cuerpo es HTML: nos quedamos con el codigo */
    }
    const hint =
      response.status === 403
        ? ' Un 403 aqui es cabecera x-rapidapi-key ausente/invalida o cuota del dia agotada.'
        : response.status === 429
          ? ' El plan gratuito da 100 peticiones AL DIA.'
          : ''
    throw new HighlightlyError(
      `Highlightly ${response.status}: ${detail ?? response.statusText}.${hint}`,
      response.status,
      detail,
    )
  }

  try {
    return (await response.json()) as T
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    throw new HighlightlyError(`Highlightly devolvio algo que no es JSON: ${reason}`, response.status)
  }
}

/**
 * Desenvuelve las dos formas en las que la API sirve una lista: el array pelado
 * o un sobre `{ data: [...] }`. Cualquier otra cosa devuelve `[]` en vez de
 * reventar: una respuesta inesperada tiene que dejar el partido sin resolver,
 * no tumbar la pasada.
 */
export function readList<T>(payload: HlListResponse<T> | null | undefined): T[] {
  if (Array.isArray(payload)) return payload
  if (payload && Array.isArray(payload.data)) return payload.data
  return []
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/**
 * `GET /leagues?leagueName=...` - solo para diagnostico y para confirmar el id
 * de LaLiga. NO se llama desde el cron: gastaria una peticion por pasada en algo
 * que es una constante.
 */
export async function getLeagues(leagueName: string, options: HlFetchOptions = {}): Promise<HlLeague[]> {
  const payload = await hlFetch<HlListResponse<HlLeague>>('/leagues', { leagueName }, options)
  return readList(payload)
}

/**
 * `GET /matches?leagueId=...&date=YYYY-MM-DD` - los partidos de LaLiga de ese dia.
 *
 * UNA peticion por dia, no por partido: una jornada de 10 partidos se reparte en
 * 3 o 4 dias, asi que aqui se gastan 3 o 4 peticiones y no 10.
 *
 * La fecha va en el huso de Europe/Madrid, que es como la piensa la peña. Ojo:
 * no esta verificado en que huso la interpreta la API (docs/EVENTOS.md); por eso
 * `match-link.ts` acepta tambien el partido que aparezca en el dia contiguo.
 */
export async function getMatchesByDate(
  date: string,
  options: HlFetchOptions & { leagueId?: number } = {},
): Promise<HlMatch[]> {
  const payload = await hlFetch<HlListResponse<HlMatch>>(
    '/matches',
    { leagueId: options.leagueId ?? LALIGA_LEAGUE_ID, date },
    options,
  )
  return readList(payload)
}

/**
 * `GET /events/{matchId}` - goles, tarjetas y cambios de un partido.
 * Un evento de gol trae goleador Y asistente en la misma entrada.
 */
export async function getMatchEvents(
  matchId: string | number,
  options: HlFetchOptions = {},
): Promise<HlEvent[]> {
  const payload = await hlFetch<HlListResponse<HlEvent>>(
    `/events/${encodeURIComponent(String(matchId))}`,
    {},
    options,
  )
  return readList(payload)
}

/**
 * `GET /lineups/{matchId}` - once inicial y suplentes, con nombres COMPLETOS.
 *
 * No entra en el cron de goleadores: se pide a mano (o desde el cron de avisos,
 * cuando exista) y cuesta 1 peticion por partido. Ver `lineups.ts`.
 */
export async function getMatchLineups(
  matchId: string | number,
  options: HlFetchOptions = {},
): Promise<HlLineupsResponse> {
  return hlFetch<HlLineupsResponse>(`/lineups/${encodeURIComponent(String(matchId))}`, {}, options)
}
