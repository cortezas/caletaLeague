import { Check } from 'lucide-react'
import Link from 'next/link'

import { cn } from '@/lib/cn'
import { pad2 } from '@/lib/format'
import type { SummaryVM } from '@/lib/view-models'

export interface SummaryRowProps {
  row: SummaryVM['rows'][number]
}

/**
 * Fila numerada del repaso de la jornada.
 *
 * "Falta" no es lo mismo que "no pronosticado y ya cerrado": los dos se pintan
 * en rojo porque en los dos casos el usuario se ha quedado sin puntos, y es el
 * aviso que la pantalla existe para dar.
 */
export function SummaryRow({ row }: SummaryRowProps) {
  const missing = row.myScore === null
  const href = row.status === 'played' ? `/partido/${row.matchId}` : `/jornada/${row.matchId}`

  return (
    <Link
      href={href}
      className={cn(
        'flex min-h-[46px] items-center gap-[11px] rounded-[15px] border px-[13px] py-[11px] transition-transform duration-100 active:scale-[.97] active:opacity-90',
        missing ? 'border-bad bg-bad-soft' : 'border-line bg-card',
      )}
    >
      <span className="w-[22px] flex-none font-num text-[13px] font-bold tabular-nums text-txt3">
        {pad2(row.index)}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-txt">
        {row.label}
      </span>
      <span
        className={cn(
          'flex-none font-num text-[17px] font-bold tracking-[.04em] tabular-nums',
          missing ? 'text-txt3' : 'text-txt',
        )}
      >
        {row.myScore ?? '· ·'}
      </span>
      <StatusDot row={row} missing={missing} />
    </Link>
  )
}

function StatusDot({ row, missing }: { row: SummaryVM['rows'][number]; missing: boolean }) {
  if (missing) {
    return (
      <span
        aria-label="Sin pronosticar"
        role="img"
        className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-bad text-white"
      >
        {/* D16: el signo de exclamacion pelado del prototipo no existe en lucide. */}
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.4"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M12 6v8M12 18v.4" />
        </svg>
      </span>
    )
  }

  if (row.status === 'played') {
    return (
      <span
        aria-label={`${row.points ?? 0} puntos`}
        role="img"
        className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-ok-soft"
      >
        <span className="font-num text-[10px] font-extrabold tabular-nums text-ok">
          {row.points ?? 0}
        </span>
      </span>
    )
  }

  // Pronosticado: violeta mientras se pueda tocar, gris cuando ya esta sellado.
  const editable = row.status === 'open'
  return (
    <span
      aria-label={editable ? 'Pronosticado, aún editable' : 'Pronosticado y sellado'}
      role="img"
      className={cn(
        'flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full',
        editable ? 'bg-accent-soft text-accent2' : 'bg-card2 text-txt3',
      )}
    >
      <Check size={12} strokeWidth={3.2} aria-hidden />
    </span>
  )
}
