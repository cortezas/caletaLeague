/**
 * Cierre de sesion. Solo POST: un GET dejaria que cualquier <img> o prefetch
 * desloguease al usuario.
 */

import { NextResponse, type NextRequest } from 'next/server'

import { createClient, isSupabaseConfigured } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const loginUrl = request.nextUrl.clone()
  loginUrl.pathname = '/login'
  loginUrl.search = ''

  if (isSupabaseConfigured) {
    const supabase = await createClient()
    // `scope: 'local'` cierra la sesion de ESTE dispositivo. La global echaria
    // al usuario tambien del movil, que no es lo que espera al tocar "Salir".
    await supabase.auth.signOut({ scope: 'local' })
  }

  // 303: un 307 (el defecto de NextResponse.redirect) conserva el metodo y
  // reenviaria el POST a /login, que responderia 405.
  return NextResponse.redirect(loginUrl, { status: 303 })
}
