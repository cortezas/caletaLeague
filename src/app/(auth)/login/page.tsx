import type { Metadata } from 'next'
import Link from 'next/link'

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

export default async function LoginPage() {
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
