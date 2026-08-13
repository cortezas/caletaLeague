import { notFound } from 'next/navigation'

import { ScreenHeader } from '@/components/ui'
import { LineupPoller } from '@/features/lineups/lineup-poller'
import { LineupSection } from '@/features/lineups/lineup-section'
import { PredictionForm } from '@/features/predict/prediction-form'
import { SealedCard } from '@/features/predict/sealed-card'
import { TopScorers } from '@/features/scorers/top-scorers'
import { requireMember } from '@/lib/auth'
import { getActiveGameweek, getMatchEditor, getMatchLineups, getTopScorers } from '@/lib/data'

/**
 * Veinte y no diez: es aproximadamente un jugador por club, asi que casi siempre
 * cae alguno de los dos equipos de ESTE partido, que es lo unico que hace util a
 * la lista aqui. Con diez, la mitad de los partidos la abririan para nada.
 */
const TOP_SCORERS_LIMIT = 20

/**
 * Pantallas 4 y 4b.
 *
 * D2: los params dinamicos se tipan a mano como Promise y se hace `await`.
 * Nada de los helpers `PageProps<'/...'>`, que dependen de `next typegen`.
 */
export default async function PredictPage({ params }: { params: Promise<{ matchId: string }> }) {
  // D13: la guarda de pertenencia va al principio de cada pantalla protegida.
  await requireMember()

  const { matchId } = await params

  // El numero de jornada no esta en PredictEditorVM y el subtitulo lo necesita.
  // Las alineaciones salen de nuestra base, no de la API: pedirlas aqui no gasta
  // ninguna peticion del plan gratuito aunque entren los doce a la vez.
  // Los goleadores tampoco salen de la API en vivo: es una tabla nuestra que
  // rellena la ingesta, asi que abrir el partido no gasta peticiones.
  const [editor, gameweek, lineups, scorers] = await Promise.all([
    getMatchEditor(matchId),
    getActiveGameweek(),
    getMatchLineups(matchId),
    getTopScorers(TOP_SCORERS_LIMIT),
  ])
  if (!editor) notFound()

  const { match } = editor

  return (
    <>
      <ScreenHeader
        size="sm"
        backHref="/jornada"
        title={`${match.home.name} – ${match.away.name}`}
        subtitle={`Jornada ${gameweek.number} · ${match.kickoffLabel}`}
      />
      {editor.editable ? (
        <>
          <PredictionForm editor={editor} />
          {/* Las alineaciones van DESPUES de los selectores: son informacion para
              decidir, pero lo primero es pronosticar. El formulario reserva 132px
              al final para su barra fija de guardar, asi que ese hueco se sube
              aqui y se vuelve a reservar al final, que es donde acaba la pantalla. */}
          <div className="-mt-[calc(env(safe-area-inset-bottom)+118px)] px-[14px] pb-[calc(env(safe-area-inset-bottom)+132px)]">
            {/* Entre los selectores y las alineaciones a proposito: es la ayuda
                para ELEGIR goleador, asi que va pegada debajo de donde se
                eligen, no al final de la pantalla. */}
            <TopScorers
              scorers={scorers}
              home={match.home}
              away={match.away}
              className="mb-[14px]"
            />
            <LineupSection
              lineups={lineups}
              home={match.home}
              away={match.away}
              kickoffAt={match.kickoffAt}
            />
            {/* El cron no es puntual: si la alineacion ya salio pero aun no la
                tenemos, la pide quien abre el partido. No pinta nada. */}
            <LineupPoller
              matchId={match.id}
              kickoffAt={match.kickoffAt}
              available={lineups.available}
            />
          </div>
        </>
      ) : (
        <>
          <SealedCard editor={editor} />
          <LineupSection
            lineups={lineups}
            home={match.home}
            away={match.away}
            kickoffAt={match.kickoffAt}
            className="px-[18px] pb-[40px]"
          />
        </>
      )}
    </>
  )
}
