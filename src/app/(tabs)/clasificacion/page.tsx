import { Trophy } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { EmptyState, ScreenHeader } from '@/components/ui'
import { CompetitionTable } from '@/features/standings/competition-table'
import { TopScorers } from '@/features/standings/top-scorers'
import { HeadToHead } from '@/features/standings/head-to-head'
import { Podium } from '@/features/standings/podium'
import { StandingsRow } from '@/features/standings/standings-row'
import { requireMember } from '@/lib/auth'
import {
  getActiveGameweek,
  getCompetitionStandings,
  getHeadToHead,
  getSeasonStandings,
  getTopScorers,
} from '@/lib/data'

export const metadata: Metadata = { title: 'Clasificación · La Caleta League' }

/**
 * Las vistas que viven en ESTA ruta. 'Por jornada' no esta aqui porque no es una
 * vista, es otra ruta (`/clasificacion/jornada/[n]`), y asi sigue siendo.
 */
type Vista = 'general' | 'laliga' | 'cara-a-cara'

function parseVista(raw: string | string[] | undefined): Vista {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === 'laliga' || value === 'cara-a-cara' ? value : 'general'
}

/**
 * 13px y no los 13.5px de dos pestañas: con cuatro, la mas larga ('Por jornada')
 * mide 68.5px y con el padding pide 72.5px por pestaña, o sea 333px de pantalla.
 * Medido con `measureText` en Figtree 700, que es la fuente real. Entra en
 * cualquier movil de 333px para arriba; el mas estrecho que se usa hoy son 360.
 */
const TAB_BASE =
  'flex min-h-[40px] flex-1 items-center justify-center whitespace-nowrap rounded-[11px] px-[2px] text-[13px] font-bold'
const TAB_ACTIVE = `${TAB_BASE} bg-card text-txt`
const TAB_IDLE = `${TAB_BASE} text-txt3 transition-transform duration-100 active:scale-[.97] active:opacity-90`

/**
 * Pantalla 6. El segmentado tiene cuatro destinos y NINGUNO es estado local:
 * 'Por jornada' es otra ruta y las otras tres son la misma con `?vista=`. Por eso
 * todo son enlaces (que ademas prefetchan) y el servidor solo pide los datos de
 * la vista que se esta pintando: entrar en Clasificación no llama a
 * football-data.org si no se ha abierto la pestaña de LaLiga.
 *
 * D2: `searchParams` es una promesa y se resuelve con await.
 */
export default async function ClasificacionPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  // D13: la guarda de pertenencia va al principio de cada pantalla protegida.
  await requireMember()

  const vista = parseVista((await searchParams).vista)

  const [gameweek, standings, competition, scorers, h2h] = await Promise.all([
    getActiveGameweek(),
    vista === 'general' ? getSeasonStandings() : null,
    vista === 'laliga' ? getCompetitionStandings() : null,
    vista === 'laliga' ? getTopScorers(20) : null,
    vista === 'cara-a-cara' ? getHeadToHead() : null,
  ])

  const podium = standings ? standings.rows.slice(0, 3) : []
  const rest = standings ? standings.rows.slice(3) : []

  return (
    <>
      <ScreenHeader title="Clasificación" size="lg">
        <nav aria-label="Vistas de la clasificación" className="flex gap-[3px] rounded-[13px] bg-sunk p-[3px]">
          {vista === 'general' ? (
            <span aria-current="page" className={TAB_ACTIVE}>
              General
            </span>
          ) : (
            <Link href="/clasificacion" className={TAB_IDLE}>
              General
            </Link>
          )}

          <Link href={`/clasificacion/jornada/${gameweek.number}`} className={TAB_IDLE}>
            Por jornada
          </Link>

          {vista === 'laliga' ? (
            <span aria-current="page" className={TAB_ACTIVE}>
              LaLiga
            </span>
          ) : (
            <Link href="/clasificacion?vista=laliga" className={TAB_IDLE}>
              LaLiga
            </Link>
          )}

          {vista === 'cara-a-cara' ? (
            <span aria-current="page" className={TAB_ACTIVE}>
              Cara a cara
            </span>
          ) : (
            <Link href="/clasificacion?vista=cara-a-cara" className={TAB_IDLE}>
              Cara a cara
            </Link>
          )}
        </nav>
      </ScreenHeader>

      {competition && (
        <div className="flex flex-col gap-[12px] px-[14px] pb-[26px]">
          <CompetitionTable standings={competition} />
          {scorers && <TopScorers data={scorers} />}
        </div>
      )}
      {h2h && <HeadToHead h2h={h2h} />}

      {standings &&
        (standings.rows.length === 0 ? (
          <EmptyState
            icon={<Trophy size={34} strokeWidth={1.9} aria-hidden />}
            title="Todavía no hay clasificación"
            description="En cuanto se juegue el primer partido de la peña, aquí aparece quién manda."
          />
        ) : (
          <div className="px-[14px] pt-[18px] pb-[30px]">
            <Podium rows={podium} />
            <ul className="flex flex-col gap-[6px]">
              {rest.map((row) => (
                <StandingsRow key={row.memberId} row={row} />
              ))}
            </ul>
          </div>
        ))}
    </>
  )
}
