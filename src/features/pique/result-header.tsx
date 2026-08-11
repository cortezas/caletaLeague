import { Card, Scoreline, TeamBadge } from '@/components/ui'
import type { MatchRowVM } from '@/lib/view-models'

export interface ResultHeaderProps {
  match: MatchRowVM
}

function Cell({
  label,
  value,
  className,
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className={className}>
      <p className="mb-[5px] text-[10px] font-extrabold uppercase tracking-[.11em] text-txt3">
        {label}
      </p>
      <p className="text-[13.5px] font-bold leading-[1.3]">{value}</p>
    </div>
  )
}

/**
 * Resultado real del partido. El VM garantiza `result` no nulo en el pique,
 * pero el tipo lo declara nullable: sin el guardia no compila.
 *
 * Las tres celdas (MVP, Goleadores, Asistencias) NO van en una fila: con tres
 * columnas en un movil de 360px cada una queda a ~100px y los nombres se parten
 * por la mitad. MVP y Goleadores comparten fila y Asistencias va debajo a ancho
 * completo, que es la que suele traer mas nombres.
 *
 * Asistencias se OMITE cuando no hay ninguna registrada, que es el caso normal
 * hasta que el organizador las mete: una celda vacia sugiere que no hubo
 * asistencias, y lo que pasa es que nadie las ha apuntado todavia.
 */
export function ResultHeader({ match }: ResultHeaderProps) {
  const { result } = match
  if (!result) return null

  const assists = result.assists ?? []

  return (
    <Card radius={22} elevated className="overflow-hidden">
      <div className="bg-[linear-gradient(180deg,var(--accent-soft)_0%,transparent_100%)] px-[16px] pt-[20px] pb-[16px]">
        <div className="flex items-center justify-center gap-[18px]">
          <div className="flex flex-1 flex-col items-center gap-[8px]">
            <TeamBadge team={match.home} size={46} />
            <span className="text-[13px] font-bold">{match.home.name}</span>
          </div>
          <Scoreline home={result.home} away={result.away} size="lg" />
          <div className="flex flex-1 flex-col items-center gap-[8px]">
            <TeamBadge team={match.away} size={46} />
            <span className="text-[13px] font-bold">{match.away.name}</span>
          </div>
        </div>
      </div>

      <div className="flex border-t border-line">
        <Cell
          label="MVP"
          value={result.mvp || 'Sin designar'}
          className="flex-1 border-r border-line px-[15px] py-[13px]"
        />
        <Cell
          label="Goleadores"
          value={result.scorers.length > 0 ? result.scorers.join(' · ') : 'Sin goles'}
          className="flex-[1.25] px-[15px] py-[13px]"
        />
      </div>

      {assists.length > 0 && (
        <Cell
          label="Asistencias"
          value={assists.join(' · ')}
          className="border-t border-line px-[15px] py-[13px]"
        />
      )}
    </Card>
  )
}
