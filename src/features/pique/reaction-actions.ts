'use server'

/**
 * Poner y quitar reacciones a los pronosticos ajenos.
 *
 * La regla dura la impone la RLS de `reactions` (migracion 0035), no esto:
 * `reactions_insert_own` exige que el partido HAYA EMPEZADO, que reacciones como
 * tu mismo y que los dos sean de tu peña. Es el complemento exacto de
 * `predictions_select`, asi que no se puede usar una reaccion para averiguar lo
 * que alguien ha puesto antes de tiempo.
 *
 * Aqui solo se traduce el rebote a un mensaje que se lea.
 */

import { revalidatePath } from 'next/cache'

import { requireMember } from '@/lib/auth'
import { createClient, isSupabaseConfigured } from '@/lib/supabase/server'

import { EMOJIS } from './emojis'

export type ReactionState = { ok: boolean; error: string | null }

const INVALIDO = 'Ese emoji no vale.'

/**
 * Alterna: si ya la tenias puesta, la quita. Un solo boton hace las dos cosas,
 * que es como funciona una reaccion en cualquier sitio.
 */
export async function toggleReactionAction(
  _prev: ReactionState,
  formData: FormData,
): Promise<ReactionState> {
  let me
  try {
    me = await requireMember()
  } catch {
    return { ok: false, error: 'Entra otra vez.' }
  }
  if (!isSupabaseConfigured) return { ok: false, error: 'Supabase no esta configurado.' }

  const matchId = String(formData.get('matchId') ?? '').trim()
  const targetId = String(formData.get('targetId') ?? '').trim()
  const emoji = String(formData.get('emoji') ?? '')
  if (matchId === '' || targetId === '') return { ok: false, error: 'Falta a quien.' }
  if (!(EMOJIS as readonly string[]).includes(emoji)) return { ok: false, error: INVALIDO }

  const supabase = await createClient()

  const { data: existe } = await supabase
    .from('reactions')
    .select('id')
    .eq('match_id', matchId)
    .eq('target_id', targetId)
    .eq('member_id', me.memberId)
    .eq('emoji', emoji)
    .maybeSingle()

  if (existe) {
    const { error } = await supabase
      .from('reactions')
      .delete()
      .eq('id', (existe as { id: string }).id)
    if (error) return { ok: false, error: 'No se pudo quitar.' }
  } else {
    const { error } = await supabase.from('reactions').insert({
      match_id: matchId,
      target_id: targetId,
      member_id: me.memberId,
      emoji,
    })
    // El rebote tipico es reaccionar a un partido que aun no ha empezado, y eso
    // no es un fallo tecnico: es la regla del secreto haciendo su trabajo.
    if (error) {
      return {
        ok: false,
        error: 'Todavía no. Los pronósticos se destapan cuando empieza el partido.',
      }
    }
  }

  revalidatePath(`/partido/${matchId}`)
  return { ok: true, error: null }
}
