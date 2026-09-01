/**
 * El dinero: lo que debe cada uno del bote, lo que ha pagado y lo que le queda.
 *
 * `season_dues()` (migracion 0023) solo sabe lo que se DEBE. Lo que se ha
 * cobrado no estaba en ningun sitio y el organizador lo llevaba de cabeza.
 *
 * Los pagos se guardan uno a uno y no como un saldo (migracion 0032): un saldo
 * no se puede auditar ni deshacer, y aqui una cifra mal metida es dinero de
 * verdad entre companeros. Con el historial, un error se borra y ya esta -- por
 * eso esta pantalla ensena los ultimos movimientos y no solo el total.
 *
 * SOLO SERVIDOR.
 */

import { requireAdmin } from '@/lib/auth'
import { createClient, isSupabaseConfigured } from '@/lib/supabase/server'

export type BalanceRowVM = {
  memberId: string
  displayName: string
  avatarColor: string
  avatarUrl: string | null
  /** Lo que le ha tocado pagar por quedar entre los tres ultimos. */
  debido: number
  pagado: number
  /** Nunca negativo: quien paga de mas se queda a cero y el exceso se ve en `pagado`. */
  pendiente: number
}

export type PaymentVM = {
  id: string
  memberId: string
  displayName: string
  euros: number
  nota: string | null
  /** Ya formateada en Europe/Madrid. */
  cuando: string
}

export type MoneyVM = {
  rows: BalanceRowVM[]
  totales: { debido: number; pagado: number; pendiente: number }
  /** Los ultimos movimientos, para poder deshacer una cifra mal metida. */
  ultimos: PaymentVM[]
}

const VACIO: MoneyVM = { rows: [], totales: { debido: 0, pagado: 0, pendiente: 0 }, ultimos: [] }

function cuandoLabel(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  return at.toLocaleDateString('es-ES', {
    timeZone: 'Europe/Madrid',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export async function getMoney(): Promise<MoneyVM> {
  await requireAdmin()
  if (!isSupabaseConfigured) return VACIO

  const supabase = await createClient()

  // `season_balance()` filtra por la liga del que pregunta, asi que no hace falta
  // pasarle nada. Va con la sesion del organizador, no con service role: aqui no
  // hay nada que RLS no deje ver a un miembro.
  const [{ data: saldos, error }, { data: miembros }, { data: pagos }] = await Promise.all([
    supabase.rpc('season_balance'),
    supabase.from('members').select('id, display_name, avatar_color, avatar_url'),
    supabase
      .from('payments')
      .select('id, member_id, euros, nota, paid_at')
      .order('paid_at', { ascending: false })
      .limit(30),
  ])
  // Un fallo aqui no puede tumbar el panel entero: se devuelve vacio y la
  // seccion lo dice. El resto de pestañas siguen funcionando.
  if (error) return VACIO

  type Miembro = { id: string; display_name: string; avatar_color: string; avatar_url: string | null }
  const porId = new Map<string, Miembro>()
  for (const m of (miembros ?? []) as Miembro[]) porId.set(m.id, m)

  type Saldo = { member_id: string; debido: number; pagado: number; pendiente: number }
  const rows = ((saldos ?? []) as unknown as Saldo[])
    .map((s) => {
      const m = porId.get(s.member_id)
      if (!m) return null
      return {
        memberId: s.member_id,
        displayName: m.display_name,
        avatarColor: m.avatar_color,
        avatarUrl: m.avatar_url,
        debido: s.debido,
        pagado: s.pagado,
        pendiente: s.pendiente,
      }
    })
    .filter((r): r is BalanceRowVM => r !== null)
    // Primero quien mas debe: la lista existe para saber a quien hay que
    // perseguir, no para leer nombres por orden alfabetico.
    .sort(
      (a, b) =>
        b.pendiente - a.pendiente ||
        b.debido - a.debido ||
        a.displayName.localeCompare(b.displayName, 'es'),
    )

  const totales = rows.reduce(
    (acc, r) => ({
      debido: acc.debido + r.debido,
      pagado: acc.pagado + r.pagado,
      pendiente: acc.pendiente + r.pendiente,
    }),
    { debido: 0, pagado: 0, pendiente: 0 },
  )

  type Pago = { id: string; member_id: string; euros: number; nota: string | null; paid_at: string }
  const ultimos = ((pagos ?? []) as Pago[]).map((p) => ({
    id: p.id,
    memberId: p.member_id,
    displayName: porId.get(p.member_id)?.display_name ?? '(alguien que ya no está)',
    euros: p.euros,
    nota: p.nota,
    cuando: cuandoLabel(p.paid_at),
  }))

  return { rows, totales, ultimos }
}
