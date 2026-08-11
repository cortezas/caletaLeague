import { AlignLeft, Lock } from 'lucide-react'
import Link from 'next/link'

import { Countdown, ProgressBar, PulseDot } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { GameweekVM } from '@/lib/view-models'

export interface GameweekHeaderProps {
  gameweek: GameweekVM
}

/**
 * Aparece en tres sitios distintos de la app (regla 2 del handoff). Aqui va
 * dentro de la lista en movil y en el rail derecho en escritorio.
 */
export function SecretBanner({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        'flex items-start gap-[9px] rounded-[14px] border border-line bg-accent-soft px-[13px] py-[10px] text-[12.5px] font-semibold leading-[1.4] text-txt2',
        className,
      )}
    >
      <Lock size={15} strokeWidth={2.1} className="mt-[1px] flex-none text-accent2" aria-hidden />
      Nadie ve tu pronóstico hasta el pitido inicial de cada partido.
    </p>
  )
}

/**
 * Cabecera pegajosa de /jornada.
 *
 * La cuenta atras apunta al primer partido abierto (D19(d)), no a la jornada:
 * cada partido se cierra en su propio pitido inicial. Si no queda ninguno
 * abierto, `deadlineAt` es null y la tarjeta desaparece en vez de mostrar ceros.
 */
export function GameweekHeader({ gameweek }: GameweekHeaderProps) {
  const { number, competitionLabel, deadlineAt, deadlineLabel, predictedCount, totalCount } =
    gameweek

  const progressLabel = `${predictedCount} de ${totalCount}`

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg px-[18px] pt-[calc(env(safe-area-inset-top)+14px)] pb-[12px] lg:px-[24px] lg:pt-[18px] lg:pb-[16px]">
      <div className="flex items-start gap-[10px] lg:items-end">
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-extrabold uppercase tracking-[.12em] text-txt3">
            La Caleta League
          </p>
          <h1 className="font-num text-[34px] font-extrabold uppercase leading-[1.05] tracking-[.01em] lg:text-[32px]">
            Jornada {number}
          </h1>
          <p className="text-[11.5px] font-semibold text-txt3">{competitionLabel}</p>
        </div>

        {/* Escritorio: la cuenta atras se convierte en pildora y el progreso se va al rail. */}
        {deadlineAt && deadlineLabel && (
          <div className="hidden flex-none items-center gap-[9px] rounded-[12px] border border-line bg-card px-[14px] py-[9px] lg:flex">
            <PulseDot tone="warn" size={7} speed={1.6} />
            <span className="text-[11.5px] font-bold text-txt3">{deadlineLabel} en</span>
            <Countdown deadlineAt={deadlineAt} className="text-[17px] leading-none" />
          </div>
        )}

        <Link
          href="/jornada/resumen"
          aria-label="Repaso de la jornada"
          className="flex min-h-[44px] min-w-[44px] flex-none items-center justify-center rounded-[13px] border border-line bg-card text-txt transition-transform duration-100 active:scale-[.97] active:opacity-90"
        >
          <AlignLeft size={19} strokeWidth={2} aria-hidden />
        </Link>
      </div>

      <div className="mt-[11px] flex items-center gap-[8px] lg:hidden">
        {deadlineAt && deadlineLabel && (
          <div className="flex min-w-0 flex-1 items-center gap-[9px] rounded-[13px] border border-line bg-card px-[12px] py-[9px]">
            <PulseDot tone="warn" size={7} speed={1.6} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10.5px] font-bold uppercase tracking-[.08em] text-txt3">
                {deadlineLabel}
              </p>
              <Countdown deadlineAt={deadlineAt} className="block text-[21px] leading-[1.1]" />
            </div>
          </div>
        )}

        <div
          className={cn(
            'rounded-[13px] border border-line bg-card px-[12px] py-[9px]',
            // Sin cuenta atras la tarjeta de progreso se queda con todo el ancho.
            deadlineAt ? 'w-[112px] flex-none' : 'flex-1',
          )}
        >
          <p className="mb-[5px] text-[10.5px] font-bold uppercase tracking-[.08em] text-txt3">
            {progressLabel}
          </p>
          <ProgressBar value={predictedCount} max={totalCount} tone="volt" />
        </div>
      </div>
    </header>
  )
}
