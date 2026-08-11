/**
 * Cliente de football-data.org API v4.
 *
 * Autenticacion: cabecera `X-Auth-Token`. Nunca en la query string (acabaria en
 * los logs del proxy y en el historial).
 *
 * Cuota del plan gratuito: 10 peticiones/minuto. Por eso la ingesta completa se
 * hace con UNA sola llamada a `getCompetitionMatches()`, que devuelve los 380
 * partidos de la temporada de golpe. No hay paginacion que recorrer.
 *
 * SOLO SERVIDOR. `FOOTBALL_DATA_TOKEN` no lleva prefijo `NEXT_PUBLIC_` a
 * proposito: si viajara al navegador cualquiera podria quemar la cuota.
 */

import type {
  FdCompetitionMatchesResponse,
  FdErrorBody,
  FdRateLimit,
  FdStatusFilter,
} from './types'

const API_BASE = 'https://api.football-data.org/v4'

/** Codigo de LaLiga (Primera Division) en football-data.org. */
export const COMPETITION_CODE = 'PD'

const TOKEN = process.env.FOOTBALL_DATA_TOKEN

/**
 * Permite que la app arranque sin token: sin el, la UI sigue funcionando con el
 * calendario cableado de `src/lib/laliga.ts` y solo falla quien pida ingesta.
 */
export const isFootballDataConfigured = Boolean(TOKEN)

/** Error de la API o del transporte, con lo necesario para decidir si reintentar. */
export class FootballDataError extends Error {
  /** Codigo HTTP. 0 si ni siquiera hubo respuesta (red caida, timeout). */
  readonly status: number
  /** `errorCode` del cuerpo, cuando la API lo manda. */
  readonly errorCode: number | null
  readonly rateLimit: FdRateLimit

  constructor(
    message: string,
    status: number,
    errorCode: number | null = null,
    rateLimit: FdRateLimit = { availableMinute: null, resetSeconds: null },
  ) {
    super(message)
    this.name = 'FootballDataError'
    this.status = status
    this.errorCode = errorCode
    this.rateLimit = rateLimit
  }

  /** 429 (cuota) y 5xx son transitorios; el cron puede volver a intentarlo. */
  get retryable(): boolean {
    return this.status === 429 || this.status === 0 || this.status >= 500
  }
}

function readRateLimit(headers: Headers): FdRateLimit {
  const toInt = (raw: string | null) => {
    if (raw === null) return null
    const n = Number.parseInt(raw, 10)
    return Number.isFinite(n) ? n : null
  }
  return {
    availableMinute: toInt(headers.get('X-Requests-Available-Minute')),
    resetSeconds: toInt(headers.get('X-RequestCounter-Reset')),
  }
}

export interface FdRequestMeta {
  rateLimit: FdRateLimit
  /** Milisegundos que tardo la peticion. Va al informe de sincronizacion. */
  durationMs: number
}

export interface FdResponse<T> {
  data: T
  meta: FdRequestMeta
}

interface FdFetchOptions {
  /** Corta la peticion si la API no contesta. Por defecto 15 s. */
  timeoutMs?: number
  signal?: AbortSignal
}

async function fdFetch<T>(
  path: string,
  query: Record<string, string | number | undefined> = {},
  options: FdFetchOptions = {},
): Promise<FdResponse<T>> {
  if (!TOKEN) {
    throw new FootballDataError(
      'Falta FOOTBALL_DATA_TOKEN. Registrate gratis en football-data.org, copia el token ' +
        'y ponlo en .env.local (sin prefijo NEXT_PUBLIC_). Mientras tanto la app sigue ' +
        'funcionando con el calendario de src/lib/laliga.ts.',
      0,
    )
  }

  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  const started = Date.now()
  let response: Response
  try {
    response = await fetch(url, {
      headers: { 'X-Auth-Token': TOKEN, Accept: 'application/json' },
      // Datos en vivo: la ingesta jamas debe leer de una cache intermedia.
      cache: 'no-store',
      signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? 15_000),
    })
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    throw new FootballDataError(`No se pudo contactar con football-data.org: ${reason}`, 0)
  }

  const durationMs = Date.now() - started
  const rateLimit = readRateLimit(response.headers)

  if (!response.ok) {
    // El cuerpo de error es JSON, pero ante un 502 del CDN puede ser HTML.
    let body: FdErrorBody = {}
    try {
      body = (await response.json()) as FdErrorBody
    } catch {
      /* cuerpo no JSON: nos quedamos con el codigo HTTP */
    }
    const detail = body.message ?? response.statusText
    const hint =
      response.status === 429
        ? ' El plan gratuito da 10 peticiones/minuto.'
        : response.status === 403
          ? ' Ese recurso o ese filtro no entran en el plan gratuito.'
          : response.status === 400
            ? ' Revisa los filtros de la query string.'
            : ''
    throw new FootballDataError(
      `football-data.org ${response.status}: ${detail}.${hint}`,
      response.status,
      body.errorCode ?? null,
      rateLimit,
    )
  }

  const data = (await response.json()) as T
  return { data, meta: { rateLimit, durationMs } }
}

export interface CompetitionMatchesQuery {
  /**
   * Ano de INICIO de temporada: `2026` para la 2026/27. Si se omite, la API
   * devuelve la temporada en curso, que es lo que quiere el cron.
   * El plan gratuito solo sirve la temporada actual; pedir una pasada da 403.
   */
  season?: number
  /** Una jornada concreta, 1..38. Sin esto vienen las 38 en la misma peticion. */
  matchday?: number
  /** `YYYY-MM-DD`. Va siempre en pareja con `dateTo`. */
  dateFrom?: string
  dateTo?: string
  /** Coma-separado. `LIVE` es un pseudo-estado que agrupa IN_PLAY + PAUSED. */
  status?: FdStatusFilter | FdStatusFilter[]
}

/**
 * `GET /v4/competitions/PD/matches` - UNA peticion, toda la temporada.
 *
 * Sin filtros devuelve los 380 partidos con su jornada, su hora UTC, su estado y
 * su marcador. Es el unico endpoint que necesita la ingesta.
 */
export async function getCompetitionMatches(
  query: CompetitionMatchesQuery = {},
  options: FdFetchOptions = {},
): Promise<FdResponse<FdCompetitionMatchesResponse>> {
  return fdFetch<FdCompetitionMatchesResponse>(
    `/competitions/${COMPETITION_CODE}/matches`,
    {
      season: query.season,
      matchday: query.matchday,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      status: Array.isArray(query.status) ? query.status.join(',') : query.status,
    },
    options,
  )
}
