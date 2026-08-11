/**
 * `GET  /api/push/subscribe` - dice si los avisos estan configurados y devuelve
 *                              la clave publica VAPID que necesita el navegador.
 * `POST /api/push/subscribe` - guarda la suscripcion del navegador actual.
 *
 * A diferencia de `/api/sync`, estas dos las llama una persona con sesion, asi
 * que se protegen con `getClaims()` y la escritura pasa por RLS: el cliente es
 * el de sesion, NO la service role key. Un usuario no puede registrar una
 * suscripcion a nombre de otro porque la politica
 * `push_subscriptions_insert_own` lo impide en la base, no aqui.
 */

import { createClient } from '@/lib/supabase/server'
import { isPushConfigured, pushConfigError, vapidPublicKey } from '@/lib/push/vapid'

// `@/lib/push/vapid` usa Buffer para validar las claves. Node, nunca edge.
export const runtime = 'nodejs'

interface SubscribeBody {
  endpoint?: unknown
  keys?: { p256dh?: unknown; auth?: unknown }
}

/**
 * Id de miembro del usuario de esta sesion. `members_select` solo deja ver las
 * fichas de las ligas propias, asi que el filtro por `user_id` devuelve la suya.
 * Con una sola pena hay como mucho una fila; si algun dia hay varias ligas, esto
 * habra que ampliarlo a "una suscripcion por liga".
 */
async function currentMemberId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('members')
    .select('id')
    .eq('user_id', userId)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return data.id as string
}

function notConfiguredResponse() {
  return Response.json(
    {
      ok: false,
      configured: false,
      error:
        pushConfigError ??
        'Los avisos no estan configurados en este entorno. Ver docs/AVISOS.md.',
    },
    { status: 503 },
  )
}

export async function GET() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  if (!data?.claims) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  if (!isPushConfigured) return notConfiguredResponse()

  // La clave publica es publica por diseno (viaja a todos los navegadores que
  // se suscriben); servirla aqui evita tener que inlinearla con NEXT_PUBLIC_.
  return Response.json({ ok: true, configured: true, publicKey: vapidPublicKey })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: claimsData } = await supabase.auth.getClaims()
  const userId = claimsData?.claims?.sub
  if (!userId) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  if (!isPushConfigured) return notConfiguredResponse()

  let body: SubscribeBody
  try {
    body = (await request.json()) as SubscribeBody
  } catch {
    return Response.json({ ok: false, error: 'cuerpo no es JSON' }, { status: 400 })
  }

  const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : ''
  const p256dh = typeof body.keys?.p256dh === 'string' ? body.keys.p256dh : ''
  const auth = typeof body.keys?.auth === 'string' ? body.keys.auth : ''

  if (!endpoint || !p256dh || !auth) {
    return Response.json(
      { ok: false, error: 'faltan endpoint, keys.p256dh o keys.auth' },
      { status: 400 },
    )
  }
  // El endpoint lo fabrica el servicio de push del navegador y siempre es https.
  // Rechazar lo demas evita guardar basura que luego revienta en el envio.
  if (!endpoint.startsWith('https://') || endpoint.length > 2000) {
    return Response.json({ ok: false, error: 'endpoint no valido' }, { status: 400 })
  }

  const memberId = await currentMemberId(supabase, userId)
  if (!memberId) {
    return Response.json(
      { ok: false, error: 'todavia no perteneces a ninguna peña' },
      { status: 403 },
    )
  }

  // Upsert por `endpoint`: al reinstalar la PWA el navegador puede devolver el
  // mismo endpoint con claves nuevas, y sin esto el insert chocaria con el
  // unique. Las politicas de INSERT y de UPDATE cubren las dos ramas.
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({ member_id: memberId, endpoint, p256dh, auth }, { onConflict: 'endpoint' })

  if (error) {
    // 23505 / 42501: el endpoint existe pero es de OTRA ficha (navegador
    // compartido en el que antes entro un compañero). RLS impide pisarlo, y
    // esta bien que asi sea: sus avisos no pueden acabar en la pantalla de otro.
    if (error.code === '23505' || error.code === '42501') {
      return Response.json(
        {
          ok: false,
          error:
            'Este navegador ya tiene los avisos registrados a nombre de otro participante. Que los desactive él primero desde Ajustes.',
        },
        { status: 409 },
      )
    }
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
