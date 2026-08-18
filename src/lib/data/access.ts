/**
 * Quien ha entrado y quien no. Solo para el organizador.
 *
 * `auth.users` no la expone PostgREST (ni debe), asi que la ultima entrada se
 * pide con la API de administracion y la service role key. Por eso este modulo
 * empieza SIEMPRE por `requireAdmin()`: es lo unico que separa esta lista de una
 * filtracion de los correos de toda la peña.
 *
 * SOLO SERVIDOR. Nunca importar esto desde un Client Component.
 */

import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireAdmin } from '@/lib/auth'
import { isSupabaseConfigured } from '@/lib/supabase/server'

export type AccessRowVM = {
  email: string
  /** Nombre en la peña, o `null` si tiene cuenta pero no llego a unirse. */
  displayName: string | null
  /** ISO de la ultima entrada, o `null` si no ha entrado JAMAS. */
  lastSignInAt: string | null
  /**
   * Su ficha en la peña, o `null` si no se unio. Es lo que hace falta para poder
   * echarlo: sin ficha no hay nada que quitar.
   */
  memberId: string | null
  /**
   * Pronosticos que se perderian al quitarlo (`predictions` cae en CASCADE).
   * La pantalla lo dice ANTES de confirmar: "quitar a Fulano" y "borrar los diez
   * pronosticos de Fulano" son la misma accion y no lo parecen.
   */
  predictions: number
  /** El organizador no se puede quitar: la peña se quedaria sin nadie al mando. */
  isAdmin: boolean
}

export async function getAccessRows(): Promise<AccessRowVM[]> {
  await requireAdmin()
  if (!isSupabaseConfigured) return []

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return []

  const admin = createAdminClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // 200 de golpe: la peña son 15 y el paginado de esta API arranca en 50.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (error) return []

  const [{ data: members }, { data: leagues }, { data: predictions }] = await Promise.all([
    admin.from('members').select('id, user_id, display_name'),
    admin.from('leagues').select('admin_user_id'),
    admin.from('predictions').select('member_id'),
  ])

  type MemberRow = { id: string; user_id: string; display_name: string }
  const memberByUser = new Map<string, MemberRow>()
  for (const row of (members ?? []) as MemberRow[]) memberByUser.set(row.user_id, row)

  const admins = new Set(
    ((leagues ?? []) as Array<{ admin_user_id: string }>).map((row) => row.admin_user_id),
  )

  // Se cuenta aqui y no con un `count` por persona: son 15 consultas contra una.
  const predictionsByMember = new Map<string, number>()
  for (const row of (predictions ?? []) as Array<{ member_id: string }>) {
    predictionsByMember.set(row.member_id, (predictionsByMember.get(row.member_id) ?? 0) + 1)
  }

  return data.users
    .map((user) => {
      const member = memberByUser.get(user.id) ?? null
      return {
        email: user.email ?? '(sin correo)',
        displayName: member?.display_name ?? null,
        lastSignInAt: user.last_sign_in_at ?? null,
        memberId: member?.id ?? null,
        predictions: member ? (predictionsByMember.get(member.id) ?? 0) : 0,
        isAdmin: admins.has(user.id),
      }
    })
    // Primero quien nunca ha entrado y quien no tiene ficha: son justo los que
    // necesitan un enlace, y son los que hay que ver sin bajar la pantalla.
    .sort((a, b) => {
      const rank = (row: AccessRowVM) =>
        row.lastSignInAt === null ? 0 : row.displayName === null ? 1 : 2
      return rank(a) - rank(b) || a.email.localeCompare(b.email)
    })
}
