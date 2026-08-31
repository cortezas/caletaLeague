import type { Metadata } from 'next'
import Link from 'next/link'

import { enterWithCodeAction } from './code-actions'
import { LoginForm } from './login-form'

export const metadata: Metadata = {
  title: 'Entrar · La Caleta League',
  description: 'Entra en La Caleta League con un enlace mágico. Sin contraseñas.',
}

/**
 * Degradado del handoff (pantalla 1). Va en `style` y no en una utilidad de
 * Tailwind porque referencia el token de acento en vivo: asi cambia solo al
 * pasar a tema claro.
 */
const BACKDROP = 'radial-gradient(120% 60% at 50% 0%, var(--accent-soft) 0%, transparent 62%), var(--bg)'

export default async function LoginPage({
  searchParams,
}: {
  // En Next 16 `searchParams` es una promesa (D5).
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { error } = await searchParams
  const codigoMal = error === 'codigo'

  return (
    <main
      // 96/26/40 del prototipo, con `max()` para que en un iPhone con notch el
      // contenido nunca quede por debajo de la barra de estado.
      className="flex min-h-dvh flex-col justify-between px-[26px] pt-[max(96px,env(safe-area-inset-top))] pb-[max(40px,env(safe-area-inset-bottom))]"
      style={{ background: BACKDROP }}
    >
      <div>
        <div className="mb-[26px] flex size-[62px] items-center justify-center rounded-[20px] bg-accent font-num text-[27px] font-extrabold tracking-[.02em] text-accent-ink shadow-[0_10px_30px_var(--accent-soft)]">
          LCL
        </div>

        <h1 className="mb-[8px] text-[31px] font-extrabold leading-[1.08] tracking-[-0.03em] text-txt">
          La Caleta
          <br />
          League
        </h1>

        <p className="mb-[34px] max-w-[280px] text-[15px] leading-[1.5] text-txt2">
          La peña de pronósticos de la oficina. Nadie ve tu pronóstico hasta el pitido inicial.
          Cero excusas.
        </p>

        <LoginForm />

        {/* Servidor puro y sin `useActionState`, igual que /auth/confirm: asi el
            POST sale aunque el JavaScript no haya cargado. Es justo la pantalla
            donde eso importa, porque quien llega aqui es alguien a quien la app
            acaba de dejar fuera. */}
        <div className="mt-[26px] border-t border-line pt-[22px]">
          <p className="mb-[10px] text-[13px] font-bold text-txt2">¿Tienes tu código personal?</p>
          <form action={enterWithCodeAction} className="flex flex-col gap-[10px]">
            <input
              name="code"
              type="text"
              inputMode="text"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="ABCD-2K9P"
              aria-label="Tu código personal"
              aria-invalid={codigoMal || undefined}
              required
              className="min-h-[52px] w-full rounded-[14px] border border-line2 bg-card px-[15px] text-center font-num text-[19px] font-extrabold uppercase tracking-[.22em] text-txt placeholder:tracking-[.12em] placeholder:text-txt3 focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              className="flex min-h-[52px] w-full items-center justify-center rounded-[16px] border border-line2 bg-card px-[20px] text-[15px] font-extrabold text-txt transition-transform duration-100 active:scale-[.97] active:opacity-90"
            >
              Entrar con mi código
            </button>
          </form>

          {codigoMal && (
            <p className="mt-[10px] text-[12.5px] font-semibold leading-[1.45] text-bad">
              Ese código no vale. Míralo otra vez: son 8 caracteres y no llevan ni la letra O ni la
              I. Si lo has perdido, pídele otro a Raúl.
            </p>
          )}

          <p className="mt-[10px] text-[11.5px] font-semibold leading-[1.45] text-txt3">
            No caduca y sirve siempre. Guárdatelo donde no se te pierda.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center gap-[6px] text-[12.5px] text-txt3">
        <span>¿Te han pasado un código?</span>
        <Link
          href="/onboarding"
          className="inline-flex min-h-[44px] items-center px-[2px] text-[12.5px] font-bold text-accent transition-transform duration-100 active:scale-[.97] active:opacity-90"
        >
          Únete a la peña
        </Link>
      </div>
    </main>
  )
}
