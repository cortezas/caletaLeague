'use client'

import './globals.css'

/**
 * Solo se dispara si peta el propio root layout. Sustituye a <html>/<body>,
 * asi que no hereda fuentes ni ToastProvider: se mantiene autocontenido.
 *
 * `unstable_retry` (Next 16.2) reintenta el render del arbol; `reset` solo
 * limpiaria el estado del boundary sin volver a pedir los datos.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  return (
    <html lang="es" data-theme="dark">
      <body className="min-h-dvh bg-bg text-txt antialiased">
        <main className="mx-auto flex min-h-dvh max-w-[420px] flex-col items-center justify-center gap-[18px] px-[26px] text-center">
          <div className="flex size-[78px] items-center justify-center rounded-[26px] bg-bad-soft text-bad">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            </svg>
          </div>
          <h1 className="text-[24px] font-extrabold tracking-[-0.03em]">Algo se ha roto</h1>
          <p className="text-[14px] leading-relaxed text-txt2">
            La app no ha podido arrancar. Tus pronósticos guardados están a salvo.
          </p>
          {error.digest && (
            <p className="font-num text-[12px] tracking-wide text-txt3">Ref. {error.digest}</p>
          )}
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="mt-[6px] min-h-[52px] w-full rounded-[16px] bg-accent px-[20px] text-[16px] font-extrabold text-accent-ink transition-transform duration-100 active:scale-[.97] active:opacity-90"
          >
            Reintentar
          </button>
        </main>
      </body>
    </html>
  )
}
