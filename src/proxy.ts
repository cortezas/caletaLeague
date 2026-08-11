/**
 * D12: en Next 16 `middleware` esta deprecado y renombrado a `proxy`. Este
 * fichero es la unica puerta de entrada; NO existe `middleware.ts`.
 * El runtime es nodejs por defecto y NO es configurable aqui (declarar
 * `runtime` en un fichero proxy lanza error).
 */

import type { NextRequest } from 'next/server'

import { updateSession } from '@/lib/supabase/proxy'

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Todo menos:
     * - _next/static, _next/image  -> el CSS y el JS de la app
     * - favicon.ico                -> el favicon clasico
     * - manifest.webmanifest       -> sin el la PWA no es instalable
     * - sw.js                      -> el service worker de las notificaciones
     * - icon, apple-icon           -> los iconos generados de app/
     * - cualquier imagen           -> public/ y los iconos PNG
     * Si alguno entrase, la logica de auth los redirigiria a /login y la app
     * se quedaria sin estilos ni iconos.
     *
     * `sw.js` esta por un fallo dificil de ver: sin sesion, la peticion de
     * ACTUALIZACION del worker se convertia en un 307 a /login, el navegador
     * recibia HTML donde esperaba JavaScript y se quedaba con la version
     * anterior del worker, en silencio y para siempre.
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icon|apple-icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
