import { Avatar } from '@/components/ui'
import { cn } from '@/lib/cn'
import { DUES_BY_PLACE, DUES_TOTAL } from '@/lib/dues'
import type { SeasonDuesVM } from '@/lib/view-models'

/**
 * El bote de la temporada: lo que lleva pagado cada uno.
 *
 * Los tres ultimos de cada jornada pagan 3, 2 y 1 euro. Va debajo de la
 * clasificacion general y no en una pestaña propia: el segmentado ya lleva
 * cuatro y en movil no cabe otra, igual que se decidio con el Pichichi.
 *
 * SOLO CUENTAN LAS JORNADAS ACABADAS. Que este todo a cero es el estado normal
 * hasta que se juegue la primera entera -- hoy la jornada 1 lleva 4 de 10
 * partidos -- y por eso el texto de vacio habla de eso y no de un fallo.
 */
export function SeasonDues({ dues }: { dues: SeasonDuesVM }) {
  const conDeuda = dues.rows.filter((row) => row.euros > 0)

  return (
    <section className="rounded-[17px] border border-line bg-card px-[15px] py-[13px]">
      <div className="mb-[4px] flex items-baseline justify-between gap-[10px]">
        <h2 className="text-[14.5px] font-extrabold tracking-[-.02em]">Bote</h2>
        <span className="font-num text-[15px] font-extrabold tabular-nums text-bad">
          {dues.total} €
        </span>
      </div>

      <p className="mb-[10px] text-[11.5px] font-semibold leading-[1.45] text-txt3">
        Cada jornada acabada, el último paga {DUES_BY_PLACE[0]} €, el penúltimo {DUES_BY_PLACE[1]} €
        y el antepenúltimo {DUES_BY_PLACE[2]} €. Son {DUES_TOTAL} € por jornada.
      </p>

      {conDeuda.length === 0 ? (
        <p className="text-[12.5px] font-semibold leading-[1.45] text-txt2">
          Todavía no debe nadie: no se ha acabado ninguna jornada entera. Los euros aparecen cuando
          se juegue el último partido de una jornada.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {conDeuda.map((row) => (
            <li key={row.memberId} className="flex items-center gap-[10px] py-[7px]">
              <Avatar
                name={row.displayName}
                color={row.avatarColor}
                photoUrl={row.avatarUrl}
                size={24}
              />
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-[13.5px]',
                  row.isMe ? 'font-extrabold text-accent2' : 'font-semibold text-txt',
                )}
              >
                {row.displayName}
              </span>
              <span className="flex-none font-num text-[15px] font-extrabold tabular-nums text-bad">
                {row.euros} €
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
