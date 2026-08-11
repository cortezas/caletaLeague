/**
 * Borrador del editor de pronostico.
 *
 * Puro y sin React a proposito (D6): las reglas del draft son la parte con mas
 * casos limite de toda la pantalla y aqui se pueden probar sin montar nada.
 *
 * D19(a): `noGoals` es un flag EXPLICITO. Nunca se deduce de `scorers.length === 0`
 * ni se vuelve a encender solo al quitar el ultimo goleador. El prototipo lo
 * deducia y eso convertia un pronostico a medias en un "sin goles" involuntario.
 *
 * Goleadores y asistentes son listas INDEPENDIENTES: el mismo jugador puede
 * marcar y asistir en el mismo partido y eso son dos aciertos. Lo unico que
 * comparten es la exclusividad con `noGoals`: sin goles no hay ni goleador ni
 * pase de gol.
 */

import { samePlayer } from '@/lib/squads'

export const MIN_GOALS = 0
export const MAX_GOALS = 9

export interface DraftState {
  home: number
  away: number
  mvp: string | null
  scorers: string[]
  assists: string[]
  noGoals: boolean
}

export type DraftAction =
  | { type: 'setGoals'; side: 'home' | 'away'; value: number }
  | { type: 'setScore'; home: number; away: number }
  | { type: 'toggleMvp'; player: string }
  | { type: 'toggleScorer'; player: string }
  | { type: 'toggleAssist'; player: string }
  | { type: 'toggleNoGoals' }

/** Clamp 0..9 con truncado: el valor puede llegar de un input o de un marcador rapido. */
function clampGoals(value: number): number {
  if (!Number.isFinite(value)) return MIN_GOALS
  return Math.min(MAX_GOALS, Math.max(MIN_GOALS, Math.trunc(value)))
}

/**
 * Quita si estaba, anade al final si no. Misma regla en goleadores y asistentes.
 *
 * Se compara con `samePlayer` y no con `===` porque `<PlayerSelect>` marca las
 * filas con esa misma regla: un nombre guardado como "Mbappe" que luego aparece
 * en la plantilla como "Mbappé" sale marcado en la hoja, y con igualdad exacta
 * volver a tocarlo lo anadiria en vez de quitarlo. El panel de organizador ya
 * togglea asi (`admin-result-form.tsx`).
 */
function toggle(list: string[], player: string): string[] {
  return list.some((name) => samePlayer(name, player))
    ? list.filter((name) => !samePlayer(name, player))
    : [...list, player]
}

export function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case 'setGoals': {
      const value = clampGoals(action.value)
      if (action.side === 'home') {
        return state.home === value ? state : { ...state, home: value }
      }
      return state.away === value ? state : { ...state, away: value }
    }

    case 'setScore': {
      const home = clampGoals(action.home)
      const away = clampGoals(action.away)
      if (state.home === home && state.away === away) return state
      // Los marcadores rapidos fijan el marcador y NO tocan MVP, goleadores ni
      // asistentes.
      return { ...state, home, away }
    }

    case 'toggleMvp':
      // Seleccion unica y deseleccionable: volver a tocar al elegido lo quita.
      return { ...state, mvp: samePlayer(state.mvp, action.player) ? null : action.player }

    case 'toggleScorer': {
      const on = state.scorers.some((name) => samePlayer(name, action.player))
      // Marcar un goleador apaga "sin goles"; quitarlo no lo vuelve a encender.
      return {
        ...state,
        scorers: toggle(state.scorers, action.player),
        noGoals: on ? state.noGoals : false,
      }
    }

    case 'toggleAssist': {
      const on = state.assists.some((name) => samePlayer(name, action.player))
      // Un pase de gol implica un gol: marcar asistente apaga "sin goles" igual
      // que marcar goleador.
      return {
        ...state,
        assists: toggle(state.assists, action.player),
        noGoals: on ? state.noGoals : false,
      }
    }

    case 'toggleNoGoals': {
      const noGoals = !state.noGoals
      // Excluyente en el otro sentido: encender "sin goles" limpia las DOS listas.
      return {
        ...state,
        noGoals,
        scorers: noGoals ? [] : state.scorers,
        assists: noGoals ? [] : state.assists,
      }
    }
  }
}
