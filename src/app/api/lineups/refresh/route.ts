/**
 * Pide la alineacion de un partido BAJO DEMANDA, cuando alguien abre su pantalla.
 *
 * POR QUE EXISTE, SI YA LA PIDE EL CRON
 * El cron de GitHub Actions esta programado cada 15 minutos, pero no cumple:
 * medido sobre 58 pasadas del 11 al 13 de agosto de 2026, disparo una cada 42
 * minutos de media, con un maximo de 156. En la ventana de 90 minutos previa al
 * partido eso deja 2 o 3 intentos, y un hueco malo se la salta entera. La peña
 * abre el partido a las 19:00, la alineacion salio a las 18:40, y no se ve.
 *
 * Esto lo cierra: quien abre el partido dispara la peticion. El cron sigue como
 * primera linea, y esto es la red.
 *
 * EL FRENO ES LO IMPORTANTE
 * Doce personas abriendo el mismo partido no pueden ser doce peticiones: el plan
 * gratuito de Highlightly son 100 AL DIA. `lineup_fetch_attempts` (migracion
 * 0014) guarda cuando se intento por ultima vez cada partido; dentro de la
 * ventana de gracia esta ruta responde sin salir a la red.
 *
 * NO es una ruta de cron: la llama un usuario con sesion, asi que se comprueba
 * que sea miembro de la peña. Sin eso, cualquiera con la URL podria gastar la
 * cuota del dia.
 */

import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'

import { syncLineups } from '@/lib/highlightly/lineups'
import { createClient, isSupabaseConfigured } from '@/lib/supabase/server'

/** Minutos entre dos peticiones reales para el mismo partido. */
const THROTTLE_MINUTES = 4

/**
 * Solo se pide para partidos que arrancan dentro de esta ventana. Mas ancha que
 * la del cron (90) porque aqui hay alguien mirando la pantalla: si abre el
 * partido dos horas antes y la alineacion ya esta, mejor enseñarsela.
 */
const WINDOW_MINUTES = 150

/** Tope de intentos fallidos por partido. Pasado eso, no se insiste mas. */
const MAX_ATTEMPTS = 25

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createAdminClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, reason: 'sin-backend' }, { status: 503 })
  }

  // ---- Quien llama tiene que ser de la peña -------------------------------
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub
  if (typeof userId !== 'string' || userId === '') {
    return NextResponse.json({ ok: false, reason: 'sin-sesion' }, { status: 401 })
  }

  const { matchId } = (await request.json().catch(() => ({}))) as { matchId?: unknown }
  if (typeof matchId !== 'string' || matchId === '') {
    return NextResponse.json({ ok: false, reason: 'falta-partido' }, { status: 400 })
  }

  // El partido se lee con el cliente del USUARIO: si no es de su liga, RLS lo
  // deja fuera y aqui llega null. No hace falta comprobar la pertenencia aparte.
  const { data: match } = await supabase
    .from('matches')
    .select('id, kickoff_at')
    .eq('id', matchId)
    .maybeSingle()

  if (!match) {
    return NextResponse.json({ ok: false, reason: 'partido-no-visible' }, { status: 404 })
  }

  // ---- Solo tiene sentido en la ventana previa ----------------------------
  const kickoff = Date.parse(String(match.kickoff_at))
  const minutesToKickoff = (kickoff - Date.now()) / 60000
  if (!Number.isFinite(minutesToKickoff) || minutesToKickoff > WINDOW_MINUTES) {
    return NextResponse.json({ ok: true, fetched: false, reason: 'aun-lejos' })
  }
  if (minutesToKickoff < -15) {
    // Ya empezo: la alineacion ya no cambia nada del pronostico, que esta sellado.
    return NextResponse.json({ ok: true, fetched: false, reason: 'ya-empezado' })
  }

  const db = admin()
  if (!db) {
    return NextResponse.json({ ok: false, reason: 'sin-service-role' }, { status: 503 })
  }

  // ---- Ya la tenemos? -----------------------------------------------------
  const { data: existing } = await db
    .from('match_lineups')
    .select('match_id')
    .eq('match_id', matchId)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ ok: true, fetched: false, reason: 'ya-guardada' })
  }

  // ---- El freno -----------------------------------------------------------
  const { data: attempt } = await db
    .from('lineup_fetch_attempts')
    .select('attempted_at, attempts')
    .eq('match_id', matchId)
    .maybeSingle()

  if (attempt) {
    const since = (Date.now() - Date.parse(String(attempt.attempted_at))) / 60000
    if (since < THROTTLE_MINUTES) {
      return NextResponse.json({ ok: true, fetched: false, reason: 'frenado' })
    }
    if (Number(attempt.attempts) >= MAX_ATTEMPTS) {
      return NextResponse.json({ ok: true, fetched: false, reason: 'demasiados-intentos' })
    }
  }

  // Se registra ANTES de salir a la red: si dos peticiones entran a la vez, la
  // segunda ve el intento de la primera y se frena. Perder un intento es
  // barato; gastar cuota por duplicado, no.
  await db.from('lineup_fetch_attempts').upsert(
    {
      match_id: matchId,
      attempted_at: new Date().toISOString(),
      attempts: (Number(attempt?.attempts) || 0) + 1,
    },
    { onConflict: 'match_id' },
  )

  // Se reutiliza el mismo paso que usa el cron. Barre la ventana entera, asi que
  // de paso deja listos los partidos vecinos con la misma peticion de listado.
  const report = await syncLineups({ windowMinutes: WINDOW_MINUTES, maxRequests: 3 })

  return NextResponse.json({
    ok: report.ok,
    fetched: (report.saved ?? 0) > 0,
    saved: report.saved ?? 0,
    requestsSpent: report.requestsSpent ?? 0,
  })
}
