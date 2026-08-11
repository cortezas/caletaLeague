import { notFound } from 'next/navigation'

import { ScreenHeader } from '@/components/ui'
import { PredictionForm } from '@/features/predict/prediction-form'
import { SealedCard } from '@/features/predict/sealed-card'
import { requireMember } from '@/lib/auth'
import { getActiveGameweek, getMatchEditor } from '@/lib/data'

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
  const [editor, gameweek] = await Promise.all([getMatchEditor(matchId), getActiveGameweek()])
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
      {editor.editable ? <PredictionForm editor={editor} /> : <SealedCard editor={editor} />}
    </>
  )
}
