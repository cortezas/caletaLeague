'use client'

import { Button, ErrorState } from '@/components/ui'

/**
 * Red de seguridad de TODAS las pantallas con barra de pestañas.
 *
 * Antes solo /jornada tenia boundary: un fallo en /clasificacion, /perfil o
 * /ajustes subia hasta `global-error.tsx`, que sustituye <html> y <body> enteros
 * y se lleva por delante la barra de pestañas. Para un corte de red de tres
 * segundos eso es una pantalla en negro y una app que parece rota.
 *
 * Aqui el fallo se queda dentro del <main>: la barra sigue puesta y se puede
 * saltar a otra pestaña sin recargar. El error.tsx de /jornada sigue existiendo
 * y gana sobre este, porque su texto habla de los pronosticos guardados.
 *
 * Next 16: la firma es { error, unstable_retry }. `reset` ya no existe, y
 * `unstable_retry` vuelve a pedir los datos en vez de limpiar solo el boundary.
 */
export default function TabsError({
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
            {error.digest && (
              <p className="font-num text-[12px] tracking-wide text-txt3">Ref. {error.digest}</p>
            )}
          </div>
        }
      />
    </div>
  )
}
