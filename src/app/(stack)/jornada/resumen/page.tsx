import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ScreenHeader, StatCard } from '@/components/ui'
import { SummaryRow } from '@/features/jornada/summary-row'
import { requireMember } from '@/lib/auth'
import { getGameweekSummary } from '@/lib/data'

export const metadata: Metadata = {
  title: 'Repaso de la jornada · La Caleta League',
}

/**
 * D2: `searchParams` es una promesa y se resuelve con await.
 * `?j=<numero>` es la misma jornada que se estaba mirando en /jornada.
 */
export default async function ResumenPage({
  searchParams,
}: {
  searchParams: Promise<{ j?: string | string[] }>
}) {
  // D13: la guarda de pertenencia va al principio de cada pantalla protegida.
  await requireMember()

  const { j } = await searchParams
  const requested = Array.isArray(j) ? j[0] : j

  let jornada: number | null = null
  if (requested !== undefined && requested !== '') {
    const parsed = Number(requested)
    if (!Number.isInteger(parsed) || parsed < 1) notFound()
    jornada = parsed
  }

  const summary = jornada === null ? await getGameweekSummary() : await getGameweekSummary(jornada)
  if (!summary) notFound()

  const { rows, predictedCount, missingCount, firstMissingMatchId } = summary

  const missingText =
    missingCount === 0
      ? 'Los tienes todos puestos'
      : `Te falta${missingCount === 1 ? '' : 'n'} ${missingCount} por poner`
  const subtitle =
    summary.gameweekNumber > 0 ? `Jornada ${summary.gameweekNumber} · ${missingText}` : missingText

  // Volver a la MISMA jornada que se estaba repasando, no a la de por defecto.
  const gameweekHref = jornada === null ? '/jornada' : `/jornada?j=${jornada}`

  // El boton salta al primer hueco; si no hay ninguno, solo devuelve a la lista.
  const confirmHref = firstMissingMatchId ? `/jornada/${firstMissingMatchId}` : gameweekHref
  const confirmLabel = firstMissingMatchId ? 'Ir al primero que falta' : 'Todo listo, volver'

  return (
    <>
      <ScreenHeader title="Repaso de la jornada" subtitle={subtitle} backHref={gameweekHref} />

      <div className="flex flex-col gap-[8px] px-[14px] pt-[14px] pb-[30px]">
        <div className="mb-[2px] flex gap-[8px]">
          <StatCard value={predictedCount} label="Pronosticados" tone="volt" className="flex-1" />
          <StatCard
            value={missingCount}
            label="Te faltan"
            tone={missingCount === 0 ? 'ok' : 'bad'}
            className="flex-1"
          />
        </div>

        <p className="mb-[4px] rounded-[16px] border border-line bg-warn-soft px-[14px] py-[12px] text-[12.5px] font-semibold leading-[1.45] text-txt2">
          Los 5 puntos extra del pleno al 1X2 solo cuentan si pronosticas los {rows.length}{' '}
          partidos.
        </p>

        {rows.map((row) => (
          <SummaryRow key={row.matchId} row={row} />
        ))}

        <Link
          href={confirmHref}
          className="mt-[8px] flex min-h-[54px] w-full items-center justify-center rounded-[16px] bg-accent text-[15.5px] font-extrabold text-accent-ink shadow-[0_8px_24px_var(--accent-soft)] transition-transform duration-100 active:scale-[.97] active:opacity-90"
        >
          {confirmLabel}
        </Link>
      </div>
    </>
  )
}
