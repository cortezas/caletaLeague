'use client'

import { Button, ErrorState, ScreenHeader } from '@/components/ui'

/**
 * Next 16: la firma es { error, unstable_retry }. `reset` ya no existe, y
 * `unstable_retry` vuelve a pedir los datos del segmento, no solo limpia el
 * estado del boundary.
 */
export default function PredictError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  return (
    <>
      <ScreenHeader size="sm" backHref="/jornada" title="Pronóstico" />
      <ErrorState
        title="Sin conexión"
        description="No hemos podido cargar este partido. Tus pronósticos guardados están a salvo: se enviarán solos en cuanto vuelvas."
        action={
          <div className="flex flex-col items-center gap-[10px]">
            <Button variant="primary" onClick={() => unstable_retry()}>
              Reintentar
            </Button>
            {error.digest && (
              <p className="font-num text-[12px] tracking-wide text-txt3">Ref. {error.digest}</p>
            )}
          </div>
        }
      />
    </>
  )
}
