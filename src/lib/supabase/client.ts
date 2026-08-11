/**
 * Cliente de Supabase para el NAVEGADOR.
 *
 * D11: el magic link se envia desde aqui (`signInWithOtp`), NUNCA desde una
 * Server Action. La cookie PKCE tiene que quedarse en el navegador que inicia
 * el flujo; si la emitiera el servidor, al abrir el correo en el navegador del
 * movil el verifier no existiria.
 */

import { createBrowserClient } from '@supabase/ssr'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

/**
 * `true` cuando hay proyecto Supabase configurado. Fase A del plan: todavia no
 * lo hay, asi que la UI que dependa de auth puede consultarlo antes de llamar a
 * `createClient()` y mostrar un aviso en vez de reventar.
 */
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY)

export function createClient() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Copia .env.example a .env.local.',
    )
  }

  // `createBrowserClient` ya es singleton y gestiona document.cookie solo:
  // no se le pasa `cookies`, que es donde se rompen la mayoria de integraciones.
  return createBrowserClient(SUPABASE_URL, SUPABASE_KEY)
}
