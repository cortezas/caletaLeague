'use server'

/**
 * Entrar con el codigo personal.
 *
 * La persona escribe SOLO su codigo -- ni correo ni nada mas -- y entra. Esto
 * existe porque los enlaces magicos los tiene que emitir el organizador a mano:
 * Resend todavia envia desde una direccion de pruebas que solo entrega al dueno
 * de la cuenta, asi que el boton "enviarme el enlace" no le sirve a nadie de la
 * peña.
 *
 * COMO FUNCIONA. El codigo ES la contrasena de Supabase del usuario (migracion
 * 0028). Aqui se busca de quien es y se llama a `signInWithPassword` con el
 * cliente SSR, que es el que escribe las cookies como toca. No hay ningun
 * mecanismo de sesion inventado: es el camino soportado de punta a punta.
 *
 * SIN JAVASCRIPT TAMBIEN. La accion se pasa directa a `<form action={...}>`
 * desde un Server Component, igual que en /auth/confirm, asi que Next genera un
 * POST de verdad. Por eso los errores viajan en la URL y no como estado: sin JS
 * no hay donde pintar un estado. Y por eso no se usa `useActionState`, que
 * obligaria a convertir la pagina en Client Component.
 */

import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'

import { looksLikeAccessCode, normalizeAccessCode } from '@/lib/access-code'
import { createClient, isSupabaseConfigured } from '@/lib/supabase/server'

/** A donde va uno al entrar. Relativa a proposito: ver `safeNext` en /auth/confirm. */
const DESTINO = '/jornada'

/** El login con `?error=codigo` pinta el aviso. */
const FALLO = '/login?error=codigo'

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createAdminClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function enterWithCodeAction(formData: FormData): Promise<never> {
  const escrito = String(formData.get('code') ?? '')
  const code = normalizeAccessCode(escrito)

  // El prefijo, nunca el codigo entero: un intento fallido de uno es casi el
  // codigo bueno de otro si se equivoco en una letra.
  const prefijo = code.slice(0, 3)

  if (!isSupabaseConfigured || !looksLikeAccessCode(code)) redirect(FALLO)

  const admin = adminClient()
  if (!admin) redirect(FALLO)

  const { data: duenos, error: buscaError } = await admin.rpc('codigo_de_miembro', {
    p_code: code,
  })
  const dueno = (duenos as Array<{ member_id: string; user_id: string }> | null)?.[0] ?? null

  if (buscaError || !dueno) {
    await admin.rpc('anotar_intento', { p_prefix: prefijo, p_ok: false, p_member_id: null })
    redirect(FALLO)
  }

  // El correo no lo guardamos por duplicado: se pregunta por el user_id, que es
  // la unica fuente de verdad. Si el usuario cambia de correo, esto sigue bien.
  const { data: cuenta, error: cuentaError } = await admin.auth.admin.getUserById(dueno.user_id)
  const email = cuenta?.user?.email
  if (cuentaError || !email) {
    await admin.rpc('anotar_intento', {
      p_prefix: prefijo,
      p_ok: false,
      p_member_id: dueno.member_id,
    })
    redirect(FALLO)
  }

  // El cliente SSR, no el admin: es el que escribe las cookies de sesion.
  const supabase = await createClient()
  const { error: entraError } = await supabase.auth.signInWithPassword({
    email,
    password: code,
  })

  await admin.rpc('anotar_intento', {
    p_prefix: prefijo,
    p_ok: !entraError,
    p_member_id: dueno.member_id,
  })

  // El codigo estaba en nuestra tabla pero Supabase no lo acepta como
  // contrasena: alguien la ha cambiado por otro sitio. Se manda al login con el
  // mismo aviso, que para quien entra es el mismo problema.
  if (entraError) redirect(FALLO)

  redirect(DESTINO)
}
