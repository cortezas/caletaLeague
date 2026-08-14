import type { Metadata } from 'next'
import Link from 'next/link'

import { confirmAction } from './actions'

export const metadata: Metadata = { title: 'Entrar · La Caleta League' }

/**
 * Aterrizaje del enlace magico.
 *
 * ABRIR ESTA PAGINA NO CANJEA NADA. Solo la pinta. El canje va en
 * `confirmAction`, detras del boton.
 *
 * Antes el canje vivia en el GET de un route handler, y eso quemaba el enlace
 * sin que nadie lo tocara: WhatsApp y Telegram visitan las URL para sacar la
 * vista previa, los antivirus de correo las escanean, y algunos clientes las
 * precargan. Medido en produccion el 14/08/2026: un enlace generado a las
 * 09:20:15 constaba usado a las 09:20:15, antes de que su destinatario lo
 * tuviera. Al pinchar, "enlace caducado".
 *
 * D10 sigue en pie: se verifica con `token_hash` + `verifyOtp`, nunca con
 * `exchangeCodeForSession`. Con PKCE el verificador vive en el navegador que
 * pidio el enlace, y en el movil el correo se abre en otro.
 */
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string }>
}) {
  const params = await searchParams
  const tokenHash = params.token_hash ?? ''
  const type = params.type ?? ''
  const next = params.next ?? '/jornada'

  const falta = tokenHash === '' || type === ''

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center px-[26px] py-[64px]">
      <div className="mb-[22px] flex size-[62px] items-center justify-center rounded-[20px] bg-accent shadow-[0_10px_30px_var(--accent-soft)]">
        <span className="font-num text-[27px] font-extrabold text-accent-ink">LCL</span>
      </div>

      <h1 className="mb-[10px] text-[28px] font-extrabold leading-[1.1] tracking-[-0.03em] text-txt">
        {falta ? 'Falta algo en el enlace' : 'Ya casi estás'}
      </h1>

      <p className="mb-[30px] max-w-[300px] text-[15px] leading-[1.5] text-txt2">
        {falta
          ? 'Este enlace está incompleto. Pídele otro al organizador de la peña.'
          : 'Pulsa el botón para entrar. Solo funciona una vez, así que hazlo desde el móvil donde quieras tener la app.'}
      </p>

      {falta ? (
        <Link
          href="/login"
          className="flex min-h-[54px] w-full items-center justify-center rounded-[16px] bg-accent px-[20px] text-[16px] font-extrabold text-accent-ink transition-transform duration-100 active:scale-[.97] active:opacity-90"
        >
          Ir a la pantalla de entrada
        </Link>
      ) : (
        // La accion va directa al `action` del form, sin `useActionState`: asi
        // Next genera un POST de verdad y esto entra AUNQUE NO HAYA JAVASCRIPT.
        // Es el camino por el que entra toda la peña; no puede depender de que
        // hidrate el cliente.
        <form action={confirmAction} className="w-full">
          <input type="hidden" name="token_hash" value={tokenHash} />
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="next" value={next} />
          <button
            type="submit"
            className="flex min-h-[54px] w-full items-center justify-center rounded-[16px] bg-accent px-[20px] text-[16px] font-extrabold text-accent-ink shadow-[0_8px_24px_var(--accent-soft)] transition-transform duration-100 active:scale-[.97] active:opacity-90"
          >
            Entrar en La Caleta League
          </button>
        </form>
      )}
    </main>
  )
}
