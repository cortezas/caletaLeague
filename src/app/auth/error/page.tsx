import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Enlace no válido · La Caleta League',
}

const COPY = {
  expired: {
    title: 'Ese enlace ya no vale',
    description:
      'Los enlaces de acceso caducan a la hora y solo se pueden usar una vez. Pide uno nuevo y entra desde el mismo móvil donde abres el correo.',
  },
  invalid: {
    title: 'Enlace incompleto',
    description:
      'Al enlace le faltan datos o se ha roto por el camino. Algunos correos parten las URLs largas: prueba a copiarla entera o pide otro.',
  },
  config: {
    title: 'Acceso no configurado',
    description:
      'Todavía no hay proyecto de Supabase conectado a esta instalación, así que no se puede verificar ningún enlace.',
  },
} as const

// Cualquier `reason` desconocido cae en "caducado", que es el caso real en el
// 99% de las visitas a esta pantalla.
function resolveCopy(raw: string | undefined) {
  if (raw === 'invalid' || raw === 'config') return COPY[raw]
  return COPY.expired
}

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const { reason } = await searchParams
  const { title, description } = resolveCopy(reason)

  return (
    <main className="mx-auto flex min-h-dvh max-w-[420px] flex-col items-center justify-center gap-[18px] px-[26px] pt-[calc(env(safe-area-inset-top)+24px)] pb-[calc(env(safe-area-inset-bottom)+24px)] text-center">
      <div className="flex size-[78px] items-center justify-center rounded-[26px] bg-bad-soft text-bad">
        <svg
          width="34"
          height="34"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M10.6 13.4a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-.8.8" />
          <path d="M13.4 10.6a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l.8-.8" />
          <path d="m3 3 18 18" />
        </svg>
      </div>

      <h1 className="text-[24px] font-extrabold tracking-[-0.03em] text-txt">{title}</h1>
      <p className="text-[14px] leading-relaxed text-txt2">{description}</p>

      <Link
        href="/login"
        className="mt-[6px] flex min-h-[52px] w-full items-center justify-center rounded-[16px] bg-accent px-[20px] text-[16px] font-extrabold text-accent-ink shadow-[0_8px_22px_var(--accent-soft)] transition-transform duration-100 active:scale-[.97] active:opacity-90"
      >
        Pedir otro enlace
      </Link>

      <p className="text-[12px] leading-relaxed text-txt3">
        Truco: abre el correo en el navegador del móvil, no dentro de la app de correo.
      </p>
    </main>
  )
}
