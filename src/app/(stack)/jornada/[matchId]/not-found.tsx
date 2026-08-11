import { SearchX } from 'lucide-react'
import Link from 'next/link'

import { EmptyState, ScreenHeader } from '@/components/ui'

/** El partido no existe, o es de otra pena y RLS no lo deja ver. */
export default function PredictNotFound() {
  return (
    <>
      <ScreenHeader size="sm" backHref="/jornada" title="Partido no encontrado" />
      <EmptyState
        icon={<SearchX size={34} strokeWidth={1.8} />}
        title="Ese partido no existe"
        description="Puede que el enlace esté mal, o que el partido sea de otra jornada que ya no está en juego."
        action={
          <Link
            href="/jornada"
            className="flex min-h-[52px] items-center justify-center rounded-[16px] bg-accent px-[22px] text-[15.5px] font-extrabold text-accent-ink shadow-[0_8px_24px_var(--accent-soft)] transition-transform duration-100 active:scale-[.97] active:opacity-90"
          >
            Volver a la jornada
          </Link>
        }
      />
    </>
  )
}
