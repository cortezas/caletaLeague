'use client'

import Link from 'next/link'

import { Button, ErrorState } from '@/components/ui'

/**
 * Red de seguridad de las pantallas de pila: pronostico, resumen, pique y admin.
 *
 * Estas no tenian ninguna, asi que un fallo de red en /partido/[id] o en
 * /clasificacion/jornada/[n] subia hasta `global-error.tsx` y borraba la app
 * entera. Aqui ademas del reintento va una salida a /jornada: en una pantalla de
 * pila sin cabecera renderizada no hay boton de volver, y sin esto la unica
 * forma de salir seria el gesto del navegador.
 *
 * Next 16: la firma es { error, unstable_retry }; `reset` ya no existe.
 */
export default function StackError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  return (
    <div className="pt-[calc(env(safe-area-inset-top)+14px)]">
      <ErrorState
        title="Sin conexión"
        description="No hemos podido cargar esta pantalla. Vuelve a intentarlo: no se ha perdido nada de lo que tenías guardado."
        action={
          <div className="flex flex-col items-center gap-[10px]">
            <Button variant="primary" size="sm" onClick={() => unstable_retry()}>
              Reintentar
            </Button>
            <Link
              href="/jornada"
              className="inline-flex min-h-[44px] items-center px-[8px] text-[13.5px] font-bold text-txt3 transition-transform duration-100 active:scale-[.97] active:opacity-90"
            >
              Volver a la jornada
            </Link>
            {error.digest && (
              <p className="font-num text-[12px] tracking-wide text-txt3">Ref. {error.digest}</p>
            )}
          </div>
        }
      />
    </div>
  )
}
