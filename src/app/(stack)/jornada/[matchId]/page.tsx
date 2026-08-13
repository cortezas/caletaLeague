import { notFound } from 'next/navigation'

import { ScreenHeader } from '@/components/ui'
import { LineupSection } from '@/features/lineups/lineup-section'
import { PredictionForm } from '@/features/predict/prediction-form'
import { SealedCard } from '@/features/predict/sealed-card'
import { requireMember } from '@/lib/auth'
import { getActiveGameweek, getMatchEditor, getMatchLineups } from '@/lib/data'

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
  const [editor, gameweek, lineups] = await Promise.all([
    getMatchEditor(matchId),
    getActiveGameweek(),
    getMatchLineups(matchId),
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
            <LineupSection
              lineups={lineups}
              home={match.home}
              away={match.away}
              kickoffAt={match.kickoffAt}
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
