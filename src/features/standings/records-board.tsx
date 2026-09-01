import { Avatar } from '@/components/ui'
import type { RecordsVM } from '@/lib/view-models'

/**
 * Los records de la peña. Debajo del bote, en la vista general.
 *
 * En el perfil ya hay una racha, pero es TUYA y solo la ves tu. Lo que genera
 * conversacion en el grupo es lo colectivo: quien clava mas marcadores, quien
 * lleva mas jornadas por encima de la media, quien va soltando los euros.
 *
 * No se pinta si no hay nada: al principio de temporada todos los records valen
 * cero y una lista de ceros no es un tablon de honor, es ruido.
 */
export function RecordsBoard({ records }: { records: RecordsVM }) {
  if (records.rows.length === 0) return null

  return (
    <section className="rounded-[17px] border border-line bg-card px-[15px] py-[13px]">
      <h2 className="mb-[4px] text-[14.5px] font-extrabold tracking-[-.02em]">Récords</h2>
      <p className="mb-[11px] text-[11.5px] font-semibold leading-[1.45] text-txt3">
        Lo que va dejando la temporada. Las marcas por jornada solo cuentan jornadas acabadas.
      </p>

      <ul className="flex flex-col gap-[9px]">
        {records.rows.map((row) => (
          <li key={row.clave} className="flex items-center gap-[10px]">
            <Avatar
              name={row.displayName}
              color={row.avatarColor}
              photoUrl={row.avatarUrl}
              size={30}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-extrabold text-txt">
                {row.titulo}
              </span>
              <span className="block truncate text-[11.5px] font-semibold text-txt3">
                {row.displayName} · {row.detalle}
              </span>
            </span>
            <span className="flex-none font-num text-[19px] font-extrabold tabular-nums text-accent2">
              {row.valor}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
