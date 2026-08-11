/**
 * Aterrizaje del magic link.
 *
 * D10: se verifica con `token_hash` + `verifyOtp`, NUNCA con
 * `exchangeCodeForSession`. Con PKCE el `code_verifier` vive en el navegador
 * que pidio el enlace; en el movil el correo se abre en otro navegador (o en el
 * webview de Gmail) y el intercambio fallaria siempre.
 *
 * La plantilla del correo en el dashboard de Supabase tiene que apuntar a:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}
 */

import type { EmailOtpType } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'

import { createClient, isSupabaseConfigured } from '@/lib/supabase/server'

const DEFAULT_NEXT = '/jornada'

/**
 * Origen REAL de la peticion, sacado de las cabeceras y no de `nextUrl.origin`.
 *
 * Por que importa: las cookies de sesion se guardan para el HOST por el que se
 * entro. `nextUrl.origin` devuelve el origen con el que arranco el servidor
 * (`localhost` en desarrollo), no por donde llego la peticion. Si el enlace del
 * correo apunta a `127.0.0.1` y esta redireccion manda a `localhost`, la cookie
 * recien creada se queda huerfana y el usuario vuelve al login: bucle infinito.
 * Para las cookies, `127.0.0.1` y `localhost` son dos sitios distintos aunque
 * sean la misma maquina.
 *
 * En produccion pasa lo mismo detras del proxy de Vercel, de ahi el
 * `x-forwarded-host`.
 */
function requestOrigin(request: NextRequest): string {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (!host) return request.nextUrl.origin
  const proto =
    request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '')
  return `${proto}://${host}`
}

/** Tipos de OTP por correo que este proyecto acepta. */
const ALLOWED_TYPES = new Set<string>(['email', 'magiclink', 'signup', 'invite', 'recovery', 'email_change'])

/**
 * Guarda anti open-redirect. `next` llega de la URL del correo, o sea de fuera:
 * solo se admiten rutas internas. `new URL(raw, origin)` resuelve '//evil.com',
 * '/\\evil.com', 'https://evil.com' y 'javascript:' a un origen distinto, que es
 * exactamente lo que se descarta.
 */
function safeNext(raw: string | null, origin: string): string {
  if (!raw || !raw.startsWith('/')) return DEFAULT_NEXT
  try {
    const candidate = new URL(raw, origin)
    if (candidate.origin !== origin) return DEFAULT_NEXT
    return `${candidate.pathname}${candidate.search}${candidate.hash}`
  } catch {
    return DEFAULT_NEXT
  }
}

function errorRedirect(request: NextRequest, reason: 'invalid' | 'expired' | 'config') {
  return NextResponse.redirect(new URL(`/auth/error?reason=${reason}`, requestOrigin(request)))
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const origin = requestOrigin(request)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const next = safeNext(searchParams.get('next'), origin)

  // Fase A del plan: sin proyecto Supabase no hay nada que verificar.
  if (!isSupabaseConfigured) return errorRedirect(request, 'config')

  if (!tokenHash || !type || !ALLOWED_TYPES.has(type)) {
    return errorRedirect(request, 'invalid')
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({
    type: type as EmailOtpType,
    token_hash: tokenHash,
  })

  if (error) return errorRedirect(request, 'expired')

  // Las cookies de sesion las ha escrito `createClient` sobre el cookie store
  // de la request; Next las vuelca en esta respuesta al devolverla. El destino
  // se construye sobre `origin` (el host real) para no dejarlas huerfanas.
  return NextResponse.redirect(new URL(next, origin))
}
