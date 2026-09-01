'use client'

import { Euro, Trash2, Undo2 } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'

import { Avatar, Button, Chip, TextInput, useToast } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { MoneyVM } from '@/lib/data/payments'

import { addPaymentAction, deletePaymentAction, type MoneyState } from './money-actions'

/** Estado inicial. Aqui y no en las acciones: de un 'use server' solo salen funciones. */
const NADA: MoneyState = { ok: false, error: null, mensaje: null }

const LABEL = 'mb-[7px] block text-[11px] font-extrabold uppercase tracking-[.11em] text-txt3'

/**
 * El dinero del bote: quien debe, quien ha pagado y quien queda a deber.
 *
 * `season_dues()` solo sabe lo que se DEBE. Lo que se ha cobrado no estaba en
 * ningun sitio, asi que esto se llevaba de cabeza y de memoria.
 *
 * Se apunta pago a pago, no un saldo: un saldo no se puede deshacer, y aqui una
 * cifra mal metida es dinero de verdad entre companeros. Por eso abajo salen los
 * ultimos movimientos con su papelera -- corregir es borrar la linea mala y
 * poner la buena, y asi el historial cuenta lo que paso.
 */
export function AdminMoneyForm({ money }: { money: MoneyVM }) {
  const showToast = useToast()
  const [addState, addAction, guardando] = useActionState(addPaymentAction, NADA)
  const [delState, delAction, borrando] = useActionState(deletePaymentAction, NADA)

  /** A quien se le esta apuntando el pago. `null` = el formulario esta cerrado. */
  const [cobrando, setCobrando] = useState<{ id: string; nombre: string; pendiente: number } | null>(
    null,
  )

  // Ajuste en render y no en un efecto: cerrar el formulario depende de la
  // respuesta que hay en pantalla, no de ningun sistema externo. Mismo patron
  // que `edit-profile.tsx` y que el borrado de miembros.
  const [visto, setVisto] = useState(addState)
  if (visto !== addState) {
    setVisto(addState)
    if (addState.ok) setCobrando(null)
  }

  useEffect(() => {
    if (addState.ok && addState.mensaje) showToast(addState.mensaje)
    else if (addState.error) showToast(addState.error, 'bad')
  }, [addState, showToast])

  useEffect(() => {
    if (delState.ok && delState.mensaje) showToast(delState.mensaje)
    else if (delState.error) showToast(delState.error, 'bad')
  }, [delState, showToast])

  const { totales } = money
  const conDeuda = money.rows.filter((r) => r.debido > 0)

  return (
    <div className="flex flex-col gap-[13px] px-[14px] pt-[14px] pb-[30px]">
      {/* El resumen primero: es lo que se mira al abrir. */}
      <div className="rounded-[17px] border border-line bg-card px-[14px] py-[13px]">
        <div className="mb-[10px] flex items-center gap-[8px]">
          <Euro size={15} strokeWidth={2.4} aria-hidden className="flex-none text-accent2" />
          <span className="text-[13px] font-extrabold">El bote</span>
        </div>
        <div className="flex gap-[9px]">
          {[
            { k: 'Acumulado', v: totales.debido, tone: 'text-txt' },
            { k: 'Cobrado', v: totales.pagado, tone: 'text-ok' },
            { k: 'Te deben', v: totales.pendiente, tone: 'text-bad' },
          ].map((c) => (
            <div key={c.k} className="flex-1 rounded-[13px] bg-sunk px-[11px] py-[10px]">
              <p className="text-[10.5px] font-extrabold uppercase tracking-[.08em] text-txt3">
                {c.k}
              </p>
              <p className={cn('font-num text-[21px] font-extrabold tabular-nums', c.tone)}>
                {c.v} €
              </p>
            </div>
          ))}
        </div>
      </div>

      {conDeuda.length === 0 ? (
        <p className="rounded-[14px] border border-line bg-card px-[13px] py-[11px] text-[12.5px] font-semibold leading-[1.45] text-txt2">
          Todavía no debe nadie. Los euros aparecen cuando se acaba una jornada entera: el último
          paga 3 €, el penúltimo 2 y el antepenúltimo 1.
        </p>
      ) : (
        <ul className="flex flex-col gap-[9px]">
          {conDeuda.map((row) => (
            <li
              key={row.memberId}
              className="rounded-[17px] border border-line bg-card px-[13px] py-[11px]"
            >
              <div className="flex items-center gap-[10px]">
                <Avatar
                  name={row.displayName}
                  color={row.avatarColor}
                  photoUrl={row.avatarUrl}
                  size={32}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-extrabold text-txt">
                    {row.displayName}
                  </span>
                  <span className="block text-[11.5px] font-semibold text-txt3">
                    Debe {row.debido} € · pagado {row.pagado} €
                  </span>
                </span>

                {row.pendiente === 0 ? (
                  <Chip tone="ok">Al día</Chip>
                ) : (
                  <span className="font-num text-[17px] font-extrabold tabular-nums text-bad">
                    {row.pendiente} €
                  </span>
                )}

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setCobrando(
                      cobrando?.id === row.memberId
                        ? null
                        : {
                            id: row.memberId,
                            nombre: row.displayName,
                            pendiente: row.pendiente,
                          },
                    )
                  }
                >
                  {cobrando?.id === row.memberId ? 'Cerrar' : 'Cobrar'}
                </Button>
              </div>

              {cobrando?.id === row.memberId && (
                <form action={addAction} className="mt-[11px] flex flex-col gap-[9px]">
                  <input type="hidden" name="memberId" value={row.memberId} readOnly />
                  <input type="hidden" name="name" value={row.displayName} readOnly />
                  <div className="flex gap-[9px]">
                    <label className="flex-1">
                      <span className={LABEL}>Euros</span>
                      <TextInput
                        inputSize="lg"
                        name="euros"
                        type="text"
                        inputMode="numeric"
                        // Lo normal es que salde del todo, asi que viene puesto.
                        defaultValue={String(row.pendiente)}
                        required
                        autoComplete="off"
                      />
                    </label>
                    <label className="flex-[1.4]">
                      <span className={LABEL}>Nota (opcional)</span>
                      <TextInput
                        inputSize="lg"
                        name="nota"
                        type="text"
                        placeholder="en mano, bizum..."
                        autoComplete="off"
                        maxLength={120}
                      />
                    </label>
                  </div>
                  <Button type="submit" variant="primary" size="lg" fullWidth loading={guardando}>
                    Apuntar el pago
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {money.ultimos.length > 0 && (
        <div className="rounded-[17px] border border-line bg-card px-[14px] py-[13px]">
          <div className="mb-[4px] flex items-center gap-[8px]">
            <Undo2 size={15} strokeWidth={2.3} aria-hidden className="flex-none text-txt3" />
            <span className="text-[13px] font-extrabold">Últimos movimientos</span>
          </div>
          <p className="mb-[10px] text-[11.5px] font-semibold leading-[1.45] text-txt3">
            No hay editar: para corregir una cifra, se borra la línea y se vuelve a apuntar.
          </p>
          <ul className="divide-y divide-line">
            {money.ultimos.map((pago) => (
              <li key={pago.id} className="flex items-center gap-[10px] py-[8px]">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold text-txt">
                    {pago.displayName}
                  </span>
                  <span className="block truncate text-[11.5px] font-semibold text-txt3">
                    {pago.cuando}
                    {pago.nota ? ` · ${pago.nota}` : ''}
                  </span>
                </span>
                <span className="flex-none font-num text-[15px] font-extrabold tabular-nums text-ok">
                  {pago.euros} €
                </span>
                <form action={delAction} className="flex-none">
                  <input type="hidden" name="paymentId" value={pago.id} readOnly />
                  <button
                    type="submit"
                    disabled={borrando}
                    aria-label={`Borrar el pago de ${pago.euros} € de ${pago.displayName}`}
                    className="flex size-[34px] items-center justify-center rounded-[10px] border border-line text-txt3 transition-transform duration-100 active:scale-[.94] disabled:opacity-50"
                  >
                    <Trash2 size={15} strokeWidth={2.3} aria-hidden />
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
