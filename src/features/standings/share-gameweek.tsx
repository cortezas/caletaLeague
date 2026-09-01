'use client'

import { Check, Copy } from 'lucide-react'
import { useState } from 'react'

import { Button, useToast } from '@/components/ui'
import type { GameweekStandingsVM } from '@/lib/view-models'

/**
 * El resumen de la jornada, listo para pegar en el grupo.
 *
 * La peña vive en WhatsApp: el resultado de cada jornada se cuenta alli de todas
 * formas, escrito a mano y a veces mal. Esto lo escribe la app con los datos
 * buenos y en un toque.
 *
 * SOLO CON LA JORNADA ACABADA. A media jornada el podio cambia cada partido y el
 * reparto de euros todavia no existe (`dues.ts` solo lo calcula con los diez
 * jugados), asi que un resumen adelantado seria mentira con formato bonito.
 *
 * Texto plano y sin markdown: WhatsApp no lo renderiza y los asteriscos se leen
 * como asteriscos.
 */
export function ShareGameweek({ standings }: { standings: GameweekStandingsVM }) {
  const showToast = useToast()
  const [copiado, setCopiado] = useState(false)

  const acabada = standings.rows.length > 0 && standings.rows.every((r) => r.pendingCount === 0)
  if (!acabada) return null

  const podio = standings.rows.slice(0, 3)
  const pagan = standings.rows.filter((r) => r.euros !== null)
  const medallas = ['1.', '2.', '3.']

  const lineas = [
    `JORNADA ${standings.number} - LA CALETA LEAGUE`,
    '',
    ...podio.map((r, i) => `${medallas[i] ?? `${r.position}.`} ${r.displayName} - ${r.points} pts`),
  ]

  if (pagan.length > 0) {
    lineas.push('', 'A pagar:')
    // De mas a menos, que es como se lee el castigo.
    for (const r of [...pagan].sort((a, b) => (b.euros ?? 0) - (a.euros ?? 0))) {
      lineas.push(`  ${r.displayName}: ${r.euros} EUR`)
    }
  }

  const texto = lineas.join('\n')

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
      showToast('Copiado. Pégalo en el grupo.')
    } catch {
      showToast('No hemos podido copiar. Seleccionalo a mano.', 'bad')
    }
  }

  return (
    <div className="rounded-[17px] border border-line bg-card px-[14px] py-[13px]">
      <p className="mb-[9px] text-[13px] font-extrabold">Resumen para el grupo</p>
      <pre className="mb-[11px] overflow-x-auto whitespace-pre-wrap rounded-[12px] bg-sunk px-[12px] py-[10px] font-num text-[12px] leading-[1.6] text-txt2">
        {texto}
      </pre>
      <Button
        variant="secondary"
        size="sm"
        fullWidth
        onClick={copiar}
        leading={
          copiado ? (
            <Check size={15} strokeWidth={2.6} aria-hidden />
          ) : (
            <Copy size={15} strokeWidth={2.3} aria-hidden />
          )
        }
      >
        {copiado ? 'Copiado' : 'Copiar'}
      </Button>
    </div>
  )
}
