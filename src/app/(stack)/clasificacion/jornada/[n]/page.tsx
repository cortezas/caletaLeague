import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ScreenHeader } from '@/components/ui'
import { GameweekAccordion } from '@/features/standings/gameweek-accordion'
import { requireMember } from '@/lib/auth'
import { getGameweekStandings } from '@/lib/data'

export const metadata: Metadata = { title: 'Clasificación por jornada · La Caleta League' }

const NAV_BUTTON =
  'flex min-h-[44px] min-w-[44px] flex-none items-center justify-center rounded-[13px] border border-line bg-card'

/**
 * D2: `params` es una promesa y se resuelve con await. Nada de PageProps generados.
 */
export default async function ClasificacionJornadaPage({
  params,
}: {
  params: Promise<{ n: string }>
}) {
  // D13: la guarda de pertenencia va al principio de cada pantalla protegida.
  await requireMember()

  const { n } = await params
  const jornada = Number(n)
  if (!Number.isInteger(jornada) || jornada < 1) notFound()

  const standings = await getGameweekStandings(jornada)
  if (!standings) notFound()

  return (
    <>
      <ScreenHeader title="Clasificación" size="lg" backHref="/clasificacion">
        <div className="flex gap-[3px] rounded-[13px] bg-sunk p-[3px]">
          <Link
            href="/clasificacion"
            className="flex min-h-[40px] flex-1 items-center justify-center rounded-[11px] text-[13.5px] font-bold text-txt3 transition-transform duration-100 active:scale-[.97] active:opacity-90"
          >
            General
          </Link>
          <span
            aria-current="page"
            className="flex min-h-[40px] flex-1 items-center justify-center rounded-[11px] bg-card text-[13.5px] font-bold text-txt"
          >
            Por jornada
          </span>
        </div>
      </ScreenHeader>

      <div className="px-[14px] pt-[14px] pb-[30px]">
        <nav aria-label="Cambiar de jornada" className="mb-[14px] flex items-center gap-[10px]">
          {standings.hasPrev ? (
            <Link
              href={`/clasificacion/jornada/${jornada - 1}`}
              aria-label={`Ir a la jornada ${jornada - 1}`}
              className={`${NAV_BUTTON} text-txt transition-transform duration-100 active:scale-[.97] active:opacity-90`}
            >
              <ChevronLeft size={17} strokeWidth={2.3} aria-hidden />
            </Link>
          ) : (
            <button type="button" disabled aria-disabled="true" aria-label="No hay jornada anterior" className={`${NAV_BUTTON} text-txt3 opacity-50`}>
              <ChevronLeft size={17} strokeWidth={2.3} aria-hidden />
            </button>
          )}

          <div className="flex-1 text-center">
            <p className="font-num text-[24px] font-extrabold leading-[1.05]">JORNADA {standings.number}</p>
            <p className="text-[11.5px] font-semibold text-txt3">{standings.statusLabel}</p>
          </div>

          {standings.hasNext ? (
            <Link
              href={`/clasificacion/jornada/${jornada + 1}`}
              aria-label={`Ir a la jornada ${jornada + 1}`}
              className={`${NAV_BUTTON} text-txt transition-transform duration-100 active:scale-[.97] active:opacity-90`}
            >
              <ChevronRight size={17} strokeWidth={2.3} aria-hidden />
            </Link>
          ) : (
            <button type="button" disabled aria-disabled="true" aria-label="No hay jornada siguiente" className={`${NAV_BUTTON} text-txt3 opacity-50`}>
              <ChevronRight size={17} strokeWidth={2.3} aria-hidden />
            </button>
          )}
        </nav>

        <GameweekAccordion rows={standings.rows} />
      </div>
    </>
  )
}
