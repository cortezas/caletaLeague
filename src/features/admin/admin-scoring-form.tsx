'use client'

import { useActionState, useEffect, useState } from 'react'

import { Button, Stepper, useToast } from '@/components/ui'
import type { Scoring } from '@/lib/types'

import { saveScoringAction, type SaveState } from './actions'

const INITIAL: SaveState = { ok: false, error: null }

const MIN = 0
const MAX = 20

/**
 * Las reglas del handoff, en orden. La clave es la de `Scoring`.
 * `assist` va justo detras de `scorer` porque se lee en pareja, y tiene que
 * estar: el CHECK `leagues_scoring_shape` exige las seis claves.
 */
const RULES: Array<{ key: keyof Scoring; label: string; description: string }> = [
  { key: 'exact', label: 'Resultado exacto', description: 'Clavar el marcador de los dos equipos' },
  { key: 'x2', label: 'Acertar el 1X2', description: 'Solo el signo: victoria, empate o derrota' },
  { key: 'mvp', label: 'MVP del partido', description: 'El jugador del partido según la peña' },
  { key: 'scorer', label: 'Cada goleador', description: 'Por cada goleador que acierte, sin orden' },
  { key: 'assist', label: 'Cada asistente', description: 'Por cada pase de gol acertado, sin orden' },
  { key: 'pleno', label: 'Pleno al 1X2', description: 'Extra por acertar el signo de los 10 partidos' },
]

export interface AdminScoringFormProps {
  scoring: Scoring
  /** Solo para la nota al pie: "Se avisa a los 12". */
  memberCount: number
}

export function AdminScoringForm({ scoring, memberCount }: AdminScoringFormProps) {
  const showToast = useToast()
  const [state, formAction, pending] = useActionState(saveScoringAction, INITIAL)
  const [values, setValues] = useState<Scoring>(scoring)

  useEffect(() => {
    if (state.ok) showToast('Puntuación guardada. Temporada recalculada.')
    else if (state.error) showToast(state.error, 'bad')
  }, [state, showToast])

  return (
    <form action={formAction} className="flex flex-col gap-[9px] px-[14px] pt-[14px] pb-[30px]">
      {RULES.map((rule) => (
        <div
          key={rule.key}
          className="flex items-center gap-[12px] rounded-[17px] border border-line bg-card px-[14px] py-[13px]"
        >
          {/* El Stepper es un control, no un input: el valor viaja aparte. */}
          <input type="hidden" name={rule.key} value={values[rule.key]} readOnly />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold">{rule.label}</div>
            <p className="text-[12px] font-semibold leading-[1.35] text-txt3">{rule.description}</p>
          </div>
          <Stepper
            size={44}
            label={rule.label}
            value={values[rule.key]}
            min={MIN}
            max={MAX}
            onValueChange={(v) => setValues((prev) => ({ ...prev, [rule.key]: v }))}
          />
        </div>
      ))}

      <p className="mt-[4px] rounded-[14px] border border-line bg-card px-[14px] py-[12px] text-[12.5px] font-semibold leading-[1.45] text-txt2">
        Cambiar la puntuación recalcula toda la temporada. Se avisa a los {memberCount} con una
        notificación.
      </p>

      <Button type="submit" variant="primary" size="lg" fullWidth loading={pending} className="mt-[5px]">
        Guardar puntuación
      </Button>
    </form>
  )
}
