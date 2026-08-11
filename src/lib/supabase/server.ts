/**
 * Cliente de Supabase para el SERVIDOR (Server Components, Route Handlers y
 * Server Actions).
 *
 * Riesgo Next 16: `cookies()` es asincrona. Por eso esta funcion es `async` y
 * TODOS los call sites hacen `await createClient()`. Llamarla sin `await`
 * rompe el flujo de auth en silencio hasta que peta.
 *
 * Riesgo Supabase: NUNCA `getSession()` en servidor (la cookie es falsificable).
 * Solo `getClaims()`.
 */

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

/** Mismo indicador que en `client.ts`: fase A del plan, aun sin proyecto. */
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY)

export async function createClient() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Copia .env.example a .env.local.',
    )
  }

  const cookieStore = await cookies()

  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      // La firma lleva el segundo parametro aunque no se use: aqui las cabeceras
      // anti-cache no se pueden poner (no hay objeto respuesta). De eso se
      // encarga `lib/supabase/proxy.ts`, que si lo tiene. El parametro se
      // declara igualmente para que la firma quede documentada en el codigo.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      setAll(cookiesToSet, _headers) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Llamado desde un Server Component: escribir cookies ahi es ilegal.
          // No pasa nada, el proxy ya ha refrescado la sesion en esta request.
        }
      },
    },
  })
}
