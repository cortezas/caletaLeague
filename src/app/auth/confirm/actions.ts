'use server'

import type { EmailOtpType } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'

import { createClient, isSupabaseConfigured } from '@/lib/supabase/server'

const DEFAULT_NEXT = '/jornada'

/** Tipos de OTP por correo que este proyecto acepta. */
const ALLOWED_TYPES = new Set<string>([
  'email',
  'magiclink',
  'signup',
  'invite',
  'recovery',
  'email_change',
])

/**
 * Guarda anti open-redirect. `next` viene de la URL del correo, o sea de fuera:
 * solo se admiten rutas internas. Se exige que empiece por UNA sola barra, lo
 * que descarta `//evil.com`, `/\evil.com`, `https://evil.com` y `javascript:`
 * sin necesidad de conocer el origen.
 */
function safeNext(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_NEXT
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return DEFAULT_NEXT
  return raw
}

/**
 * Canjea el enlace magico. **Solo se llega aqui pulsando el boton (POST).**
 *
 * POR QUE NO SE HACE AL ABRIR LA URL
 * Un `token_hash` es de UN SOLO USO. Mientras el canje vivia en el GET de
 * `/auth/confirm`, cualquier cosa que visitara la URL lo quemaba: WhatsApp y
 * Telegram la abren para sacar la vista previa, los antivirus de correo la
 * escanean, y algunos clientes precargan enlaces. Medido en produccion el
 * 14/08/2026: un enlace generado a las 09:20:15 constaba usado a las 09:20:15,
 * antes de que su destinatario lo tuviera. Al pinchar veia "enlace caducado".
 * Los robots no envian formularios.
 *
 * SE PASA DIRECTAMENTE A `<form action={...}>` DESDE UN SERVER COMPONENT, y no
 * por `useActionState`: asi Next genera un POST de verdad y el formulario
 * funciona AUNQUE NO HAYA JAVASCRIPT. Con `useActionState` el atributo `action`
 * queda en `javascript:throw...` y entrar en la app pasaria a depender de que
 * hidrate el cliente. Es el camino mas critico que hay: no puede depender de eso.
 *
 * Por lo mismo los errores van por `redirect` a `/auth/error` en vez de
 * devolverse como estado: sin JS no hay donde pintar un estado.
 */
export async function confirmAction(formData: FormData): Promise<never> {
  if (!isSupabaseConfigured) redirect('/auth/error?reason=config')

  const tokenHash = formData.get('token_hash')
  const type = formData.get('type')
  if (typeof tokenHash !== 'string' || tokenHash === '') redirect('/auth/error?reason=invalid')
  if (typeof type !== 'string' || !ALLOWED_TYPES.has(type)) redirect('/auth/error?reason=invalid')

  const supabase = await createClient()
  let { error } = await supabase.auth.verifyOtp({
    type: type as EmailOtpType,
    token_hash: tokenHash as string,
  })

  // Reintento con 'email' cuando venia 'magiclink'.
  //
  // El Supabase de la nube RECHAZA type=magiclink para un token_hash y solo
  // acepta type=email; el de Docker acepta los dos. Comprobado contra el
  // proyecto real, tres de tres: magiclink -> 403 otp_expired, email -> 200.
  // La plantilla de correo ya manda type=email y por ahi todo el mundo entro
  // bien, pero hay enlaces hechos a mano con type=magiclink circulando por
  // WhatsApp. Sin esto son papel mojado y hay que reemitirlos uno a uno.
  if (error && type === 'magiclink') {
    ;({ error } = await supabase.auth.verifyOtp({
      type: 'email',
      token_hash: tokenHash as string,
    }))
  }

  if (error) redirect('/auth/error?reason=expired')

  // Ruta RELATIVA a proposito: el navegador la resuelve contra el host por el
  // que se entro, asi que la cookie de sesion que acaba de escribir
  // `createClient` nunca se queda huerfana. Con una URL absoluta habria que
  // adivinar el host, y en desarrollo se saltaba de 127.0.0.1 a localhost, que
  // para las cookies son dos sitios distintos.
  redirect(safeNext(formData.get('next')))
}
