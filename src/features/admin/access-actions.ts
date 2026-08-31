'use server'

import { createClient as createAdminClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'

import { generateAccessCode } from '@/lib/access-code'
import { requireAdmin } from '@/lib/auth'
import { createClient, isSupabaseConfigured } from '@/lib/supabase/server'

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

/**
 * OJO: de un fichero 'use server' SOLO pueden salir funciones async. Exportar
 * aqui el estado inicial como constante rompe la pagina entera al cargarla, con
 * un error que ni siquiera menciona este fichero. Vive en el componente.
 */
export type InviteState = {
  ok: boolean
  error: string | null
  /** El enlace reciEn emitido. Se enseña una vez y no se guarda en ningun sitio. */
  link: string | null
  email: string | null
}

/** Estado vacio para componer las respuestas. NO se exporta: ver la nota de arriba. */
const NADA: InviteState = { ok: false, error: null, link: null, email: null }

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
    return { ...NADA, error: DENIED }
  }

  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) {
    return { ...NADA, error: 'Ese correo no tiene buena pinta.' }
  }

  if (!isSupabaseConfigured) {
    return { ...NADA, error: 'No hay proyecto de Supabase configurado.' }
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
      return { ...NADA, error: message }
    }
    token = data.properties?.hashed_token
  } catch {
    return { ...NADA, error: 'No hemos podido generar el enlace.' }
  }

  if (!token) return { ...NADA, error: 'No hemos podido generar el enlace.' }

  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://caleta-league.vercel.app').replace(/\/+$/, '')
  const link = `${origin}/auth/confirm?token_hash=${token}&type=email&next=/jornada`

  return { ok: true, error: null, link, email }
}

/* ------------------------------------------------------------------ *
 * Echar a alguien de la peña
 * ------------------------------------------------------------------ */

export type RemoveState = { ok: boolean; error: string | null; removed: string | null }

/**
 * Saca a un miembro de la peña.
 *
 * LO QUE SE LLEVA POR DELANTE, que no es poco:
 *   - sus pronosticos (`predictions` cae en CASCADE), o sea su historial entero;
 *   - sus avisos push (`push_subscriptions`, `push_reminders_sent`).
 *
 * Y REESCRIBE EL PASADO. Quien quedo ultimo en cada jornada se calcula sobre los
 * datos de AHORA (`season_dues`, migracion 0023), asi que al quitar a alguien los
 * pagos de jornadas ya cerradas pueden cambiar de dueño. Si ya se cobro, la
 * pantalla dejara de cuadrar con lo que hay en el bote de verdad. Por eso la
 * pantalla lo avisa antes y pide confirmar, en vez de borrar de una pulsacion.
 *
 * NO se borra su CUENTA, solo su ficha en la peña: puede volver a entrar con el
 * codigo de invitacion. Eso es a proposito -- echar a alguien por error no tiene
 * que costar una cuenta nueva.
 *
 * EL ORGANIZADOR NO SE PUEDE BORRAR A SI MISMO. Se quedaria una peña sin nadie
 * que pueda meter resultados ni emitir accesos, y sin forma de arreglarlo desde
 * la aplicacion.
 */
export async function removeMemberAction(
  _prev: RemoveState,
  formData: FormData,
): Promise<RemoveState> {
  let me
  try {
    me = await requireAdmin()
  } catch {
    return { ok: false, error: DENIED, removed: null }
  }

  const memberId = String(formData.get('memberId') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  if (memberId === '') return { ok: false, error: 'Falta a quién quitar.', removed: null }

  if (memberId === me.memberId) {
    return {
      ok: false,
      error: 'No puedes quitarte a ti: la peña se quedaría sin organizador.',
      removed: null,
    }
  }

  if (!isSupabaseConfigured) {
    return { ok: false, error: 'No hay proyecto de Supabase configurado.', removed: null }
  }

  const supabase = await createClient()
  // Con la sesion del organizador, NO con service role: asi la politica
  // `members_delete_self_or_admin` sigue siendo la frontera de verdad y esto no
  // puede tocar a nadie de otra peña ni por error.
  const { data, error } = await supabase
    .from('members')
    .delete()
    .eq('id', memberId)
    .eq('league_id', me.leagueId)
    .select('id')

  if (error) return { ok: false, error: 'No hemos podido quitarlo.', removed: null }
  // 0 filas = RLS lo tapo, o ya no estaba. Para quien mira es lo mismo.
  if (!data || data.length === 0) {
    return { ok: false, error: 'Ese miembro ya no está en la peña.', removed: null }
  }

  revalidatePath('/ajustes/admin')
  revalidatePath('/clasificacion')
  revalidatePath('/jornada')
  return { ok: true, error: null, removed: name || 'Miembro' }
}

export type CodeState = {
  ok: boolean
  error: string | null
  /** El codigo recien puesto y de quien es, para poder enseñarlo al momento. */
  code: string | null
  name: string | null
}

/**
 * Da (o rehace) el codigo personal de alguien.
 *
 * El codigo ES la contraseña de Supabase de esa persona: se guarda con
 * `admin.updateUserById` y se canjea en /login con `signInWithPassword`. Por eso
 * este paso hace DOS escrituras y el orden importa: primero la contraseña y
 * despues la tabla. Al reves, un fallo a mitad dejaria en la tabla un codigo que
 * no abre nada, y la persona estaria fuera creyendo que tiene la llave buena.
 *
 * Rehacerlo INVALIDA el anterior al instante, que es justo lo que hace falta
 * cuando alguien pega su codigo en el grupo equivocado.
 */
export async function regenerateCodeAction(
  _prev: CodeState,
  formData: FormData,
): Promise<CodeState> {
  try {
    await requireAdmin()
  } catch {
    return { ok: false, error: DENIED, code: null, name: null }
  }
  if (!isSupabaseConfigured) {
    return { ok: false, error: 'Supabase no esta configurado.', code: null, name: null }
  }

  const memberId = String(formData.get('memberId') ?? '').trim()
  const name = String(formData.get('name') ?? '').trim() || 'esa persona'
  if (memberId === '') {
    return { ok: false, error: 'Falta a quien.', code: null, name: null }
  }

  let db
  try {
    db = admin()
  } catch {
    return { ok: false, error: 'Falta la service role key.', code: null, name: null }
  }

  const { data: member, error: memberError } = await db
    .from('members')
    .select('id, user_id')
    .eq('id', memberId)
    .maybeSingle()
  if (memberError || !member) {
    return { ok: false, error: 'No encuentro a esa persona.', code: null, name: null }
  }

  const code = generateAccessCode()

  const { error: passError } = await db.auth.admin.updateUserById(
    (member as { user_id: string }).user_id,
    { password: code },
  )
  if (passError) {
    return { ok: false, error: `No se pudo guardar: ${passError.message}`, code: null, name: null }
  }

  const { error: saveError } = await db.rpc('guardar_codigo', {
    p_member_id: memberId,
    p_code: code,
  })
  if (saveError) {
    // La contraseña ya cambio pero la tabla no: el codigo funciona y no sabemos
    // de quien es, o sea que nadie podra entrar con el. Se dice tal cual en vez
    // de fingir que no paso nada.
    return {
      ok: false,
      error: `Se cambio la contraseña pero no se guardo el codigo (${saveError.message}). Vuelve a darle.`,
      code: null,
      name: null,
    }
  }

  revalidatePath('/ajustes/admin')
  return { ok: true, error: null, code, name }
}
