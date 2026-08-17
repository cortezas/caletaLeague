import { CalendarDays } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { EmptyState, ProgressBar } from '@/components/ui'
import { GameweekHeader, SecretBanner } from '@/features/jornada/gameweek-header'
import { MatchRow } from '@/features/jornada/match-row'
import { LineupWarmer } from '@/features/lineups/lineup-warmer'
import { requireMember } from '@/lib/auth'
import { getActiveGameweek, getGameweek } from '@/lib/data'
import type { GameweekVM } from '@/lib/view-models'

export const metadata: Metadata = {
  title: 'Jornada · La Caleta League',
}

/**
 * D2: `searchParams` es una promesa y se resuelve con await.
 *
 * `?j=<numero>` fija la jornada que se mira. Sin parametro se entra en la del
 * cierre mas proximo, que con los aplazamientos del Mundial no es la de menor
 * numero: la jornada 2 se juega DENTRO de la 1.
 */
export default async function JornadaPage({
  searchParams,
}: {
  searchParams: Promise<{ j?: string | string[] }>
}) {
  // D13: la guarda de pertenencia va al principio de cada pantalla protegida.
  // Sin ella, quien no ha entrado se comia el error boundary en vez del login.
  await requireMember()

  const { j } = await searchParams
  const requested = Array.isArray(j) ? j[0] : j

  let gameweek: GameweekVM
  if (requested === undefined || requested === '') {
    gameweek = await getActiveGameweek()
  } else {
    const jornada = Number(requested)
    if (!Number.isInteger(jornada) || jornada < 1) notFound()
    const found = await getGameweek(jornada)
    if (!found) notFound()
    gameweek = found
  }

  const summaryHref =
    gameweek.number > 0 ? `/jornada/resumen?j=${gameweek.number}` : '/jornada/resumen'

  if (gameweek.totalCount === 0) {
    return (
      <>
        <GameweekHeader gameweek={gameweek} />
        <EmptyState
          icon={<CalendarDays size={34} strokeWidth={1.6} />}
          title="Sin jornada activa"
          description="Todavía no hay partidos abiertos. Mientras tanto, repasa el pique de la anterior."
          action={
            <Link
              href="/clasificacion"
              className="inline-flex min-h-[48px] items-center rounded-[15px] border border-line2 bg-card px-[22px] text-[14.5px] font-bold text-txt transition-transform duration-100 active:scale-[.97] active:opacity-90"
            >
              Ver la clasificación
            </Link>
          }
        />
      </>
    )
  }

  // Puntos ya conseguidos en la jornada: solo los partidos jugados suman.
  const playedCount = gameweek.matches.filter((m) => m.status === 'played').length
  const gameweekPoints = gameweek.matches.reduce((sum, m) => sum + (m.myPoints ?? 0), 0)

  // El partido mas proximo que todavia no ha empezado. Es el unico que hace
  // falta nombrar: la ruta de refresco barre la ventana entera y de paso deja
  // listos los que arrancan detras.
  const proximo = gameweek.matches.find((match) => match.status === 'open')

  return (
    <>
      {/* Sin esto la alineacion solo se pedia al abrir un partido concreto, y la
          peña vive en esta lista: en la jornada 1 llegaron entre 3 y 14 minutos
          antes del pitido, cuando ya no daba tiempo a mirar nada. */}
      {proximo && <LineupWarmer matchId={proximo.id} kickoffAt={proximo.kickoffAt} />}

      <GameweekHeader gameweek={gameweek} />

      <div className="px-[14px] pt-[14px] pb-[26px] lg:grid lg:grid-cols-[minmax(0,1fr)_284px] lg:items-start lg:gap-[20px] lg:px-[24px] lg:pt-[22px]">
        <div className="flex min-w-0 flex-col gap-[9px]">
          <SecretBanner className="lg:hidden" />

          <div className="flex flex-col gap-[9px] lg:grid lg:grid-cols-2 lg:gap-[10px]">
            {gameweek.matches.map((match) => (
              <MatchRow key={match.id} match={match} />
            ))}
          </div>

          <Link
            href={summaryHref}
            className="mt-[5px] flex min-h-[52px] w-full items-center justify-center rounded-[16px] border border-dashed border-line2 text-[14px] font-bold text-txt2 transition-transform duration-100 active:scale-[.97] active:opacity-90"
          >
            Repasar la jornada antes de cerrar
          </Link>
        </div>

        {/* Rail de escritorio: a partir de lg (README, "Vista tablet / escritorio"). */}
        <aside className="hidden lg:flex lg:flex-col lg:gap-[12px]">
          <div className="rounded-[16px] border border-line bg-card px-[16px] py-[15px]">
            <div className="mb-[9px] flex items-baseline justify-between">
              <span className="text-[12.5px] font-extrabold text-txt">Tu jornada</span>
              <span className="text-[11.5px] font-bold text-txt3">
                {gameweek.predictedCount} de {gameweek.totalCount}
              </span>
            </div>
            <ProgressBar
              value={gameweek.predictedCount}
              max={gameweek.totalCount}
              tone="volt"
              className="mb-[12px]"
            />
            <div className="flex gap-[8px]">
              <div className="flex-1 rounded-[11px] bg-sunk px-[11px] py-[9px]">
                <div className="font-num text-[22px] font-extrabold leading-none tabular-nums text-volt">
                  {gameweekPoints}
                </div>
                <div className="text-[10.5px] font-bold text-txt3">pts jornada</div>
              </div>
              <div className="flex-1 rounded-[11px] bg-sunk px-[11px] py-[9px]">
                <div className="font-num text-[22px] font-extrabold leading-none tabular-nums text-txt">
                  {playedCount}/{gameweek.totalCount}
                </div>
                <div className="text-[10.5px] font-bold text-txt3">partidos jugados</div>
              </div>
            </div>
          </div>

          <Link
            href="/clasificacion"
            className="flex min-h-[48px] items-center justify-between rounded-[16px] border border-line bg-card px-[16px] text-[12.5px] font-extrabold text-txt transition-transform duration-100 active:scale-[.97] active:opacity-90"
          >
            Clasificación general
            <span className="text-[11.5px] font-bold text-accent2">Ver</span>
          </Link>

          <SecretBanner />
        </aside>
      </div>
    </>
  )
}
