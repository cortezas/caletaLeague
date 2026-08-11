import { EyeOff } from 'lucide-react'
import Link from 'next/link'

import { EmptyState, ScreenHeader } from '@/components/ui'

/**
 * Se llega aqui tanto si el partido no existe como si existe pero aun no se ha
 * jugado: hasta el pitido final los pronosticos de los demas no se revelan.
 */
export default function PartidoNotFound() {
  return (
    <>
      <ScreenHeader title="Aquí no hay pique" size="sm" backHref="/jornada" />
      <EmptyState
        icon={<EyeOff size={34} strokeWidth={1.9} aria-hidden />}
        title="Todavía no se puede mirar"
        description="Este partido no existe o aún no ha terminado. Los pronósticos de la peña se revelan cuando el partido acaba."
        action={
          <Link
            href="/jornada"
            className="flex min-h-[52px] items-center justify-center rounded-[16px] border border-line2 bg-card px-[22px] text-[15.5px] font-extrabold text-txt transition-transform duration-100 active:scale-[.97] active:opacity-90"
          >
            Volver a la jornada
          </Link>
        }
      />
    </>
  )
}
