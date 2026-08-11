/**
 * `POST /api/push/unsubscribe` - borra la suscripcion de este navegador.
 *
 * No hace falta resolver el miembro: la politica
 * `push_subscriptions_delete_own` ya limita el DELETE a las filas propias, asi
 * que borrar por `endpoint` es seguro aunque alguien mande el endpoint de otro
 * (afectaria a 0 filas). RLS es la frontera, no este fichero.
 *
 * Responde `ok:true` aunque no hubiera nada que borrar: apagar un interruptor
 * que ya estaba apagado no es un error, y devolver 404 obligaria a la interfaz
 * a distinguir dos casos que para el usuario son el mismo.
 */

import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  if (!data?.claims) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let endpoint = ''
  try {
    const body = (await request.json()) as { endpoint?: unknown }
    endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : ''
  } catch {
    return Response.json({ ok: false, error: 'cuerpo no es JSON' }, { status: 400 })
  }

  if (!endpoint) return Response.json({ ok: false, error: 'falta endpoint' }, { status: 400 })

  const { data: removed, error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .select('id')

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })

  return Response.json({ ok: true, removed: removed?.length ?? 0 })
}
