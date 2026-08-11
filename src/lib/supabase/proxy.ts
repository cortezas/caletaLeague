/**
 * Refresco de sesion en el borde de la app. Lo invoca `src/proxy.ts`.
 *
 * D12: en Next 16 el fichero es `proxy.ts` y la funcion `proxy`. No existe
 * `middleware.ts` en este repositorio.
 * D13: aqui SOLO se refresca la sesion y se redirige a /login. La autorizacion
 * real es RLS + `requireMember()` al principio de cada page protegida, porque
 * las Server Functions son POST a la ruta donde viven y un cambio de matcher
 * las dejaria fuera del proxy en silencio.
 */

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

/**
 * Unicas rutas accesibles sin sesion. Todo lo demas redirige a /login.
 *
 * `/api/sync` y `/api/push/dispatch` las llama un CRON, que no tiene cookies de
 * sesion. Sin esta excepcion el POST recibia un 307 a /login y la tarea NO se
 * ejecutaba nunca: el cron veia un 200 (el HTML del login) y daba la pasada por
 * buena. Es seguro dejarlas pasar porque cada ruta se protege sola con
 * `CRON_SECRET` y responde 503 si no existe.
 *
 * `/api/push/subscribe` y `/api/push/unsubscribe` NO van aqui: las llama el
 * navegador con la sesion puesta y deben seguir protegidas.
 */
function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname.startsWith('/login/') ||
    pathname === '/auth' ||
    pathname.startsWith('/auth/') ||
    pathname === '/api/sync' ||
    pathname.startsWith('/api/sync/') ||
    pathname === '/api/push/dispatch'
  )
}

export async function updateSession(request: NextRequest) {
  // `NextResponse.next({ request })` propaga la request tal cual; el objeto se
  // reasigna dentro de `setAll` porque es la unica forma de que las cookies
  // refrescadas viajen a la vez en la request (para el render) y en la
  // respuesta (para el navegador).
  let supabaseResponse = NextResponse.next({ request })

  // Fase A del plan: todavia no hay proyecto Supabase. Sin variables de entorno
  // el proxy DEJA PASAR sin redirigir en vez de reventar la app entera.
  // En cuanto se rellene .env.local el guardado de sesion se activa solo.
  if (!SUPABASE_URL || !SUPABASE_KEY) return supabaseResponse

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        supabaseResponse = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options)
        }
        // Sin esto un CDN o proxy inverso cachea la respuesta CON el Set-Cookie
        // de auth y le sirve la sesion de un usuario a otro. El segundo
        // parametro trae Cache-Control/Expires/Pragma ya calculados.
        Object.entries(headers).forEach(([key, value]) => {
          supabaseResponse.headers.set(key, value)
        })
      },
    },
  })

  // ATENCION: NO ESCRIBAS NINGUNA SENTENCIA ENTRE `createServerClient` Y
  // `getClaims()`. Cualquier cosa en medio provoca deslogueos aleatorios
  // imposibles de depurar. Y es `getClaims()`, jamas `getSession()`.
  const { data } = await supabase.auth.getClaims()

  const hasSession = Boolean(data?.claims)
  const { pathname } = request.nextUrl

  if (!hasSession && !isPublicPath(pathname)) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.search = ''

    const redirectResponse = NextResponse.redirect(loginUrl)
    // Se arrastran las cookies que acabe de escribir Supabase: si el refresco
    // ha fallado son cookies de borrado, y perderlas deja al usuario en bucle
    // de redirecciones con un token muerto.
    for (const cookie of supabaseResponse.cookies.getAll()) {
      redirectResponse.cookies.set(cookie)
    }
    return redirectResponse
  }

  // El objeto se devuelve tal cual, sin construir otro: es lo que lleva las
  // cookies refrescadas.
  return supabaseResponse
}
