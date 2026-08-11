/**
 * `POST /api/push/dispatch` - avisa a quien no haya pronosticado un partido que
 * cierra dentro de una hora. La llama un CRON, no una persona.
 *
 * Contrato de seguridad, calcado del de `/api/sync`:
 *   - Sin `CRON_SECRET` responde 503 y NO queda abierta. Una ruta que manda
 *     notificaciones a los moviles de doce personas no puede estar sin
 *     autenticar: seria un altavoz gratis para cualquiera que encuentre la URL.
 *   - Comparacion del secreto en tiempo constante.
 *   - `GET` responde 405: un prefetch del navegador no puede disparar avisos.
 *
 * Por que aqui SI se usa la service role key: el cron no tiene sesion, y por
 * diseño (0003) nadie puede leer los pronosticos de otro antes del pitido
 * inicial. Saber "quien NO ha pronosticado" es exactamente esa informacion. Es
 * la misma excepcion que ya se documento para la ingesta: codigo de cron, nunca
 * codigo de usuario.
 *
 * Idempotencia: `public.push_reminders_sent` tiene clave primaria
 * (match_id, member_id) y el aviso solo se manda por las filas que el INSERT
 * consigue crear. Ejecutar esta ruta dos veces seguidas manda cero avisos la
 * segunda vez.
 */

import { timingSafeEqual } from 'node:crypto'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { TEAMS } from '@/lib/laliga'
import { sendPushToMany, type PushPayload, type PushSubscriptionRecord } from '@/lib/push/send'
import { isPushConfigured, pushConfigError } from '@/lib/push/vapid'

// `node:crypto`, `web-push` y la service role key. Nunca edge.
export const runtime = 'nodejs'

const CRON_SECRET = process.env.CRON_SECRET

const DEFAULT_MINUTES = 60

// ---------------------------------------------------------------------------
// Secreto compartido
// ---------------------------------------------------------------------------

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function readProvidedSecret(request: Request): string | null {
  const header = request.headers.get('x-cron-secret')
  if (header) return header
  const auth = request.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  return null
}

// ---------------------------------------------------------------------------
// Cliente con service role
// ---------------------------------------------------------------------------

function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. El cron necesita la service ' +
        'role key para saber quien no ha pronosticado: RLS oculta esa informacion a proposito.',
    )
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

// ---------------------------------------------------------------------------
// Texto del aviso
// ---------------------------------------------------------------------------

/**
 * D17 exige Europe/Madrid fijo en todo formateo. `src/lib/format.ts` solo
 * expone `formatKickoff`, que devuelve 'Sáb 15 · 19:30'; para un aviso de
 * "cierra dentro de un rato" sobra la fecha y hace falta solo la hora, asi que
 * se construye aqui el formateador con las MISMAS constantes.
 */
const timeFmt = new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** Nombre corto del equipo. Si el codigo no esta en `laliga.ts`, se enseña el codigo. */
function teamName(code: string): string {
  const teams = TEAMS as Record<string, { name: string } | undefined>
  return teams[code]?.name ?? code
}

/** 'Alavés–Getafe'. Guion largo U+2013, como en el resto de la interfaz. */
function matchLabel(homeCode: string, awayCode: string): string {
  return `${teamName(homeCode)}–${teamName(awayCode)}`
}

interface TargetRow {
  match_id: string
  member_id: string
  league_id: string
  gameweek_number: number
  home_code: string
  away_code: string
  kickoff_at: string
  kickoff_provisional: boolean
  endpoint: string
  p256dh: string
  auth: string
}

interface PendingMatch {
  matchId: string
  gameweekNumber: number
  homeCode: string
  awayCode: string
  kickoffAt: string
  provisional: boolean
}

function buildPayload(matches: PendingMatch[]): PushPayload {
  // El RPC ya viene ordenado por kickoff, pero el agrupado en JS no garantiza
  // el orden si algun dia cambia la consulta: se reordena aqui y punto.
  const sorted = [...matches].sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt))
  const first = sorted[0]
  const time = timeFmt.format(new Date(first.kickoffAt))
  const anyProvisional = sorted.some((match) => match.provisional)
  // Solo se nombra la jornada si todos los partidos son de la misma. En el
  // salto de jornada puede haber dos, y poner una sola seria mentir.
  const sameGameweek = sorted.every((match) => match.gameweekNumber === first.gameweekNumber)
  const gameweekPrefix = sameGameweek ? `Jornada ${first.gameweekNumber} · ` : ''
  const provisionalSuffix = anyProvisional ? ' Hora provisional.' : ''

  if (sorted.length === 1) {
    return {
      title: `${matchLabel(first.homeCode, first.awayCode)} cierra a las ${time}`,
      body: `${gameweekPrefix}aún no has pronosticado.${provisionalSuffix}`,
      url: `/jornada/${first.matchId}`,
      tag: 'cierre-jornada',
    }
  }

  return {
    title: `Te faltan ${sorted.length} pronósticos`,
    body: `${gameweekPrefix}el primero cierra a las ${time} (${matchLabel(first.homeCode, first.awayCode)}).${provisionalSuffix}`,
    url: '/jornada',
    tag: 'cierre-jornada',
  }
}

// ---------------------------------------------------------------------------
// Informe
// ---------------------------------------------------------------------------

interface DispatchReport {
  ok: boolean
  minutes: number
  dryRun: boolean
  /** Pares (partido, miembro) sin pronostico dentro del horizonte. */
  targets: number
  /** Los que este pase ha reclamado; el resto ya se habian avisado. */
  claimed: number
  membersNotified: number
  notificationsSent: number
  /** Suscripciones borradas por 404/410 del servicio de push. */
  subscriptionsRemoved: number
  failures: Array<{ endpoint: string; statusCode: number | null; error: string | null }>
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  if (!CRON_SECRET) {
    return Response.json(
      {
        ok: false,
        error:
          'CRON_SECRET no esta configurado. Esta ruta manda notificaciones a los moviles de la ' +
          'peña, asi que se queda cerrada hasta que exista el secreto. Anadelo a .env.local (o a ' +
          'las variables del hosting) y vuelve a desplegar.',
      },
      { status: 503 },
    )
  }

  const provided = readProvidedSecret(request)
  if (!provided || !secretMatches(provided, CRON_SECRET)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  if (!isPushConfigured) {
    return Response.json(
      {
        ok: false,
        error:
          pushConfigError ??
          'Los avisos no estan configurados. Ver docs/AVISOS.md para generar las claves VAPID.',
      },
      { status: 503 },
    )
  }

  const url = new URL(request.url)
  const rawMinutes = url.searchParams.get('minutes')
  const minutes = rawMinutes === null ? DEFAULT_MINUTES : Number(rawMinutes)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    return Response.json(
      { ok: false, error: 'minutes debe ser un entero entre 1 y 1440' },
      { status: 400 },
    )
  }
  // Para poder comprobar a quien se avisaria sin despertar doce moviles.
  const dryRun = url.searchParams.get('dryRun') === '1'

  let admin: SupabaseClient
  try {
    admin = createAdminClient()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return Response.json({ ok: false, error: message }, { status: 503 })
  }

  const { data, error } = await admin.rpc('push_reminder_targets', { p_minutes: minutes })
  if (error) {
    return Response.json(
      { ok: false, error: `push_reminder_targets fallo: ${error.message}` },
      { status: 500 },
    )
  }

  const targets = (data ?? []) as TargetRow[]

  const report: DispatchReport = {
    ok: true,
    minutes,
    dryRun,
    targets: targets.length,
    claimed: 0,
    membersNotified: 0,
    notificationsSent: 0,
    subscriptionsRemoved: 0,
    failures: [],
  }

  if (targets.length === 0) return Response.json(report, { status: 200 })

  // --- Agrupado por miembro -------------------------------------------------
  // Cada fila es (partido x suscripcion), asi que un mismo partido aparece
  // tantas veces como navegadores tenga esa persona. Se deduplica por las dos
  // vias antes de tocar nada.
  const matchesByMember = new Map<string, Map<string, PendingMatch>>()
  const subsByMember = new Map<string, Map<string, PushSubscriptionRecord>>()

  for (const row of targets) {
    let matches = matchesByMember.get(row.member_id)
    if (!matches) {
      matches = new Map()
      matchesByMember.set(row.member_id, matches)
    }
    matches.set(row.match_id, {
      matchId: row.match_id,
      gameweekNumber: row.gameweek_number,
      homeCode: row.home_code,
      awayCode: row.away_code,
      kickoffAt: row.kickoff_at,
      provisional: row.kickoff_provisional,
    })

    let subs = subsByMember.get(row.member_id)
    if (!subs) {
      subs = new Map()
      subsByMember.set(row.member_id, subs)
    }
    subs.set(row.endpoint, { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth })
  }

  if (dryRun) {
    // Sin reclamar ni enviar: solo se informa de a cuantos se avisaria si la
    // tabla de acuses estuviera vacia.
    report.claimed = targets.length
    report.membersNotified = matchesByMember.size
    return Response.json(report, { status: 200 })
  }

  // --- Reclamo: quien no habia sido avisado ya ------------------------------
  // `ignoreDuplicates` traduce a `ON CONFLICT DO NOTHING`, y con `.select()`
  // PostgREST devuelve UNICAMENTE las filas realmente insertadas. Ese es el
  // candado contra los avisos repetidos: es la base quien decide, no un
  // temporizador en JavaScript.
  const claimRows: Array<{ match_id: string; member_id: string }> = []
  for (const [memberId, matches] of matchesByMember) {
    for (const matchId of matches.keys()) claimRows.push({ match_id: matchId, member_id: memberId })
  }

  const { data: claimed, error: claimError } = await admin
    .from('push_reminders_sent')
    .upsert(claimRows, { onConflict: 'match_id,member_id', ignoreDuplicates: true })
    .select('match_id, member_id')

  if (claimError) {
    return Response.json(
      { ok: false, error: `no se pudo registrar el acuse: ${claimError.message}` },
      { status: 500 },
    )
  }

  const claimedRows = (claimed ?? []) as Array<{ match_id: string; member_id: string }>
  report.claimed = claimedRows.length
  if (claimedRows.length === 0) return Response.json(report, { status: 200 })

  const claimedByMember = new Map<string, PendingMatch[]>()
  for (const row of claimedRows) {
    const match = matchesByMember.get(row.member_id)?.get(row.match_id)
    if (!match) continue
    const list = claimedByMember.get(row.member_id)
    if (list) list.push(match)
    else claimedByMember.set(row.member_id, [match])
  }

  // --- Envio ----------------------------------------------------------------
  const goneEndpoints = new Set<string>()
  const releaseClaims: Array<{ match_id: string; member_id: string }> = []
  const now = Date.now()

  for (const [memberId, matches] of claimedByMember) {
    const subs = [...(subsByMember.get(memberId)?.values() ?? [])]
    if (subs.length === 0) continue

    const payload = buildPayload(matches)
    // El aviso caduca con el pitido inicial: si el movil esta apagado hasta
    // mañana, que el servicio de push lo tire en vez de entregarlo tarde.
    const earliest = Math.min(...matches.map((match) => new Date(match.kickoffAt).getTime()))
    const ttlSeconds = Math.max(60, Math.round((earliest - now) / 1000))

    const results = await sendPushToMany(subs, payload, { ttlSeconds })

    let delivered = 0
    let retryableFailures = 0
    for (const result of results) {
      if (result.outcome === 'sent') delivered += 1
      else if (result.outcome === 'gone') goneEndpoints.add(result.endpoint)
      else {
        if (result.retryable) retryableFailures += 1
        report.failures.push({
          endpoint: result.endpoint,
          statusCode: result.statusCode,
          error: result.error,
        })
      }
    }

    report.notificationsSent += delivered
    if (delivered > 0) report.membersNotified += 1

    // Nada llego y el fallo era transitorio (red caida, 503 del servicio): se
    // suelta el acuse para que la siguiente pasada lo reintente. Si el fallo NO
    // era transitorio el acuse se mantiene: reintentar un 400 cada 15 minutos
    // hasta el partido no arregla nada y quema cuota.
    if (delivered === 0 && retryableFailures > 0) {
      for (const match of matches) releaseClaims.push({ match_id: match.matchId, member_id: memberId })
    }
  }

  // --- Limpieza -------------------------------------------------------------
  if (goneEndpoints.size > 0) {
    const { data: removed, error: removeError } = await admin
      .from('push_subscriptions')
      .delete()
      .in('endpoint', [...goneEndpoints])
      .select('id')
    if (!removeError) report.subscriptionsRemoved = removed?.length ?? 0
  }

  for (const claim of releaseClaims) {
    await admin
      .from('push_reminders_sent')
      .delete()
      .eq('match_id', claim.match_id)
      .eq('member_id', claim.member_id)
  }

  return Response.json(report, { status: 200 })
}

export async function GET() {
  return Response.json(
    { ok: false, error: 'Usa POST con la cabecera X-Cron-Secret.' },
    { status: 405, headers: { Allow: 'POST' } },
  )
}
