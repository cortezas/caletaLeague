'use client'

import { Button, ErrorState } from '@/components/ui'

/**
 * Next 16: la firma es { error, unstable_retry }. `reset` ya no existe, y
 * `unstable_retry` vuelve a pedir los datos en vez de limpiar solo el boundary.
 */
export default function JornadaError({
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
        description="No hemos podido cargar la jornada. Tus pronósticos guardados están a salvo: se enviarán solos en cuanto vuelvas."
        action={
          <div className="flex flex-col items-center gap-[10px]">
            <Button variant="primary" size="sm" onClick={() => unstable_retry()}>
              Reintentar
            </Button>
            {error.digest && (
              <p className="font-num text-[12px] tracking-wide text-txt3">Ref. {error.digest}</p>
            )}
          </div>
        }
      />
    </div>
  )
}
