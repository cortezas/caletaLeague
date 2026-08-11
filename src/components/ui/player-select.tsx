'use client'

import { Check, ChevronDown, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { cn } from '@/lib/cn'
import { normalizePlayer, samePlayer } from '@/lib/squads'
import type { TeamVM } from '@/lib/view-models'

import { Button } from './button'
import { Card } from './card'
import { TeamBadge } from './team-badge'

export interface PlayerSelectSquad extends TeamVM {
  players: string[]
}

export interface PlayerSelectProps {
  /** Titulo de la tarjeta y del dialogo: 'MVP del partido', 'Goleadores'... */
  label: string
  /** Texto pequeno a la derecha del titular: '+2 pts', '+1 pts por acierto'. */
  hint?: string
  squads: PlayerSelectSquad[]
  /** Nombres marcados. En modo unico es [] o [elegido]. */
  selected: string[]
  /** true en goleadores y asistentes; false en MVP. */
  multiple: boolean
  /**
   * Nombres que la pena ya ha usado en otros pronosticos. Son la unica lista
   * cuando el equipo no trae plantilla cargada.
   */
  suggestions?: string[]
  onToggle: (player: string) => void
  /** Texto del disparador cuando no hay nada elegido. */
  emptyLabel?: string
  /** Hueco bajo el disparador. Lo ocupa el boton «sin goles» en Goleadores. */
  children?: ReactNode
}

const GROUP_LABEL = 'text-[11px] font-extrabold uppercase tracking-[.1em] text-txt3'

/** Tope de nombres ya usados por la pena que se listan de una vez. */
const MAX_SUGGESTIONS = 12

/**
 * Por debajo de esto la ficha no da ni para un once con cambios, asi que se
 * avisa de que falta gente. La API deja equipos justo asi: el Atletico llega
 * con 5 nombres.
 */
const SHORT_SQUAD = 14

/** Chips de la seleccion en el disparador antes de colapsar en «+N». */
const TRIGGER_CHIPS = 2

type Group = { key: string; label: string; team?: TeamVM; players: string[] }

/**
 * Selector de jugador con hoja inferior.
 *
 * POR QUE UNA HOJA Y NO CHIPS EN LINEA
 * Una plantilla real son 20-30 nombres por equipo: pintarlos todos en la
 * pantalla de pronostico levantaba un muro de chips y empujaba el resto del
 * formulario fuera de la vista. Aqui la pantalla solo lleva una fila tocable
 * con lo elegido, y la lista entera vive en una hoja que se abre al pulsar.
 *
 * EL TEXTO LIBRE SIGUE ESTANDO, PERO DE SALIDA
 * Las fichas de la API vienen incompletas (hay equipos con 5 nombres) y faltan
 * fichajes, asi que el campo «¿No está en la lista?» va SIEMPRE al final de la
 * hoja. Escribir un nombre que ya esta en la plantilla no lo duplica: marca su
 * fila, comparando con `samePlayer` (tolera tildes y mayusculas).
 */
export function PlayerSelect({
  label,
  hint,
  squads,
  selected,
  multiple,
  suggestions = [],
  onToggle,
  emptyLabel = 'Elegir jugador',
  children,
}: PlayerSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')

  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const squadNames = useMemo(() => squads.flatMap((squad) => squad.players), [squads])
  const hasSquads = squadNames.length > 0
  const shortSquad = hasSquads && squads.some((squad) => squad.players.length < SHORT_SQUAD)

  // Marcados que no salen en ninguna plantilla: los escritos a mano. Van en su
  // propio grupo para que se distingan de los de plantilla.
  const extras = useMemo(
    () => selected.filter((name) => !squadNames.some((player) => samePlayer(player, name))),
    [selected, squadNames],
  )

  // Buscar sin tildes: escribir "vinicius" tiene que encontrar "Vinícius".
  const needle = normalizePlayer(query)

  const groups = useMemo<Group[]>(() => {
    const match = (name: string) => needle === '' || normalizePlayer(name).includes(needle)

    const out: Group[] = squads.map((squad) => ({
      key: squad.code,
      label: squad.name,
      team: squad,
      players: squad.players.filter(match),
    }))

    const extrasOn = extras.filter(match)
    if (extrasOn.length > 0) {
      out.push({ key: '__extras', label: 'Añadidos a mano', players: extrasOn })
    }

    // Los nombres de la pena solo se listan al buscar (o cuando son la unica
    // lista que hay): sin filtro serian otro muro y no son de este partido.
    if (needle !== '' || !hasSquads) {
      const used: string[] = []
      for (const name of suggestions) {
        if (!match(name)) continue
        if (squadNames.some((player) => samePlayer(player, name))) continue
        if (extras.some((extra) => samePlayer(extra, name))) continue
        if (used.some((other) => samePlayer(other, name))) continue
        used.push(name)
        if (used.length === MAX_SUGGESTIONS) break
      }
      if (used.length > 0) {
        out.push({ key: '__used', label: 'Ya usados por la peña', players: used })
      }
    }

    return out
  }, [squads, needle, extras, suggestions, squadNames, hasSquads])

  const total = groups.reduce((sum, group) => sum + group.players.length, 0)

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setDraft('')
    // Devolver el foco al disparador: si no, el lector de pantalla se queda al
    // principio del documento al cerrar la hoja.
    triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return

    // Bloquear el scroll del fondo mientras la hoja esta abierta.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Escape a nivel de ventana y no del dialogo: asi cierra tambien si el foco
    // se ha ido al velo.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    searchRef.current?.focus()

    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  function pick(player: string) {
    onToggle(player)
    // En seleccion unica la eleccion agota el dialogo; en multiple se sigue
    // marcando sin tener que reabrir.
    if (!multiple) close()
  }

  function add(raw: string) {
    const written = raw.trim().replace(/\s+/g, ' ')
    if (written === '') return
    setDraft('')
    // Manda la forma ya conocida: primero la de la plantilla, luego la que la
    // pena viene usando. Asi no conviven "Mbappe" y "Mbappé" como si fueran dos
    // jugadores distintos, y escribir a alguien de la plantilla marca SU fila.
    const known =
      squadNames.find((player) => samePlayer(player, written)) ??
      suggestions.find((used) => samePlayer(used, written)) ??
      written
    // Ya esta marcado: `onToggle` lo quitaria, y anadir no puede quitar.
    if (selected.some((chosen) => samePlayer(chosen, known))) return
    pick(known)
  }

  const shown = multiple ? selected.slice(0, TRIGGER_CHIPS) : selected
  const rest = multiple ? selected.length - shown.length : 0

  return (
    <Card radius={22} elevated as="section" className="px-[15px] py-[16px]">
      <div className="mb-[11px] flex items-baseline justify-between gap-[10px]">
        <h2 className="text-[14.5px] font-extrabold tracking-[-.01em]">{label}</h2>
        {hint && <span className="flex-none text-[11.5px] font-bold text-txt3">{hint}</span>}
      </div>

      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        // El <h2> de la tarjeta no esta asociado al boton: sin este nombre, el
        // lector de pantalla solo diria "Elegir jugador" sin decir de que.
        aria-label={selected.length > 0 ? `${label}: ${selected.join(', ')}` : `${label}: sin elegir`}
        onClick={() => setOpen(true)}
        className={cn(
          'flex min-h-[52px] w-full items-center gap-[10px] rounded-[14px] border border-line2 bg-sunk px-[13px]',
          'text-left transition-transform duration-100 active:scale-[.99] active:opacity-90',
        )}
      >
        {selected.length === 0 ? (
          <span className="min-w-0 flex-1 text-[14.5px] font-semibold text-txt3">{emptyLabel}</span>
        ) : (
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-[6px]">
            {shown.map((name) => (
              <span
                key={name}
                className="max-w-full truncate rounded-[9px] bg-accent-soft px-[9px] py-[5px] text-[13px] font-bold text-accent2"
              >
                {name}
              </span>
            ))}
            {rest > 0 && (
              <span className="flex-none text-[12.5px] font-bold text-txt3">+{rest} más</span>
            )}
          </span>
        )}
        <ChevronDown size={18} strokeWidth={2.2} aria-hidden className="flex-none text-txt3" />
      </button>

      {children}

      {/* Lectores de pantalla: sin esto, marcar o anadir no anuncia nada. */}
      <p aria-live="polite" className="sr-only">
        {multiple
          ? `${selected.length} en ${label}`
          : selected.length > 0
            ? `${label}: ${selected[0]}`
            : `Sin elegir en ${label}`}
      </p>

      {open && (
        <>
          {/* Velo: cierra al tocar. El boton de cerrar de la hoja es el camino
              accesible, asi que aqui basta con un div. */}
          <div
            aria-hidden
            onClick={close}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className={cn(
              'fixed inset-x-0 bottom-0 z-50 flex max-h-[86vh] flex-col animate-slidein',
              'rounded-t-[22px] border-t border-line bg-bg2 shadow-card',
              'pb-[calc(env(safe-area-inset-bottom)+16px)]',
            )}
          >
            <div aria-hidden className="flex justify-center pt-[9px] pb-[3px]">
              <span className="h-[4px] w-[36px] rounded-[999px] bg-line2" />
            </div>

            {/* Las cuatro bandas se topan a 520 como la barra de accion: en un
                movil ocupan todo el ancho y en pantalla grande no se estiran. */}
            <div className="mx-auto flex w-full max-w-[520px] items-center gap-[10px] px-[15px] pt-[6px] pb-[11px]">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[16px] font-extrabold tracking-[-.01em]">{label}</p>
                <p className="text-[12px] font-semibold text-txt3">
                  {multiple ? 'Marca los que quieras' : 'Elige uno'}
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Cerrar"
                className="flex size-[44px] flex-none items-center justify-center rounded-[13px] border border-line bg-card text-txt2 transition-transform duration-100 active:scale-[.97]"
              >
                <X size={19} strokeWidth={2.3} aria-hidden />
              </button>
            </div>

            <div className="mx-auto w-full max-w-[520px] px-[15px] pb-[12px]">
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                // La hoja vive dentro del <form> del pronostico: sin esto, la
                // tecla "buscar" del teclado de iOS enviaria el formulario.
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.preventDefault()
                }}
                placeholder="Buscar jugador…"
                aria-label={`Buscar jugador en ${label}`}
                autoComplete="off"
                className="block min-h-[44px] w-full rounded-[13px] border border-line2 bg-sunk px-[13px] text-[14.5px] font-medium text-txt outline-none placeholder:text-txt3"
              />
            </div>

            {/* El unico scroller de la hoja: la cabecera y el texto libre se
                quedan fijos y solo corre la lista. */}
            <div className="mx-auto min-h-0 w-full max-w-[520px] flex-1 overflow-y-auto overscroll-contain px-[15px]">
              {groups.map((group) => (
                <div key={group.key} className="mb-[10px]">
                  <div className="sticky top-0 flex items-center gap-[7px] bg-bg2 py-[7px]">
                    {group.team && <TeamBadge team={group.team} size={18} />}
                    <span className={GROUP_LABEL}>{group.label}</span>
                  </div>
                  {group.players.length === 0 ? (
                    <p className="pb-[6px] text-[12.5px] font-semibold text-txt3">
                      {needle === '' ? 'Sin plantilla cargada' : 'Nadie con ese nombre'}
                    </p>
                  ) : (
                    <div className="flex flex-col">
                      {group.players.map((player) => {
                        const on = selected.some((name) => samePlayer(name, player))
                        return (
                          <button
                            key={player}
                            type="button"
                            aria-pressed={on}
                            onClick={() => pick(player)}
                            className={cn(
                              'flex min-h-[48px] items-center gap-[11px] rounded-[12px] px-[10px] text-left',
                              'transition-transform duration-100 active:scale-[.99]',
                              on && 'bg-accent-soft',
                            )}
                          >
                            <span
                              className={cn(
                                'min-w-0 flex-1 truncate text-[14.5px]',
                                on ? 'font-extrabold text-accent2' : 'font-semibold text-txt',
                              )}
                            >
                              {player}
                            </span>
                            {group.key !== '__extras' ? null : (
                              <span className="flex-none text-[11.5px] font-semibold text-txt3">
                                a mano
                              </span>
                            )}
                            <Mark on={on} multiple={multiple} />
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}

              {total === 0 && (
                <p className="rounded-[13px] border border-line bg-sunk px-[13px] py-[11px] text-[12.5px] font-semibold leading-[1.45] text-txt3">
                  {hasSquads
                    ? 'Nadie con ese nombre en la plantilla. Escríbelo abajo y listo.'
                    : 'Todavía no hay plantillas cargadas. Escribe el nombre abajo: la lista se irá completando según la peña los use.'}
                </p>
              )}
            </div>

            {/* El texto libre NO se esconde nunca: es la salida cuando la ficha
                de la API viene coja o cuando el fichaje del verano no esta. */}
            <div className="mx-auto w-full max-w-[520px] border-t border-line px-[15px] pt-[12px]">
              <p className={cn(GROUP_LABEL, 'mb-[8px]')}>¿No está en la lista?</p>

              {shortSquad && (
                <p className="mb-[9px] text-[12px] font-semibold leading-[1.4] text-txt3">
                  Hay equipos con la ficha incompleta. Si falta alguien, escríbelo.
                </p>
              )}

              <div className="flex items-start gap-[8px]">
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  // Enter dentro del <form> del pronostico lo enviaria: aqui
                  // confirma el nombre y nada mas.
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    add(draft)
                  }}
                  placeholder="Nombre del jugador…"
                  aria-label={`Añadir jugador a mano en ${label}`}
                  autoComplete="off"
                  autoCapitalize="words"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="done"
                  className="block min-h-[44px] min-w-0 flex-1 rounded-[13px] border border-line2 bg-sunk px-[13px] text-[14.5px] font-medium text-txt outline-none placeholder:text-txt3"
                />
                <Button
                  variant="primary"
                  size="sm"
                  disabled={draft.trim() === ''}
                  onClick={() => add(draft)}
                  className="flex-none"
                >
                  Añadir
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </Card>
  )
}

/** Casilla en seleccion multiple, punto en seleccion unica. */
function Mark({ on, multiple }: { on: boolean; multiple: boolean }) {
  if (multiple) {
    return (
      <span
        aria-hidden
        className={cn(
          'flex size-[22px] flex-none items-center justify-center rounded-[7px] border',
          on ? 'border-accent bg-accent text-accent-ink' : 'border-line2 bg-transparent',
        )}
      >
        {on && <Check size={14} strokeWidth={3} />}
      </span>
    )
  }

  return (
    <span
      aria-hidden
      className={cn(
        'flex size-[20px] flex-none items-center justify-center rounded-full border',
        on ? 'border-accent' : 'border-line2',
      )}
    >
      {on && <span className="size-[10px] rounded-full bg-accent" />}
    </span>
  )
}
