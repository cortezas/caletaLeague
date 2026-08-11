import { Trophy } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { EmptyState, ScreenHeader } from '@/components/ui'
import { Podium } from '@/features/standings/podium'
import { StandingsRow } from '@/features/standings/standings-row'
import { requireMember } from '@/lib/auth'
import { getActiveGameweek, getSeasonStandings } from '@/lib/data'

export const metadata: Metadata = { title: 'Clasificación · La Caleta League' }

/**
 * Pantalla 6. El segmentado General / Por jornada NO es estado local: son dos
 * rutas distintas, asi que se resuelve con enlaces (que ademas prefetchan).
 */
export default async function ClasificacionPage() {
  // D13: la guarda de pertenencia va al principio de cada pantalla protegida.
  await requireMember()
  const [standings, gameweek] = await Promise.all([getSeasonStandings(), getActiveGameweek()])

  const podium = standings.rows.slice(0, 3)
  const rest = standings.rows.slice(3)

  return (
    <>
      <ScreenHeader title="Clasificación" size="lg">
        <div className="flex gap-[3px] rounded-[13px] bg-sunk p-[3px]">
          <span
            aria-current="page"
            className="flex min-h-[40px] flex-1 items-center justify-center rounded-[11px] bg-card text-[13.5px] font-bold text-txt"
          >
            General
          </span>
          <Link
            href={`/clasificacion/jornada/${gameweek.number}`}
            className="flex min-h-[40px] flex-1 items-center justify-center rounded-[11px] text-[13.5px] font-bold text-txt3 transition-transform duration-100 active:scale-[.97] active:opacity-90"
          >
            Por jornada
          </Link>
        </div>
      </ScreenHeader>

      {standings.rows.length === 0 ? (
        <EmptyState
          icon={<Trophy size={34} strokeWidth={1.9} aria-hidden />}
          title="Todavía no hay clasificación"
          description="En cuanto se juegue el primer partido de la peña, aquí aparece quién manda."
        />
      ) : (
        <div className="px-[14px] pt-[18px] pb-[30px]">
          <Podium rows={podium} />
          <ul className="flex flex-col gap-[6px]">
            {rest.map((row) => (
              <StandingsRow key={row.memberId} row={row} />
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
