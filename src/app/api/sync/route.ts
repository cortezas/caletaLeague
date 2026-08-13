/**
 * `POST /api/sync` - dispara la ingesta.
 *
 * Tres pasos, dos proveedores y dos cuotas muy distintas:
 *   1. partidos, jornadas, horarios y marcadores (`syncMatches`, football-data.org);
 *   2. plantillas de los 20 equipos (`syncSquads`, football-data.org), que se
 *      pueden saltar con `?squads=0` en las pasadas frecuentes de dia de partido;
 *   3. goleadores y asistencias (`syncMatchEvents`, Highlightly), que se pueden
 *      saltar con `?events=0`.
 *
 * El paso 1 es el imprescindible: sin el no hay calendario y no se puede jugar.
 * Los pasos 2 y 3 son SUBORDINADOS y no lanzan NUNCA: devuelven su fallo dentro
 * del informe (`squads` / `events`) y la sincronizacion de partidos se da por
 * buena igual.
 *
 * CUOTAS, que no son la misma:
 *   - football-data.org: 10 peticiones por MINUTO. Los pasos 1 y 2 gastan 1 cada uno.
 *   - Highlightly:      100 peticiones al DIA. El paso 3 gasta 1 por dia de
 *     partido consultado mas 1 por partido terminado pendiente, con un tope por
 *     pasada (`?maxRequests=`, 40 por defecto). Desglose en docs/EVENTOS.md.
 *
 * La llama un CRON, no una persona: por eso NO se protege con sesion de usuario
 * (D13 habla de Server Actions, aqui no hay ninguna sesion que comprobar) sino
 * con un secreto compartido en cabecera.
 *
 * Contrato de seguridad:
 *   - Sin `CRON_SECRET` configurado la ruta responde 503. NUNCA queda abierta:
 *     una ruta de escritura sin autenticar es una invitacion a que un tercero
 *     reescriba resultados y kickoffs.
 *   - La comparacion del secreto es de tiempo constante.
 *   - `GET` responde 405: que un navegador o un prefetch abra la URL no puede
 *     lanzar una sincronizacion.
 */

import { timingSafeEqual } from 'node:crypto'

import { revalidatePath } from 'next/cache'

import { isFootballDataConfigured, FootballDataError } from '@/lib/football-data/client'
import { syncMatches, type SyncReport } from '@/lib/football-data/ingest'
import { syncSquads, type SquadSyncReport } from '@/lib/football-data/squads'
import { syncMatchEvents, type EventsSyncReport } from '@/lib/highlightly/events'

// Necesita `node:crypto` y la service role key: nunca en edge. Es el valor por
// defecto, pero se declara para que quede escrito por que no puede ser otro.
// NO se exporta `dynamic`: un handler POST ya es dinamico, y en 16 esa opcion es
// legado del modelo de cache anterior (D5).
export const runtime = 'nodejs'

const CRON_SECRET = process.env.CRON_SECRET

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  // timingSafeEqual exige longitudes iguales; comparar longitudes antes filtra
  // sin dar informacion util (la longitud del secreto no es el secreto).
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * D5: solo `revalidatePath`. Sin esto una pasada que trae un gol deja la jornada
 * y las clasificaciones sirviendose cacheadas, y el cron parece no hacer nada.
 * Solo se invalida cuando la pasada ha escrito algo: una pasada en blanco (lo
 * normal fuera de horario de partidos) no tiene por que tirar la cache.
 */
function revalidateIfChanged(
  report: SyncReport,
  squads: SquadSyncReport | null,
  events: EventsSyncReport | null,
): void {
  const changed =
    report.gameweeksUpserted > 0 ||
    report.matchesUpserted > 0 ||
    report.resultsWritten > 0 ||
    // Las plantillas alimentan los chips del editor de pronostico: si entran
    // fichajes nuevos y no se invalida, la pena sigue viendo la lista vieja.
    (squads?.upserted ?? 0) > 0 ||
    // Un goleador nuevo cambia los puntos de todo el mundo: si no se invalida,
    // la clasificacion se sirve cacheada y el cron parece no hacer nada.
    (events?.written ?? 0) > 0
  if (!changed) return

  revalidatePath('/jornada')
  revalidatePath('/clasificacion')
  revalidatePath('/perfil')
  revalidatePath('/ajustes/admin')
}

/** Acepta `X-Cron-Secret: <secreto>` o `Authorization: Bearer <secreto>`. */
function readProvidedSecret(request: Request): string | null {
  const header = request.headers.get('x-cron-secret')
  if (header) return header
  const auth = request.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  return null
}

export async function POST(request: Request) {
  if (!CRON_SECRET) {
    return Response.json(
      {
        ok: false,
        error:
          'CRON_SECRET no esta configurado. La ruta de sincronizacion escribe en matches y ' +
          'gameweeks, asi que se queda cerrada hasta que exista el secreto. Anadelo a ' +
          '.env.local (o a las variables del hosting) y vuelve a desplegar.',
      },
      { status: 503 },
    )
  }

  const provided = readProvidedSecret(request)
  if (!provided || !secretMatches(provided, CRON_SECRET)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  if (!isFootballDataConfigured) {
    return Response.json(
      {
        ok: false,
        error:
          'FOOTBALL_DATA_TOKEN no esta configurado. La app sigue funcionando con el calendario ' +
          'de src/lib/laliga.ts; solo la ingesta esta parada.',
      },
      { status: 503 },
    )
  }

  // Parametros opcionales por query string, para poder refrescar una sola jornada
  // desde el movil sin gastar la cuota en las 38.
  const url = new URL(request.url)
  const rawMatchday = url.searchParams.get('matchday')
  const matchday = rawMatchday === null ? undefined : Number(rawMatchday)
  if (matchday !== undefined && (!Number.isInteger(matchday) || matchday < 1 || matchday > 38)) {
    return Response.json({ ok: false, error: 'matchday debe ser un entero entre 1 y 38' }, { status: 400 })
  }

  const allowSeasonMismatch = url.searchParams.get('allowSeasonMismatch') === '1'
  // Las plantillas se mueven dos veces al ano (los dos mercados) y los marcadores
  // cada diez minutos: en las pasadas de dia de partido se pide `?squads=0` y la
  // ingesta gasta 1 peticion en vez de 2.
  const withSquads = url.searchParams.get('squads') !== '0'
  // Goleadores y asistencias. Se puede apagar con `?events=0` para una pasada que
  // solo quiera refrescar horarios sin tocar la cuota diaria de Highlightly.
  const withEvents = url.searchParams.get('events') !== '0'

  // Tope de peticiones a Highlightly de ESTA pasada. La cuota es de 100 al DIA y
  // la comparten todas las pasadas, asi que una sola no puede comersela entera.
  const rawMaxRequests = url.searchParams.get('maxRequests')
  const maxRequests = rawMaxRequests === null ? undefined : Number(rawMaxRequests)
  if (maxRequests !== undefined && (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 100)) {
    return Response.json(
      { ok: false, error: 'maxRequests debe ser un entero entre 1 y 100 (la cuota diaria de Highlightly).' },
      { status: 400 },
    )
  }

  try {
    const report = await syncMatches({ matchday, allowSeasonMismatch })

    // Segunda peticion (la cuota es de 10/minuto, van 2). `syncSquads` NUNCA
    // lanza: si la API o la tabla fallan, el fallo viaja dentro de `squads` y la
    // sincronizacion de partidos, que es la imprescindible, se da por buena.
    const squads = withSquads
      ? await syncSquads({ leagueId: report.leagueId, allowSeasonMismatch })
      : null

    // Tercer paso, OTRO proveedor y OTRA cuota (100/dia). Va DESPUES de los
    // marcadores a proposito: para saber que partidos estan jugados y con que
    // resultado hay que haberlos escrito antes; el marcador es lo que cuadra los
    // goleadores. `syncMatchEvents` tampoco lanza nunca: si falta la clave o la
    // API se cae, el aviso viaja dentro de `events` con `skipped: true`.
    const events = withEvents ? await syncMatchEvents({ leagueId: report.leagueId, maxRequests }) : null

    revalidateIfChanged(report, squads, events)
    return Response.json({ ...report, squads, events }, { status: 200 })
  } catch (error) {
    if (error instanceof FootballDataError) {
      // 429 y 5xx son transitorios: se devuelve 503 para que el cron reintente,
      // no 500, que en muchos servicios de cron cuenta como fallo definitivo.
      return Response.json(
        { ok: false, error: error.message, retryable: error.retryable, rateLimit: error.rateLimit },
        { status: error.retryable ? 503 : 502 },
      )
    }
    const message = error instanceof Error ? error.message : String(error)
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function GET() {
  return Response.json(
    { ok: false, error: 'Usa POST con la cabecera X-Cron-Secret.' },
    { status: 405, headers: { Allow: 'POST' } },
  )
}
