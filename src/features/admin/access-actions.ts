'use server'

import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireAdmin } from '@/lib/auth'
import { isSupabaseConfigured } from '@/lib/supabase/server'

/**
 * Enlaces de acceso emitidos por el organizador.
 *
 * POR QUE ESTA PANTALLA EXISTE
 * Resend sigue enviando desde `onboarding@resend.dev`, el remitente de pruebas,
 * que SOLO entrega correo al dueño de la cuenta. O sea que el boton "pedir otro
 * enlace" del login no le sirve a nadie mas: quien se queda fuera, se queda
 * fuera hasta que alguien le pase un enlace a mano.
 *
 * El fin de semana del 15-17/08/2026 eso dejo a gente sin poder entrar en todo
 * el finde. Hasta que haya un dominio verificado en Resend, el organizador tiene
 * que poder emitir el enlace el mismo, sin depender de mi.
 */

export type InviteState = {
  ok: boolean
  error: string | null
  /** El enlace reciEn emitido. Se enseña una vez y no se guarda en ningun sitio. */
  link: string | null
  email: string | null
}

export const NO_INVITE: InviteState = { ok: false, error: null, link: null, email: null }

const DENIED = 'No tienes permiso para esto.'

/** Igual de estricto que el `type="email"` del formulario, pero en servidor. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * Cliente con service role. La API de administracion de Supabase (`generate_link`)
 * no admite otra cosa, y por eso esta accion comprueba `requireAdmin()` ANTES de
 * tocarla: una Server Action es un POST a la ruta y el proxy no basta (D13).
 */
function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('falta configuracion')
  return createAdminClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

/**
 * Emite un enlace de acceso para un correo.
 *
 * `type: 'magiclink'` es lo que se le pide a Supabase, pero el enlace que se
 * construye lleva `type=email`: el GoTrue de la nube RECHAZA `magiclink` para un
 * `token_hash` y solo acepta `email` (comprobado, tres de tres). Es el mismo
 * valor que usa la plantilla de correo.
 *
 * Se apunta a `/auth/confirm`, no al `action_link` que devuelve Supabase: ese
 * pasa por `/auth/v1/verify` con PKCE, y el verificador vive en el navegador que
 * pidio el enlace. En el movil el correo se abre en otro sitio y falla justo en
 * el caso mas comun.
 */
export async function createInviteLinkAction(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  try {
    await requireAdmin()
  } catch {
    return { ...NO_INVITE, error: DENIED }
  }

  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) {
    return { ...NO_INVITE, error: 'Ese correo no tiene buena pinta.' }
  }

  if (!isSupabaseConfigured) {
    return { ...NO_INVITE, error: 'No hay proyecto de Supabase configurado.' }
  }

  let token: string | undefined
  try {
    const { data, error } = await admin().auth.admin.generateLink({ type: 'magiclink', email })
    if (error) {
      // El limite de emision es por hora y por proyecto: merece un mensaje
      // propio, porque no se arregla reintentando en el momento.
      const message = /rate|limit/i.test(error.message)
        ? 'Has emitido demasiados enlaces en poco rato. Espera un poco.'
        : 'No hemos podido generar el enlace.'
      return { ...NO_INVITE, error: message }
    }
    token = data.properties?.hashed_token
  } catch {
    return { ...NO_INVITE, error: 'No hemos podido generar el enlace.' }
  }

  if (!token) return { ...NO_INVITE, error: 'No hemos podido generar el enlace.' }

  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://caleta-league.vercel.app').replace(/\/+$/, '')
  const link = `${origin}/auth/confirm?token_hash=${token}&type=email&next=/jornada`

  return { ok: true, error: null, link, email }
}
