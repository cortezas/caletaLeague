'use server'

import { randomUUID } from 'node:crypto'

import { createClient as createAdminClient } from '@supabase/supabase-js'
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

  // La foto viaja en el MISMO envio que el nombre y el color: son un solo
  // formulario y un solo "Guardar". Si fallara la foto se avisa y no se guarda
  // nada, en vez de dejar el nombre cambiado y la cara vieja.
  let photo: PhotoChange
  try {
    photo = await resolvePhoto(formData, userId)
  } catch (failure) {
    return { ok: false, error: (failure as Error).message, warning: null }
  }

  const { data: rows, error } = await supabase
    .from('members')
    .update({
      display_name: displayName,
      avatar_color: avatarColor,
      // `undefined` = no tocar la columna; `null` = quitar la foto.
      ...(photo.kind === 'keep' ? {} : { avatar_url: photo.url }),
    })
    .eq('user_id', userId)
    .select('id, league_id')

  if (error) return { ok: false, error: FAILED, warning: null }
  // 0 filas = RLS ha tapado la fila (o no hay ficha de miembro). No es un fallo
  // tecnico, pero para el usuario se cuenta igual: no se ha guardado.
  if (!rows || rows.length === 0) return { ok: false, error: FAILED, warning: null }

  // La anterior se borra DESPUES de que la fila apunte a la nueva. Al reves, un
  // fallo en el update dejaria a la persona sin foto y sin forma de recuperarla.
  if (photo.kind !== 'keep' && photo.previousPath) {
    await storage().storage.from(AVATAR_BUCKET).remove([photo.previousPath])
  }

  const mine = rows[0] as unknown as { id: string; league_id: string }
  const warning = await duplicateWarning(supabase, mine.league_id, mine.id, displayName)

  revalidateProfile()
  return { ok: true, error: null, warning }
}

/* ------------------------------------------------------------------ *
 * Foto de perfil
 * ------------------------------------------------------------------ */

const AVATAR_BUCKET = 'avatars'

/**
 * Tope de lo que se acepta subir. El navegador ya reduce a 256 px antes de
 * enviar (ver `edit-profile.tsx`), lo que deja la foto en 20-40 KB; 400 KB da
 * margen de sobra y a la vez impide que alguien haga un POST a pelo con una
 * imagen de 10 MB.
 */
const MAX_PHOTO_BYTES = 400 * 1024

/** Lo unico que sabemos recortar y servir. */
const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/png': 'png',
}

type PhotoChange =
  | { kind: 'keep' }
  | { kind: 'set'; url: string; previousPath: string | null }
  | { kind: 'clear'; url: null; previousPath: string | null }

/**
 * Cliente con service role SOLO para el bucket.
 *
 * El bucket no tiene politica de escritura a proposito (migracion 0018): asi
 * `anon` y `authenticated` no pueden subir nada ni con el token en la mano.
 * Quien escribe es el servidor, y solo despues de haber comprobado la sesion
 * unas lineas mas arriba.
 */
function storage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('No se puede guardar la foto: falta configuración del servidor.')
  return createAdminClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** De la URL publica al camino dentro del bucket, para poder borrar la anterior. */
function pathFromUrl(url: string | null): string | null {
  if (!url) return null
  const marker = `/${AVATAR_BUCKET}/`
  const at = url.indexOf(marker)
  return at === -1 ? null : url.slice(at + marker.length)
}

/**
 * Decide que hacer con la foto en este guardado: nada, ponerla o quitarla.
 *
 * Llega como data URL dentro del propio formulario y no como `File`: el
 * navegador ya la ha reducido a 256 px con un canvas, asi que son unas decenas
 * de kilobytes. Mandar el archivo original (4-8 MB desde un movil) haria eterna
 * la subida desde la calle y se comeria el bucket.
 */
async function resolvePhoto(formData: FormData, userId: string): Promise<PhotoChange> {
  const remove = formData.get('avatarRemove') === '1'
  const raw = formData.get('avatarData')
  const data = typeof raw === 'string' ? raw : ''

  if (!remove && data === '') return { kind: 'keep' }

  // Se lee la actual para poder borrar el archivo viejo del bucket. Un fallo
  // aqui no puede tumbar el guardado: como mucho queda un archivo huerfano.
  const admin = storage()
  const { data: current } = await admin
    .from('members')
    .select('avatar_url')
    .eq('user_id', userId)
    .maybeSingle()
  const previousPath = pathFromUrl((current as { avatar_url: string | null } | null)?.avatar_url ?? null)

  if (remove) return { kind: 'clear', url: null, previousPath }

  const match = /^data:([a-z/+-]+);base64,(.+)$/i.exec(data)
  if (!match) throw new Error('Esa imagen no la hemos entendido. Prueba con otra.')

  const extension = ALLOWED_MIME[match[1].toLowerCase()]
  if (!extension) throw new Error('La foto tiene que ser JPG, PNG o WEBP.')

  const bytes = Buffer.from(match[2], 'base64')
  if (bytes.byteLength === 0) throw new Error('Esa imagen no la hemos entendido. Prueba con otra.')
  if (bytes.byteLength > MAX_PHOTO_BYTES) throw new Error('La foto pesa demasiado. Prueba con otra.')

  // Nombre NUEVO en cada subida. Con un nombre fijo la URL no cambiaria y la
  // peña seguiria viendo la foto anterior durante dias: la cachean el navegador
  // y la CDN, y `upsert` no invalida nada.
  const path = `${userId}/${randomUUID()}.${extension}`
  const { error } = await admin.storage
    .from(AVATAR_BUCKET)
    .upload(path, bytes, { contentType: match[1].toLowerCase(), upsert: false })
  if (error) throw new Error('No hemos podido subir la foto. Inténtalo dentro de un momento.')

  const { data: published } = admin.storage.from(AVATAR_BUCKET).getPublicUrl(path)
  return { kind: 'set', url: published.publicUrl, previousPath }
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
