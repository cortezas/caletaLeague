import { Avatar } from '@/components/ui'
import type { StandingsVM } from '@/lib/view-models'

type Row = StandingsVM['rows'][number]

export interface PodiumProps {
  /** Los tres primeros, en orden de clasificacion (1.o, 2.o, 3.o). */
  rows: Row[]
}

/**
 * Orden VISUAL 2 - 1 - 3: el lider va en el centro sobre el pedestal alto.
 * El array llega ordenado por puesto, asi que se recorre por indice.
 */
const RENDER_ORDER = [1, 0, 2]

/** Anillo, fondo tintado y alturas del pedestal, por puesto (0 = lider). */
const PLACE = [
  { ring: 'var(--volt)', tint: 'rgba(223,255,79,.09)', avatar: 62, pedestal: 104 },
  { ring: '#C9D3E0', tint: 'rgba(201,211,224,.09)', avatar: 52, pedestal: 84 },
  { ring: '#C98B4B', tint: 'rgba(201,139,75,.10)', avatar: 52, pedestal: 70 },
] as const

export function Podium({ rows }: PodiumProps) {
  const visible = RENDER_ORDER.filter((index) => rows[index] !== undefined)
  if (visible.length === 0) return null

  return (
    <ol className="mb-[20px] flex items-end gap-[8px]">
      {visible.map((index) => {
        const row = rows[index]
        const place = PLACE[index]

        return (
          <li
            key={row.memberId}
            className="flex flex-1 flex-col items-center gap-[8px]"
            aria-label={`${row.position}.º ${row.displayName}, ${row.points} puntos`}
          >
            <Avatar
              name={row.displayName}
              color={row.avatarColor}
              photoUrl={row.avatarUrl}
              size={place.avatar}
              ring={place.ring}
              className="shadow-[0_8px_22px_rgba(0,0,0,.3)]"
            />
            <span className="text-center text-[12.5px] font-bold leading-[1.15]">
              {row.displayName}
            </span>
            <div
              aria-hidden
              className="flex w-full flex-col items-center gap-[1px] rounded-t-[14px] border border-b-0 pt-[9px]"
              style={{ height: place.pedestal, background: place.tint, borderColor: place.ring }}
            >
              <span
                className="font-num text-[26px] font-extrabold leading-none"
                style={{ color: place.ring }}
              >
                {row.points}
              </span>
              <span className="text-[9.5px] font-extrabold tracking-[.1em] text-txt3">PTS</span>
              <span
                className="mt-auto mb-[8px] font-num text-[22px] font-extrabold opacity-50"
                style={{ color: place.ring }}
              >
                {row.position}º
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
