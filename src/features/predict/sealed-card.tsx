import { Lock } from 'lucide-react'
import Link from 'next/link'

import { Card, SectionLabel, TeamBadge } from '@/components/ui'
import { scoreLabel } from '@/lib/format'
import type { PredictEditorVM } from '@/lib/view-models'

export interface SealedCardProps {
  editor: PredictEditorVM
}

/**
 * Estado 4b: el partido ya no admite cambios. Server Component a proposito, no
 * hay nada interactivo aqui salvo el enlace de vuelta.
 */
export function SealedCard({ editor }: SealedCardProps) {
  const { match } = editor
  const prediction = match.myPrediction

  const scorersLabel = !prediction
    ? 'Sin pronóstico'
    : prediction.scorers.length > 0
      ? prediction.scorers.join(', ')
      : 'Sin goles'

  // Con «sin goles» marcado no hay pase de gol posible, asi que se dice eso y no
  // un guion, que se leeria como "no rellenado".
  const assistsLabel = !prediction
    ? 'Sin pronóstico'
    : prediction.assists.length > 0
      ? prediction.assists.join(', ')
      : prediction.noGoals
        ? 'Sin goles'
        : '—'

  return (
    <div className="flex flex-col gap-[16px] px-[18px] pt-[22px] pb-[40px]">
      <div
        role="alert"
        className="flex animate-pop flex-col gap-[11px] rounded-[20px] border border-bad bg-bad-soft p-[20px]"
      >
        <div className="flex items-center gap-[11px]">
          <div
            aria-hidden
            className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[14px] bg-bad text-white"
          >
            <Lock size={19} strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <p className="text-[17px] font-extrabold tracking-[-.02em]">Plazo cerrado</p>
            <p className="text-[12.5px] font-semibold text-txt2">
              El partido empezó a las {match.kickoffLabel}
            </p>
          </div>
        </div>
        <p className="text-[14px] leading-[1.5] text-txt2">
          Cada partido se cierra en su pitido inicial. Ya no se puede tocar nada, ni siquiera un
          golpe de suerte.
        </p>
      </div>

      <Card radius={20} className="p-[18px]">
        <SectionLabel className="mb-[13px]">Tu pronóstico sellado</SectionLabel>
        <div className="mb-[16px] flex items-center justify-center gap-[16px]">
          <TeamBadge team={match.home} size={34} />
          <span className="font-num text-[40px] font-extrabold leading-none tracking-[.02em] tabular-nums">
            {prediction ? scoreLabel(prediction.home, prediction.away, '–') : '–'}
          </span>
          <TeamBadge team={match.away} size={34} />
        </div>
        <dl className="flex flex-col gap-[8px] text-[13.5px]">
          <div className="flex justify-between gap-[16px]">
            <dt className="flex-none font-semibold text-txt3">MVP</dt>
            <dd className="text-right font-bold">{prediction?.mvp ?? '—'}</dd>
          </div>
          <div className="flex justify-between gap-[16px]">
            <dt className="flex-none font-semibold text-txt3">Goleadores</dt>
            <dd className="text-right font-bold">{scorersLabel}</dd>
          </div>
          <div className="flex justify-between gap-[16px]">
            <dt className="flex-none font-semibold text-txt3">Asistentes</dt>
            <dd className="text-right font-bold">{assistsLabel}</dd>
          </div>
        </dl>
      </Card>

      <Link
        href="/jornada"
        className="flex min-h-[52px] items-center justify-center rounded-[16px] border border-line2 bg-card px-[22px] text-[15px] font-bold text-txt transition-transform duration-100 active:scale-[.97] active:opacity-90"
      >
        Volver a la jornada
      </Link>
    </div>
  )
}
