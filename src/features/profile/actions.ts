'use server'

import { revalidatePath } from 'next/cache'

import { requireMember } from '@/lib/auth'
import { AVATAR_COLORS } from '@/lib/seed'
import { createClient, isSupabaseConfigured } from '@/lib/supabase/server'

/**
 * `warning` no es un error: el nombre repetido se AVISA y se guarda igual.
 * Bloquearlo obligaria a la peña a inventarse alias por una colision que ellos
 * resuelven hablando; que un `ok: true` pueda traer aviso es justo eso.
 */
export type UpdateProfileState = {
  ok: boolean
  error: string | null
  warning: string | null
}

/** Mismo tope que el alta y que el CHECK de `members.display_name`. */
const MAX_NAME = 24

const ALLOWED_COLORS = new Set<string>(AVATAR_COLORS)

const FAILED = 'No hemos podido guardar tu perfil. Inténtalo dentro de un momento.'

/** Marcas combinantes que deja `normalize('NFD')`: las tildes ya separadas. */
const DIACRITICS = /[\u0300-\u036F]/g

/**
 * Dos nombres "iguales" para la peña: nadie distingue «Raúl C.» de «raul c.» al
 * leer la clasificación. Rango de marcas combinantes y no `\p{Diacritic}`
 * porque el target de TypeScript es ES2017.
 */
function nameKey(name: string): string {
  return name.normalize('NFD').replace(DIACRITICS, '').toLowerCase()
}

/** D5: solo `revalidatePath`. Las tres pantallas donde sale el nombre propio. */
function revalidateProfile() {
  revalidatePath('/perfil')
  revalidatePath('/clasificacion')
  revalidatePath('/ajustes')
}

/**
 * Cambia el nombre visible y el color del avatar del propio usuario.
 *
 * D13: la autorizacion no se delega en el proxy. Una Server Action es un POST a
 * la ruta y puede quedar fuera del matcher en silencio, asi que la sesion se
 * comprueba aqui con `getClaims()` (JAMAS `getSession()` en servidor).
 *
 * No se valida que no se toquen `league_id` ni `user_id`: la politica
 * `members_update_self` recorta el UPDATE a la fila propia y el trigger
 * `freeze_member_identity` congela esas dos columnas. La frontera es la base de
 * datos; esto solo evita viajes inutiles y da un mensaje decente.
 */
export async function updateProfileAction(
  _prev: UpdateProfileState,
  formData: FormData,
): Promise<UpdateProfileState> {
  // Mismo saneado que el alta: recortar y colapsar espacios.
  const displayName = String(formData.get('displayName') ?? '').trim().replace(/\s+/g, ' ')
  const avatarColor = String(formData.get('avatarColor') ?? '')

  if (!displayName) {
    return { ok: false, error: 'Ponte un nombre, que es como te ve el resto de la peña.', warning: null }
  }

  if (displayName.length > MAX_NAME) {
    return { ok: false, error: `El nombre se queda en ${MAX_NAME} caracteres como mucho.`, warning: null }
  }

  if (!ALLOWED_COLORS.has(avatarColor)) {
    return { ok: false, error: 'Elige uno de los ocho colores de avatar.', warning: null }
  }

  if (!isSupabaseConfigured) {
    // Arranque en seco (sin proyecto Supabase): la guarda equivalente es la de
    // lib/auth y no hay nada que persistir.
    await requireMember()
    revalidateProfile()
    return { ok: true, error: null, warning: null }
  }

  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub
  if (typeof userId !== 'string' || userId === '') {
    return { ok: false, error: 'Se ha caído la sesión. Pide otra vez el enlace de acceso.', warning: null }
  }

  const { data: rows, error } = await supabase
    .from('members')
    .update({ display_name: displayName, avatar_color: avatarColor })
    .eq('user_id', userId)
    .select('id, league_id')

  if (error) return { ok: false, error: FAILED, warning: null }
  // 0 filas = RLS ha tapado la fila (o no hay ficha de miembro). No es un fallo
  // tecnico, pero para el usuario se cuenta igual: no se ha guardado.
  if (!rows || rows.length === 0) return { ok: false, error: FAILED, warning: null }

  const mine = rows[0] as unknown as { id: string; league_id: string }
  const warning = await duplicateWarning(supabase, mine.league_id, mine.id, displayName)

  revalidateProfile()
  return { ok: true, error: null, warning }
}

type Client = Awaited<ReturnType<typeof createClient>>

/**
 * Aviso (nunca bloqueo) si otro de la peña ya se llama igual. Un fallo al
 * consultar no puede tumbar un guardado que ya ha salido bien: se devuelve
 * `null` y el usuario se queda sin el aviso, que es lo prescindible.
 */
async function duplicateWarning(
  supabase: Client,
  leagueId: string,
  memberId: string,
  displayName: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('members')
    .select('id, display_name')
    .eq('league_id', leagueId)
    .neq('id', memberId)
  if (error) return null

  const key = nameKey(displayName)
  const clash = ((data ?? []) as unknown as Array<{ display_name: string }>).some(
    (row) => nameKey(row.display_name) === key,
  )

  return clash ? `Guardado, pero ya hay otro «${displayName}» en la peña.` : null
}
