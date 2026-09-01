import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ScreenHeader } from '@/components/ui'
import { LineupSection } from '@/features/lineups/lineup-section'
import { Highlights } from '@/features/pique/highlights'
import { LiveRefresher } from '@/features/pique/live-refresher'
import { PiqueRow } from '@/features/pique/pique-row'
import { ResultHeader } from '@/features/pique/result-header'
import { requireMember } from '@/lib/auth'
import { getMatchPique, getMatchLineups } from '@/lib/data'
import { formatKickoff } from '@/lib/format'

export const metadata: Metadata = { title: 'El pique · La Caleta League' }

/**
 * Pantalla 8: el pique. Se abre en el PITIDO INICIAL, no al final: ese es el
 * momento en que la RLS destapa los pronosticos ajenos y justo cuando la peña
 * quiere ver que puso cada uno.
 */
export default async function PartidoPage({ params }: { params: Promise<{ matchId: string }> }) {
  // D13: la guarda de pertenencia va al principio de cada pantalla protegida.
  await requireMember()

  const { matchId } = await params

  // Guardadas en nuestra base por el cron: la pantalla nunca llama a la API.
  const [pique, lineups] = await Promise.all([getMatchPique(matchId), getMatchLineups(matchId)])
  if (!pique) notFound()

  const { match, highlights, rows, memberCount, live } = pique

  return (
    <>
      <LiveRefresher live={live} />

      <ScreenHeader
        title={`${match.home.name} – ${match.away.name}`}
        subtitle={`${formatKickoff(match.kickoffAt, 'long')} · ${live ? 'En juego' : 'Finalizado'}`}
        size="sm"
        backHref="/jornada"
      />

      <div className="flex flex-col gap-[12px] px-[14px] pt-[16px] pb-[30px]">
        {/* Sin este aviso, un 2-1 con un solo goleador listado parece un fallo de
            la app. Es el proveedor, que publica los goles mas tarde que el
            marcador, y los puntos se recolocan cuando llegan. */}
        {live && (
          <p className="rounded-[14px] border border-line bg-bad-soft px-[13px] py-[11px] text-[12.5px] font-semibold leading-[1.45] text-txt2">
            El partido se está jugando: el marcador y los puntos son provisionales, y los goleadores
            pueden tardar en aparecer. Esto se actualiza solo cada minuto.
          </p>
        )}

        <ResultHeader match={match} />
        <LineupSection
          lineups={lineups}
          home={match.home}
          away={match.away}
          kickoffAt={match.kickoffAt}
        />
        <Highlights items={highlights} />

        <div className="mt-[4px] flex items-baseline justify-between">
          <h2 className="text-[15px] font-extrabold tracking-[-.02em]">Qué puso cada uno</h2>
          <p className="text-[11.5px] font-bold text-txt3">{memberCount} de la peña</p>
        </div>

        <ul className="flex flex-col gap-[6px]">
          {rows.map((row) => (
            <PiqueRow key={row.memberId} row={row} matchId={pique.match.id} />
          ))}
        </ul>
      </div>
    </>
  )
}
