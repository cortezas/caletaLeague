import { cn } from '@/lib/cn'
import type { ProfileVM } from '@/lib/view-models'

/** Alto util de la barra mas alta, en px (handoff, pantalla 9). */
const TRACK = 72

export interface PointsChartProps {
  chart: ProfileVM['chart']
}

/**
 * Barras de puntos por jornada.
 *
 * D19(c): el maximo es `Math.max(...)` y la mejor jornada es el INDICE de ese
 * maximo. El prototipo comparaba contra el literal 23 y con datos reales eso
 * deja la grafica sin barra destacada (o con varias).
 */
export function PointsChart({ chart }: PointsChartProps) {
  if (chart.length === 0) return null

  const max = Math.max(...chart.map((c) => c.points))
  const bestIndex = chart.findIndex((c) => c.points === max)
  const currentIndex = chart.length - 1
  // Una temporada entera a cero no es un caso imposible al arrancar la liga.
  const scale = max > 0 ? TRACK / max : 0

  const range = `J${chart[0].gameweek} – J${chart[currentIndex].gameweek}`

  return (
    <div className="rounded-[20px] border border-line bg-card px-[15px] pt-[16px] pb-[12px]">
      <div className="mb-[16px] flex items-baseline justify-between">
        <div className="text-[14.5px] font-extrabold tracking-[-.01em]">Puntos por jornada</div>
        <div className="text-[11.5px] font-bold text-txt3">{range}</div>
      </div>

      <div className="flex h-[106px] items-end gap-[5px]">
        {chart.map((entry, index) => {
          const best = index === bestIndex
          const current = !best && index === currentIndex

          return (
            <div
              key={entry.gameweek}
              className="flex h-full flex-1 flex-col items-center justify-end gap-[6px]"
            >
              <div
                className={cn(
                  'font-num text-[11px] font-bold tabular-nums leading-none',
                  best ? 'text-volt' : 'text-txt3',
                )}
              >
                {entry.points}
              </div>
              <div
                aria-hidden
                className={cn(
                  'w-full rounded-t-[6px] rounded-b-[3px]',
                  best ? 'bg-volt' : current ? 'bg-accent' : 'bg-card2',
                )}
                // Alturas en px calculadas en runtime: Tailwind no puede generarlas.
                // El minimo de 3px evita que una jornada a 0 desaparezca del eje.
                style={{ height: Math.max(3, Math.round(entry.points * scale)) }}
              />
              <div className="text-[9.5px] font-bold leading-none text-txt3">J{entry.gameweek}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
