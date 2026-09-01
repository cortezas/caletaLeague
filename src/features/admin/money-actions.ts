'use server'

/**
 * Apuntar y borrar pagos de la deuda del bote.
 *
 * Se guarda pago a pago y no como un saldo (migracion 0032): un saldo no se
 * puede auditar ni deshacer, y aqui una cifra mal metida es dinero de verdad
 * entre companeros. Por eso hay borrar y no hay editar -- corregir un importe
 * es quitar la linea mala y poner la buena, y asi el historial cuenta lo que
 * paso de verdad.
 *
 * La escritura la protege la RLS de `payments`, que solo deja al organizador de
 * la liga. El `requireAdmin()` de aqui es la primera puerta y no la unica: una
 * Server Action es un POST a la ruta y el proxy no basta como autorizacion (D13).
 */

import { revalidatePath } from 'next/cache'

import { requireAdmin } from '@/lib/auth'
import { createClient, isSupabaseConfigured } from '@/lib/supabase/server'

export type MoneyState = { ok: boolean; error: string | null; mensaje: string | null }

const DENIED = 'No tienes permiso para esto.'

/** El mismo tope que el CHECK de la tabla, para poder dar un error que se lea. */
const MAX_EUROS = 500

export async function addPaymentAction(_prev: MoneyState, formData: FormData): Promise<MoneyState> {
  let me
  try {
    me = await requireAdmin()
  } catch {
    return { ok: false, error: DENIED, mensaje: null }
  }
  if (!isSupabaseConfigured) {
    return { ok: false, error: 'Supabase no esta configurado.', mensaje: null }
  }

  const memberId = String(formData.get('memberId') ?? '').trim()
  const nombre = String(formData.get('name') ?? '').trim() || 'esa persona'
  const nota = String(formData.get('nota') ?? '').trim()

  // Se acepta la coma como separador: en un movil espanol es lo que sale.
  const crudo = String(formData.get('euros') ?? '').trim().replace(',', '.')
  const euros = Math.round(Number(crudo))

  if (memberId === '') return { ok: false, error: 'Falta a quién.', mensaje: null }
  if (!Number.isFinite(euros) || euros <= 0) {
    return { ok: false, error: 'Pon una cantidad en euros, mayor que cero.', mensaje: null }
  }
  if (euros > MAX_EUROS) {
    return { ok: false, error: `${euros} € es demasiado. El tope son ${MAX_EUROS} €.`, mensaje: null }
  }
  if (nota.length > 120) {
    return { ok: false, error: 'La nota es demasiado larga.', mensaje: null }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('payments').insert({
    league_id: me.leagueId,
    member_id: memberId,
    euros,
    nota: nota === '' ? null : nota,
  })
  if (error) return { ok: false, error: `No se pudo apuntar: ${error.message}`, mensaje: null }

  revalidatePath('/ajustes/admin')
  revalidatePath('/clasificacion')
  return { ok: true, error: null, mensaje: `${euros} € de ${nombre}, apuntados.` }
}

/**
 * Borra un pago. Es la unica forma de corregir: no hay editar.
 *
 * No pide confirmacion porque no se pierde nada que no se pueda volver a meter
 * en diez segundos, y el importe esta a la vista en la propia linea.
 */
export async function deletePaymentAction(
  _prev: MoneyState,
  formData: FormData,
): Promise<MoneyState> {
  try {
    await requireAdmin()
  } catch {
    return { ok: false, error: DENIED, mensaje: null }
  }
  if (!isSupabaseConfigured) {
    return { ok: false, error: 'Supabase no esta configurado.', mensaje: null }
  }

  const id = String(formData.get('paymentId') ?? '').trim()
  if (id === '') return { ok: false, error: 'Falta cuál.', mensaje: null }

  const supabase = await createClient()
  const { error } = await supabase.from('payments').delete().eq('id', id)
  if (error) return { ok: false, error: `No se pudo borrar: ${error.message}`, mensaje: null }

  revalidatePath('/ajustes/admin')
  revalidatePath('/clasificacion')
  return { ok: true, error: null, mensaje: 'Pago borrado.' }
}
