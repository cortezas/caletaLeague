import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ScreenHeader } from '@/components/ui'
import { Highlights } from '@/features/pique/highlights'
import { PiqueRow } from '@/features/pique/pique-row'
import { ResultHeader } from '@/features/pique/result-header'
import { requireMember } from '@/lib/auth'
import { getMatchPique } from '@/lib/data'
import { formatKickoff } from '@/lib/format'

export const metadata: Metadata = { title: 'El pique · La Caleta League' }

/** Pantalla 8: el pique. Solo existe para partidos jugados y ya revelados. */
export default async function PartidoPage({ params }: { params: Promise<{ matchId: string }> }) {
  // D13: la guarda de pertenencia va al principio de cada pantalla protegida.
  await requireMember()

  const { matchId } = await params

  const pique = await getMatchPique(matchId)
  if (!pique) notFound()

  const { match, highlights, rows, memberCount } = pique

  return (
    <>
      <ScreenHeader
        title={`${match.home.name} – ${match.away.name}`}
        subtitle={`${formatKickoff(match.kickoffAt, 'long')} · Finalizado`}
        size="sm"
        backHref="/jornada"
      />

      <div className="flex flex-col gap-[12px] px-[14px] pt-[16px] pb-[30px]">
        <ResultHeader match={match} />
        <Highlights items={highlights} />

        <div className="mt-[4px] flex items-baseline justify-between">
          <h2 className="text-[15px] font-extrabold tracking-[-.02em]">Qué puso cada uno</h2>
          <p className="text-[11.5px] font-bold text-txt3">{memberCount} de la peña</p>
        </div>

        <ul className="flex flex-col gap-[6px]">
          {rows.map((row) => (
            <PiqueRow key={row.memberId} row={row} />
          ))}
        </ul>
      </div>
    </>
  )
}
