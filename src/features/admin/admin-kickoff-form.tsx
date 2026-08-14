'use client'

import { useActionState, useEffect, useState } from 'react'

import { Button, Chip, useToast } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { AdminMatchVM } from '@/lib/view-models'

import { saveKickoffsAction, type SaveState } from './actions'

export interface AdminKickoffFormProps {
  matches: AdminMatchVM[]
}

const FIELD =
  'w-full rounded-[12px] border border-line2 bg-sunk px-[12px] py-[10px] text-[13.5px] font-medium leading-[1.55] text-txt outline-none placeholder:text-txt3'

const LABEL = 'mb-[7px] block text-[11px] font-extrabold uppercase tracking-[.11em] text-txt3'

const INITIAL: SaveState = { ok: false, error: null }

/**
 * ISO en UTC -> `YYYY-MM-DD` y `HH:MM` de PARED DE MADRID.
 *
 * Se fija el huso a Madrid en vez de usar la hora local del navegador: la peña
 * es de aqui y los horarios de LaLiga se leen en hora de Madrid. Un movil con el
 * huso mal puesto (o alguien de viaje) veria el partido a otra hora y "corregiria"
 * un horario que estaba bien.
 */
function toMadridParts(iso: string): { day: string; time: string } {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return { day: '', time: '' }

  // `en-CA` da la fecha ya en `YYYY-MM-DD`, que es justo lo que quiere el input.
  const day = at.toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' })
  const time = at.toLocaleTimeString('es-ES', {
    timeZone: 'Europe/Madrid',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return { day, time }
}

/** Como se lee la hora guardada en la lista, en hora de Madrid. */
function label(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return 'sin hora'
  return at.toLocaleString('es-ES', {
    timeZone: 'Europe/Madrid',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

type Draft = { day: string; time: string }

/**
 * Corregir a mano la hora de un partido aplazado.
 *
 * POR QUE HACE FALTA
 * Cuando LaLiga aplaza un partido, football-data.org tarda en enterarse. Y de
 * `kickoff_at` cuelgan tres cosas a la vez: cuando se cierra el pronostico, el
 * estado que se pinta y la RLS que destapa los pronosticos ajenos. Con la hora
 * vieja, la peña se queda sin poder pronosticar un partido que no se ha jugado y
 * ademas se le ven las apuestas a todo el mundo.
 *
 * Se guarda de UNO en uno a proposito: tocar la hora de un partido es una
 * decision, no un formulario de doce campos que se envia entero sin mirar.
 *
 * Un partido ya empezado no aparece editable: moverle la hora hacia adelante
 * volveria a esconder pronosticos que la peña ya tiene vistos. La regla la
 * impone tambien el servidor (`gt('kickoff_at', ahora)`); aqui solo se evita
 * ofrecer algo que va a rebotar.
 */
export function AdminKickoffForm({ matches }: AdminKickoffFormProps) {
  const showToast = useToast()
  const [state, formAction, pending] = useActionState(saveKickoffsAction, INITIAL)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [selected, setSelected] = useState<string>('')

  useEffect(() => {
    if (state.ok) showToast('Horario guardado.')
    else if (state.error) showToast(state.error, 'bad')
  }, [state, showToast])

  // 'open' es exactamente "aun no ha empezado": `effectiveStatus` lo deriva del
  // reloj, asi que no hay que volver a comparar fechas aqui.
  const editable = matches.filter((match) => match.status === 'open')

  if (editable.length === 0) {
    return (
      <div className="px-[14px] pt-[14px] pb-[30px]">
        <p className="rounded-[14px] border border-line bg-card px-[14px] py-[12px] text-[12.5px] font-semibold leading-[1.45] text-txt2">
          En esta jornada no queda ningún partido por empezar, así que no hay horario que mover. Una
          hora ya pasada no se toca: movería pronósticos que la peña ya tiene vistos.
        </p>
      </div>
    )
  }

  const current = editable.find((match) => match.id === selected) ?? editable[0]
  const saved = toMadridParts(current.kickoffAt)
  const draft = drafts[current.id] ?? saved
  const dirty = draft.day !== saved.day || draft.time !== saved.time

  const payload = JSON.stringify([
    { id: current.id, day: draft.day, time: draft.time, manual: true },
  ])
  const release = JSON.stringify([{ id: current.id, day: '', time: '', manual: false }])

  return (
    <div className="flex flex-col gap-[13px] px-[14px] pt-[14px] pb-[30px]">
      <p className="rounded-[14px] border border-line bg-warn-soft px-[13px] py-[11px] text-[12.5px] font-semibold leading-[1.45] text-txt2">
        Solo para aplazamientos. La API tarda en publicarlos, y hasta que lo hace la peña no puede
        pronosticar ese partido. Lo que pongas aquí manda: la ingesta deja de tocarlo.
      </p>

      <label className="block">
        <span className={LABEL}>Partido</span>
        <select
          value={current.id}
          onChange={(event) => setSelected(event.target.value)}
          className={cn(FIELD, 'min-h-[44px]')}
        >
          {editable.map((match) => (
            <option key={match.id} value={match.id}>
              {match.label} · {label(match.kickoffAt)}
            </option>
          ))}
        </select>
      </label>

      <div className="rounded-[17px] border border-line bg-card px-[14px] py-[13px]">
        <div className="mb-[11px] flex flex-wrap items-center gap-[7px]">
          <Chip tone={current.kickoffManual ? 'ok' : 'accent'}>
            {current.kickoffManual ? 'Puesta a mano' : 'De la API'}
          </Chip>
          {dirty && <Chip tone="warn">Sin guardar</Chip>}
        </div>

        <div className="flex gap-[10px]">
          <label className="block flex-1">
            <span className={LABEL}>Día</span>
            <input
              type="date"
              value={draft.day}
              onChange={(event) =>
                setDrafts((prev) => ({ ...prev, [current.id]: { ...draft, day: event.target.value } }))
              }
              className={cn(FIELD, 'min-h-[44px]')}
            />
          </label>
          <label className="block w-[124px] flex-none">
            <span className={LABEL}>Hora</span>
            <input
              type="time"
              value={draft.time}
              onChange={(event) =>
                setDrafts((prev) => ({ ...prev, [current.id]: { ...draft, time: event.target.value } }))
              }
              className={cn(FIELD, 'min-h-[44px]')}
            />
          </label>
        </div>

        <p className="mt-[10px] text-[12px] font-semibold leading-[1.45] text-txt3">
          Hora de Madrid. Ahora mismo: {label(current.kickoffAt)}.
        </p>
      </div>

      <form action={formAction}>
        <input type="hidden" name="kickoffs" value={payload} readOnly />
        <Button type="submit" variant="primary" size="lg" fullWidth loading={pending}>
          Guardar horario
        </Button>
      </form>

      {/* Segundo formulario y no un boton dentro del primero: son dos envios
          distintos con dos cargas distintas, y anidar <form> no es HTML valido. */}
      {current.kickoffManual && (
        <form action={formAction}>
          <input type="hidden" name="kickoffs" value={release} readOnly />
          <Button type="submit" variant="ghost" size="lg" fullWidth loading={pending}>
            Volver a seguir a la API
          </Button>
          <p className="mt-[8px] text-[12px] font-semibold leading-[1.45] text-txt3">
            La hora vuelve a ser la oficial en la siguiente pasada del cron, como mucho una hora.
            Conviene hacerlo cuando la API ya publique el aplazamiento: si no, una corrección de hoy
            seguiría mandando en abril.
          </p>
        </form>
      )}
    </div>
  )
}
