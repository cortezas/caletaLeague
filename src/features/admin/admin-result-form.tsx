'use client'

import { Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { useActionState, useEffect, useState } from 'react'

import { Button, Chip, PlayerSelect, useToast } from '@/components/ui'
import type { ChipTone } from '@/components/ui'
import { cn } from '@/lib/cn'
import { TEAM_CODES, TEAMS } from '@/lib/laliga'
import { normalizePlayer, samePlayer } from '@/lib/squads'
import type { TeamCode } from '@/lib/types'
import type { AdminMatchVM, TeamVM } from '@/lib/view-models'

import { saveMatchResultAction, type SaveState } from './actions'

const INITIAL: SaveState = { ok: false, error: null }

type Row = {
  home: string
  away: string
  mvp: string
  scorers: string[]
  assists: string[]
}

/** Red de seguridad: tras un revalidate pueden llegar partidos que no estaban en el estado. */
const EMPTY_ROW: Row = { home: '', away: '', mvp: '', scorers: [], assists: [] }

/** Grupo de la hoja de seleccion: un club y sus fichas. */
type MatchSquad = TeamVM & { players: string[] }

/**
 * El VM de admin manda hoy los jugadores de los dos equipos en UNA lista plana.
 * `squads` es el campo agrupado que se lee si algun dia llega; mientras no
 * exista, `squadsOf` cae a un solo grupo.
 */
type AdminMatchWithSquads = AdminMatchVM & { squads?: MatchSquad[] }

/** Nombre corto -> codigo. `matchLabel()` compone la etiqueta con estos nombres. */
const CODE_BY_NAME = new Map<string, TeamCode>(TEAM_CODES.map((code) => [TEAMS[code].name, code]))

/**
 * Los grupos que se le pasan al selector.
 *
 * Sin el reparto por equipo se agrupa el partido entero bajo una sola cabecera
 * en vez de repartir las fichas a ojo: el VM no dice de quien es cada jugador y
 * adivinarlo seria inventarse la plantilla. Si ni la etiqueta resuelve (solo
 * pasa con datos de mock) se devuelve vacio y el selector se queda con el texto
 * libre y las sugerencias, que es su salida de siempre.
 */
function squadsOf(match: AdminMatchWithSquads): MatchSquad[] {
  if (match.squads && match.squads.length > 0) return match.squads
  if (match.players.length === 0) return []

  const code = CODE_BY_NAME.get(match.label.split(' – ')[0] ?? '')
  if (!code) return []

  return [
    {
      code,
      name: match.label,
      color: TEAMS[code].color,
      ink: TEAMS[code].ink,
      players: match.players,
    },
  ]
}

/**
 * Solo se puede rellenar el resultado de un partido ya jugado: el estado lo
 * manda la API, no el organizador. Los demas se pintan en solo lectura con el
 * motivo, igual que en el prototipo.
 */
function statusChip(match: AdminMatchVM): { label: string; tone: ChipTone; alert: boolean } {
  if (match.status === 'played') {
    return match.missingMvp
      ? { label: 'Falta el MVP', tone: 'warn', alert: true }
      : { label: 'Confirmado', tone: 'ok', alert: false }
  }
  if (match.status === 'live') return { label: 'En juego', tone: 'bad', alert: false }
  // 'locked' es el pitido inicial ya pasado sin resultado en la base: la ingesta
  // no lo ha traido. Se marca como pendiente porque es lo que el organizador
  // tiene que resolver, aunque el partido acabe de empezar.
  if (match.status === 'locked') {
    return { label: 'Falta el resultado', tone: 'warn', alert: true }
  }
  return { label: 'Abierto', tone: 'neutral', alert: false }
}

function placeholderFor(match: AdminMatchVM): string {
  if (match.status === 'live') return 'Al acabar el partido'
  // El marcador de un partido ya empezado lo trae la API, no se teclea aqui:
  // hasta que llegue, el MVP y los goleadores no se pueden meter.
  if (match.status === 'locked') return 'Esperando la sincronización'
  return 'Aún no ha empezado'
}

const FIELD = 'min-h-[44px] rounded-[12px] border border-line2 bg-sunk'

export interface AdminResultFormProps {
  matches: AdminMatchVM[]
  /** Solo para el aviso: "se recalculan los puntos de los 12". */
  memberCount: number
}

export function AdminResultForm({ matches, memberCount }: AdminResultFormProps) {
  const showToast = useToast()
  const [state, formAction, pending] = useActionState(saveMatchResultAction, INITIAL)

  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      matches.map((m) => [
        m.id,
        {
          home: m.result ? String(m.result.home) : '',
          away: m.result ? String(m.result.away) : '',
          mvp: m.result?.mvp ?? '',
          scorers: m.result?.scorers ?? [],
          assists: m.result?.assists ?? [],
        },
      ]),
    ),
  )

  useEffect(() => {
    if (state.ok) showToast('Resultados guardados. Puntos recalculados.')
    else if (state.error) showToast(state.error, 'bad')
  }, [state, showToast])

  function patch(id: string, change: Partial<Row>) {
    setRows((prev) => ({ ...prev, [id]: { ...EMPTY_ROW, ...prev[id], ...change } }))
  }

  /**
   * El candidato a MVP: el que mas goles + asistencias hizo en el partido.
   *
   * ES UNA SUGERENCIA, NO UNA DECISION, y esa distincion es todo lo que hay
   * aqui. Contrastada contra los 30 MVP que ya estaban puestos a mano, esta
   * cuenta acierta 15 de 30. La API no da valoraciones de jugador -- comprobado
   * en /statistics, /lineups, /players y /matches: no existe el campo --, asi
   * que automatizarlo del todo significaria repartir 2 puntos por una cuenta
   * que falla la mitad de las veces, y en cuatro de cada diez jornadas
   * designaria a alguien que la peña no aceptaria: en el Athletic 2-0 Barcelona
   * el MVP fue Unai Simon, portero del equipo que perdio, y ninguna cuenta de
   * goles llega ahi.
   *
   * Con el gol por delante en el desempate: un 2G vale mas que un 1G+1A.
   * Empate arriba = no se sugiere nada, que es mas honesto que elegir por orden
   * alfabetico.
   */
  function candidatoMvp(row: Row): string | null {
    const cuenta = new Map<string, { goles: number; asis: number }>()
    for (const g of row.scorers) {
      const k = normalizePlayer(g)
      if (k === '') continue
      const v = cuenta.get(k) ?? { goles: 0, asis: 0 }
      cuenta.set(k, { ...v, goles: v.goles + 1 })
    }
    for (const a of row.assists) {
      const k = normalizePlayer(a)
      if (k === '') continue
      const v = cuenta.get(k) ?? { goles: 0, asis: 0 }
      cuenta.set(k, { ...v, asis: v.asis + 1 })
    }
    if (cuenta.size === 0) return null

    const nombrePorClave = new Map<string, string>()
    for (const n of [...row.scorers, ...row.assists]) {
      const k = normalizePlayer(n)
      if (k !== '' && !nombrePorClave.has(k)) nombrePorClave.set(k, n)
    }

    const orden = [...cuenta.entries()].sort(
      (a, b) =>
        b[1].goles + b[1].asis - (a[1].goles + a[1].asis) || b[1].goles - a[1].goles,
    )
    const [mejor, segundo] = orden
    if (segundo) {
      const puntos = (x: [string, { goles: number; asis: number }]) => [
        x[1].goles + x[1].asis,
        x[1].goles,
      ]
      const [p1, g1] = puntos(mejor)
      const [p2, g2] = puntos(segundo)
      // Empate arriba: mejor no sugerir que sugerir a medias.
      if (p1 === p2 && g1 === g2) return null
    }
    return nombrePorClave.get(mejor[0]) ?? null
  }

  /** Seleccion unica: volver a tocar al elegido lo suelta. */
  function toggleMvp(id: string, name: string) {
    const current = rows[id]?.mvp ?? ''
    patch(id, { mvp: samePlayer(current, name) ? '' : name })
  }

  /**
   * Goleadores y asistentes son listas INDEPENDIENTES: el mismo jugador puede
   * estar en las dos y son dos aciertos. Se compara con `samePlayer` para que
   * "Mbappe" no entre otra vez como "Mbappé", y se reutiliza la grafia que ya
   * este en la lista.
   *
   * SUMA UNA APARICION, no alterna. Pulsar dos veces al mismo jugador es como se
   * anota un DOBLETE, que es justo lo que `calc_points` cuenta desde la migracion
   * 0022. Antes la segunda pulsacion lo quitaba, asi que un doblete real no se
   * podia escribir aqui ni para corregir un partido: el Elche 0-5 Barcelona se
   * guardo con 3 nombres para 5 goles y este formulario no permitia arreglarlo.
   *
   * Es el mismo par `addOne`/`removeOne` del editor de pronosticos
   * (src/features/predict/reducer.ts), que ya se migro en su dia y aqui se quedo
   * sin migrar.
   */
  function addToList(id: string, key: 'scorers' | 'assists', name: string) {
    const list = rows[id]?.[key] ?? []
    const yaEsta = list.find((chosen) => samePlayer(chosen, name))
    patch(id, { [key]: [...list, yaEsta ?? name] })
  }

  /** Quita UNA aparicion, la ultima. Con un doblete, baja a un gol. */
  function removeFromList(id: string, key: 'scorers' | 'assists', name: string) {
    const list = rows[id]?.[key] ?? []
    const i = list.map((chosen) => samePlayer(chosen, name)).lastIndexOf(true)
    if (i === -1) return
    patch(id, { [key]: [...list.slice(0, i), ...list.slice(i + 1)] })
  }

  // El payload viaja en un solo campo: son 10 partidos con tres listas de
  // jugadores, y aplanarlo a campos sueltos de FormData solo complica las dos
  // partes.
  const payload = JSON.stringify(matches.map((m) => ({ id: m.id, ...(rows[m.id] ?? EMPTY_ROW) })))

  return (
    <form action={formAction} className="flex flex-col gap-[9px] px-[14px] pt-[14px] pb-[30px]">
      <input type="hidden" name="results" value={payload} readOnly />

      <p className="rounded-[14px] border border-line bg-warn-soft px-[13px] py-[11px] text-[12.5px] font-semibold leading-[1.45] text-txt2">
        El marcador lo trae la API. El MVP, los goleadores y los asistentes los metes tú: el plan
        gratuito no los da. Al guardar, se recalculan los puntos de los {memberCount}.
      </p>

      {matches.map((match) => {
        const row = rows[match.id] ?? EMPTY_ROW
        const chip = statusChip(match)
        const editable = match.status === 'played'
        const [homeName = 'local', awayName = 'visitante'] = match.label.split(' – ')
        const squads = squadsOf(match)

        return (
          <div
            key={match.id}
            className={cn(
              'rounded-[17px] border bg-card px-[14px] py-[13px]',
              chip.alert ? 'border-warn' : 'border-line',
            )}
          >
            <div className="mb-[11px] flex items-center gap-[8px]">
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold">{match.label}</span>
              <Chip tone={chip.tone}>{chip.label}</Chip>
            </div>

            <div className="mb-[10px] flex items-center gap-[9px]">
              <span className="flex-1 text-[12.5px] font-semibold text-txt3">Resultado</span>
              <div className="flex flex-none items-center gap-[6px]">
                <ScoreBox
                  value={row.home}
                  label={`Goles del ${homeName}`}
                  editable={editable}
                  onChange={(v) => patch(match.id, { home: v })}
                />
                <span className="font-bold text-txt3">–</span>
                <ScoreBox
                  value={row.away}
                  label={`Goles del ${awayName}`}
                  editable={editable}
                  onChange={(v) => patch(match.id, { away: v })}
                />
              </div>
            </div>

            {/* Meter el resultado se hace con el MISMO selector con el que la
                peña pronostica: tres hojas iguales, no tres campos distintos. */}
            {editable ? (
              <div className="flex flex-col gap-[7px]">
                <PlayerSelect
                  label="MVP del partido"
                  hint={`El de verdad de ${match.label}`}
                  squads={squads}
                  selected={row.mvp === '' ? [] : [row.mvp]}
                  multiple={false}
                  suggestions={match.players}
                  onToggle={(name) => toggleMvp(match.id, name)}
                />
                {/* La API no da MVP y deducirlo acierta la mitad de las veces:
                    se propone y decides tu. Nunca se rellena solo. */}
                {(() => {
                  const sugerido = row.mvp === '' ? candidatoMvp(row) : null
                  if (!sugerido) return null
                  return (
                    <button
                      type="button"
                      onClick={() => patch(match.id, { mvp: sugerido })}
                      className="flex min-h-[38px] items-center gap-[7px] self-start rounded-[11px] border border-line2 bg-transparent px-[11px] text-[12.5px] font-bold text-txt2 transition-transform duration-100 active:scale-[.97]"
                    >
                      <Sparkles size={14} strokeWidth={2.3} aria-hidden className="text-accent2" />
                      ¿{sugerido}? · el que más hizo
                    </button>
                  )
                })()}
                <PlayerSelect
                  label="Goleadores"
                  hint="Uno por gol. Dos veces al mismo = doblete"
                  squads={squads}
                  selected={row.scorers}
                  multiple
                  suggestions={match.players}
                  onToggle={(name) => addToList(match.id, 'scorers', name)}
                  onRemove={(name) => removeFromList(match.id, 'scorers', name)}
                  emptyLabel="Sin goleadores"
                />
                <PlayerSelect
                  label="Asistentes"
                  hint="Uno por asistencia. Dos veces al mismo = dos pases"
                  squads={squads}
                  selected={row.assists}
                  multiple
                  suggestions={match.players}
                  onToggle={(name) => addToList(match.id, 'assists', name)}
                  onRemove={(name) => removeFromList(match.id, 'assists', name)}
                  emptyLabel="Sin asistentes"
                />
              </div>
            ) : (
              <div className="flex flex-col gap-[7px]">
                <ReadOnlyRow label="MVP">{placeholderFor(match)}</ReadOnlyRow>
                <ReadOnlyRow label="Goleadores">{placeholderFor(match)}</ReadOnlyRow>
                <ReadOnlyRow label="Asistentes">{placeholderFor(match)}</ReadOnlyRow>
              </div>
            )}
          </div>
        )
      })}

      <Button type="submit" variant="primary" size="lg" fullWidth loading={pending} className="mt-[5px]">
        Guardar y recalcular puntos
      </Button>
    </form>
  )
}

function ScoreBox({
  value,
  label,
  editable,
  onChange,
}: {
  value: string
  label: string
  editable: boolean
  onChange: (v: string) => void
}) {
  if (!editable) {
    return (
      <span
        className={cn(FIELD, 'flex w-[52px] items-center justify-center font-num text-[21px] font-bold text-txt3')}
      >
        {value === '' ? '–' : value}
      </span>
    )
  }

  return (
    <input
      aria-label={label}
      // `type=number` en iOS trae flechas y permite pegar '1e3'; con inputMode
      // sale el teclado numerico igual y el saneado es explicito.
      type="text"
      inputMode="numeric"
      maxLength={2}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 2))}
      className={cn(FIELD, 'w-[52px] text-center font-num text-[21px] font-bold text-txt outline-none')}
    />
  )
}

function ReadOnlyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-[9px]">
      <span className="w-[82px] flex-none text-[12.5px] font-semibold text-txt3">{label}</span>
      <span
        className={cn(FIELD, 'flex min-w-0 flex-1 items-center px-[12px] text-[13.5px] font-semibold text-txt3')}
      >
        {children}
      </span>
    </div>
  )
}
