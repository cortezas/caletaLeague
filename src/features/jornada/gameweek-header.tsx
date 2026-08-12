import { AlignLeft, ChevronLeft, ChevronRight, Lock } from 'lucide-react'
import Link from 'next/link'

import { Countdown, ProgressBar, PulseDot } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { GameweekVM } from '@/lib/view-models'

export interface GameweekHeaderProps {
  gameweek: GameweekVM
}

/** Mismo boton de 44x44 que la navegacion de /clasificacion/jornada/[n]. */
const NAV_BUTTON =
  'flex min-h-[44px] min-w-[44px] flex-none items-center justify-center rounded-[13px] border border-line bg-card'

const NAV_BUTTON_ON = 'text-txt transition-transform duration-100 active:scale-[.97] active:opacity-90'

const NAV_BUTTON_OFF = 'text-txt3 opacity-50'

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
 * Eso es justo lo que pasa en la jornada 1 del Mundial: partidos ya jugados
 * conviviendo con otros que no se cierran hasta el 27.
 *
 * Todo lo que pinta (cuenta atras, progreso, enlaces) sale del `GameweekVM` que
 * recibe, o sea de la jornada que se esta MIRANDO, no de la de por defecto.
 */
export function GameweekHeader({ gameweek }: GameweekHeaderProps) {
  const {
    number,
    competitionLabel,
    deadlineAt,
    deadlineLabel,
    predictedCount,
    totalCount,
    hasPrev,
    hasNext,
    prevNumber,
    nextNumber,
    isDefault,
  } = gameweek

  const progressLabel = `${predictedCount} de ${totalCount}`
  // El repaso hereda la jornada que se esta viendo. Con `number` 0 (peña sin
  // calendario) no hay nada que fijar y se deja el enlace pelado.
  const summaryHref = number > 0 ? `/jornada/resumen?j=${number}` : '/jornada/resumen'

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg px-[14px] pt-[calc(env(safe-area-inset-top)+14px)] pb-[12px] lg:px-[24px] lg:pt-[18px] lg:pb-[16px]">
      <div className="flex items-center gap-[10px]">
        <p className="min-w-0 flex-1 truncate text-[10.5px] font-extrabold uppercase tracking-[.12em] text-txt3">
          La Caleta League
        </p>

        {/* Escritorio: la cuenta atras se convierte en pildora y el progreso se va al rail. */}
        {deadlineAt && deadlineLabel && (
          <div className="hidden flex-none items-center gap-[9px] rounded-[12px] border border-line bg-card px-[14px] py-[9px] lg:flex">
            <PulseDot tone="warn" size={7} speed={1.6} />
            <span className="text-[11.5px] font-bold text-txt3">{deadlineLabel} en</span>
            <Countdown deadlineAt={deadlineAt} className="text-[17px] leading-none" />
          </div>
        )}

        <Link
          href={summaryHref}
          aria-label="Repaso de la jornada"
          className={cn(NAV_BUTTON, NAV_BUTTON_ON)}
        >
          <AlignLeft size={19} strokeWidth={2} aria-hidden />
        </Link>
      </div>

      <nav aria-label="Cambiar de jornada" className="mt-[7px] flex items-center gap-[10px]">
        {hasPrev && prevNumber !== null ? (
          <Link
            href={`/jornada?j=${prevNumber}`}
            aria-label={`Ir a la jornada ${prevNumber}`}
            className={cn(NAV_BUTTON, NAV_BUTTON_ON)}
          >
            <ChevronLeft size={17} strokeWidth={2.3} aria-hidden />
          </Link>
        ) : (
          <button
            type="button"
            disabled
            aria-disabled="true"
            aria-label="No hay jornada anterior"
            className={cn(NAV_BUTTON, NAV_BUTTON_OFF)}
          >
            <ChevronLeft size={17} strokeWidth={2.3} aria-hidden />
          </button>
        )}

        <div className="min-w-0 flex-1 text-center">
          <h1 className="truncate font-num text-[26px] font-extrabold uppercase leading-[1.05] tracking-[.01em] lg:text-[30px]">
            Jornada {number}
          </h1>
          <p className="truncate text-[11.5px] font-semibold text-txt3">{competitionLabel}</p>
        </div>

        {hasNext && nextNumber !== null ? (
          <Link
            href={`/jornada?j=${nextNumber}`}
            aria-label={`Ir a la jornada ${nextNumber}`}
            className={cn(NAV_BUTTON, NAV_BUTTON_ON)}
          >
            <ChevronRight size={17} strokeWidth={2.3} aria-hidden />
          </Link>
        ) : (
          <button
            type="button"
            disabled
            aria-disabled="true"
            aria-label="No hay jornada siguiente"
            className={cn(NAV_BUTTON, NAV_BUTTON_OFF)}
          >
            <ChevronRight size={17} strokeWidth={2.3} aria-hidden />
          </button>
        )}
      </nav>

      {/* Con los aplazamientos del Mundial la jornada que toca no es la de menor
          numero: si te has ido a otra, hay que decirlo y dar la vuelta en un toque. */}
      {!isDefault && (
        <Link
          href="/jornada"
          className="mt-[9px] flex min-h-[44px] items-center justify-between gap-[10px] rounded-[13px] border border-line bg-sunk px-[13px] py-[9px] transition-transform duration-100 active:scale-[.97] active:opacity-90"
        >
          <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-txt3">
            No es la jornada que se cierra antes
          </span>
          <span className="flex-none text-[11.5px] font-extrabold text-accent2">Ir a la actual</span>
        </Link>
      )}

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
