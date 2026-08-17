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

  const { data: members } = await admin.from('members').select('user_id, display_name')
  const nameByUser = new Map<string, string>()
  for (const row of (members ?? []) as Array<{ user_id: string; display_name: string }>) {
    nameByUser.set(row.user_id, row.display_name)
  }

  return data.users
    .map((user) => ({
      email: user.email ?? '(sin correo)',
      displayName: nameByUser.get(user.id) ?? null,
      lastSignInAt: user.last_sign_in_at ?? null,
    }))
    // Primero quien nunca ha entrado y quien no tiene ficha: son justo los que
    // necesitan un enlace, y son los que hay que ver sin bajar la pantalla.
    .sort((a, b) => {
      const rank = (row: AccessRowVM) =>
        row.lastSignInAt === null ? 0 : row.displayName === null ? 1 : 2
      return rank(a) - rank(b) || a.email.localeCompare(b.email)
    })
}
