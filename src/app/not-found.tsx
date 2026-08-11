import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[420px] flex-col items-center justify-center gap-[18px] px-[26px] text-center">
      <div className="flex size-[78px] items-center justify-center rounded-[26px] bg-card text-txt3 shadow-card">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </div>
      <h1 className="text-[24px] font-extrabold tracking-[-0.03em]">Por aquí no hay nada</h1>
      <p className="text-[14px] leading-relaxed text-txt2">
        Esta pantalla no existe. Puede que el enlace esté mal o que la jornada ya haya pasado.
      </p>
      <Link
        href="/jornada"
        className="mt-[6px] flex min-h-[52px] w-full items-center justify-center rounded-[16px] bg-accent px-[20px] text-[16px] font-extrabold text-accent-ink transition-transform duration-100 active:scale-[.97] active:opacity-90"
      >
        Volver a la jornada
      </Link>
    </main>
  )
}
