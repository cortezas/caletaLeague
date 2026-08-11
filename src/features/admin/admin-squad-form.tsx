'use client'

import { useActionState, useEffect, useState } from 'react'

import { Button, Chip, TeamBadge, useToast } from '@/components/ui'
import { cn } from '@/lib/cn'
import { plural } from '@/lib/format'
import { normalizePlayer } from '@/lib/squads'
import type { AdminSquadVM, TeamVM } from '@/lib/view-models'

import { saveSquadsAction, type SaveState } from './actions'

// El VM vive en `lib/view-models` con los otros ocho. Se reexporta aqui porque
// es donde se ha estado importando desde que existe el formulario.
export type { AdminSquadVM }

export interface AdminSquadFormProps {
  /** Los 20 de la temporada, en el orden en que se quieren listar. */
  teams: TeamVM[]
  /** Plantillas guardadas. Vacio = todavia no se ha cargado ninguna. */
  squads?: AdminSquadVM[]
}

const FIELD =
  'w-full rounded-[12px] border border-line2 bg-sunk px-[12px] py-[10px] text-[13.5px] font-medium leading-[1.55] text-txt outline-none placeholder:text-txt3'

const LABEL = 'mb-[7px] block text-[11px] font-extrabold uppercase tracking-[.11em] text-txt3'

const INITIAL: SaveState = { ok: false, error: null }

/**
 * Un nombre por linea. Se recortan espacios, se tiran las lineas vacias y se
 * deduplica por nombre normalizado: pegar "Mbappe" y "Mbappé" no crea dos
 * jugadores.
 */
function parsePlayers(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  for (const line of text.split('\n')) {
    const name = line.trim().replace(/\s+/g, ' ')
    if (name === '') continue
    const key = normalizePlayer(name)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }

  return out
}

/**
 * Corregir plantillas de una en una. La ingesta trae las fichas de la API, pero
 * llegan incompletas (hay equipos con 5 nombres) y sin los ultimos fichajes:
 * esta pantalla es donde el organizador las arregla.
 *
 * Solo se guarda el equipo que hay en pantalla. Lo tecleado en los otros no se
 * pierde al cambiar de equipo, pero tampoco se envia: cada equipo, su guardado.
 */
export function AdminSquadForm({ teams, squads = [] }: AdminSquadFormProps) {
  const showToast = useToast()
  const [state, formAction, pending] = useActionState(saveSquadsAction, INITIAL)
  const [code, setCode] = useState<string>(teams[0]?.code ?? '')
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  useEffect(() => {
    if (state.ok) showToast('Plantilla guardada.')
    else if (state.error) showToast(state.error, 'bad')
  }, [state, showToast])

  const team = teams.find((item) => item.code === code)
  if (!team) return null

  const stored = squads.find((squad) => squad.code === code) ?? null
  const savedText = (stored?.players ?? []).join('\n')
  const text = drafts[code] ?? savedText
  const players = parsePlayers(text)
  const dirty = players.join('\n') !== savedText

  // El payload viaja serializado, igual que en AdminResultForm. Va UN solo
  // equipo: la accion acepta la lista, y mandar solo el de pantalla evita
  // reescribir de paso los otros 19 (y marcarlos como corregidos a mano).
  const payload = JSON.stringify([{ code, players }])

  return (
    <form action={formAction} className="flex flex-col gap-[13px] px-[14px] pt-[14px] pb-[30px]">
      <input type="hidden" name="squads" value={payload} readOnly />

      <p className="rounded-[14px] border border-line bg-warn-soft px-[13px] py-[11px] text-[12.5px] font-semibold leading-[1.45] text-txt2">
        Las fichas de la API vienen cojas y sin los últimos fichajes. Lo que corrijas aquí manda: la
        ingesta ya no vuelve a pisarlo.
      </p>

      <label className="block">
        <span className={LABEL}>Equipo</span>
        <div className="flex items-center gap-[10px]">
          <TeamBadge team={team} size={26} />
          <select
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className={cn(FIELD, 'min-h-[44px] flex-1')}
          >
            {teams.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      </label>

      <div className="rounded-[17px] border border-line bg-card px-[14px] py-[13px]">
        <div className="mb-[10px] flex flex-wrap items-center gap-[7px]">
          <Chip tone={stored === null ? 'neutral' : stored.source === 'admin' ? 'ok' : 'accent'}>
            {stored === null
              ? 'Sin plantilla'
              : stored.source === 'admin'
                ? 'Corregida a mano'
                : 'De la API'}
          </Chip>
          <Chip tone={players.length > 0 ? 'neutral' : 'warn'}>
            {plural(players.length, 'jugador', 'jugadores')}
          </Chip>
          {dirty && <Chip tone="warn">Sin guardar</Chip>}
        </div>

        <textarea
          aria-label={`Plantilla del ${team.name}, un jugador por línea`}
          rows={12}
          value={text}
          onChange={(event) =>
            setDrafts((prev) => ({ ...prev, [code]: event.target.value }))
          }
          // Sin nombres de ejemplo: cualquiera que se escribiera aqui seria un
          // futbolista inventado o traspasado.
          placeholder="Un jugador por línea"
          className={cn(FIELD, 'min-h-[240px] resize-y')}
        />
      </div>

      <p className="rounded-[14px] border border-line bg-card px-[14px] py-[12px] text-[12.5px] font-semibold leading-[1.45] text-txt2">
        {players.length > 0
          ? 'Al guardar, esta plantilla sale como chips en el selector de MVP y goleadores. La peña puede seguir escribiendo a mano a quien falte.'
          : 'Sin plantilla, este equipo se escribe entero a mano en cada pronóstico.'}
      </p>

      <Button type="submit" variant="primary" size="lg" fullWidth loading={pending}>
        Guardar plantilla del {team.name}
      </Button>
    </form>
  )
}
