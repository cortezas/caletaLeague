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
  // `toggle*` SUMA una aparicion (asi se dice "doblete"); `remove*` quita una.
  // Se separan porque desde la lista se añade y desde el chip se quita, y con
  // una sola accion no habria forma de bajar un doblete a un gol.
  | { type: 'toggleScorer'; player: string }
  | { type: 'removeScorer'; player: string }
  | { type: 'toggleAssist'; player: string }
  | { type: 'removeAssist'; player: string }
  | { type: 'toggleNoGoals' }

/** Clamp 0..9 con truncado: el valor puede llegar de un input o de un marcador rapido. */
function clampGoals(value: number): number {
  if (!Number.isFinite(value)) return MIN_GOALS
  return Math.min(MAX_GOALS, Math.max(MIN_GOALS, Math.trunc(value)))
}

/**
 * Suma UNA aparicion del jugador.
 *
 * Tocar a alguien ya marcado ANADE otro gol suyo; asi es como se dice "doblete".
 * Antes lo quitaba, y por eso un doblete no se podia ni escribir -- y quien
 * acertaba uno cobraba lo mismo que quien decia que marcaba una vez.
 *
 * Respeta el tope de goles del pronostico, el mismo que aplican el servidor y la
 * base (migracion 0021): con la lista llena, la pulsacion no hace nada. Quitar
 * es cosa de `removeOne`, que siempre esta disponible desde la hoja.
 *
 * Se compara con `samePlayer` y no con `===` porque `<PlayerSelect>` marca las
 * filas con esa misma regla, y ademas se reutiliza la ortografia ya presente:
 * pulsar "Mbappe" cuando la lista tiene "Mbappé" guarda la segunda igual que la
 * primera, que es como se comparan luego en las pantallas.
 */
function addOne(list: string[], player: string, state: DraftState): string[] {
  if (list.length >= state.home + state.away) return list
  const yaEsta = list.find((name) => samePlayer(name, player))
  return [...list, yaEsta ?? player]
}

/** Quita UNA aparicion, la ultima. Con un doblete, la primera pulsacion lo baja a un gol. */
function removeOne(list: string[], player: string): string[] {
  const i = list.map((name) => samePlayer(name, player)).lastIndexOf(true)
  if (i === -1) return list
  return [...list.slice(0, i), ...list.slice(i + 1)]
}

/**
 * Recorta goleadores y asistentes a los goles del marcador.
 *
 * Hace falta al BAJAR el marcador: si eliges tres goleadores para un 2-1 y luego
 * lo cambias a 1-0, la lista se pasa del tope y el guardado la rechazaria con un
 * error que desde la pantalla no se entiende. Se quitan los ULTIMOS elegidos,
 * que es lo que uno espera al deshacer.
 */
function trimToScore(state: DraftState, home: number, away: number): DraftState {
  const cabe = home + away
  const scorers = state.scorers.length > cabe ? state.scorers.slice(0, cabe) : state.scorers
  const assists = state.assists.length > cabe ? state.assists.slice(0, cabe) : state.assists
  return { ...state, home, away, scorers, assists }
}

export function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case 'setGoals': {
      const value = clampGoals(action.value)
      const home = action.side === 'home' ? value : state.home
      const away = action.side === 'away' ? value : state.away
      if (state.home === home && state.away === away) return state
      return trimToScore(state, home, away)
    }

    case 'setScore': {
      const home = clampGoals(action.home)
      const away = clampGoals(action.away)
      if (state.home === home && state.away === away) return state
      // Los marcadores rapidos fijan el marcador y NO tocan MVP. Goleadores y
      // asistentes solo se tocan si ya no caben.
      return trimToScore(state, home, away)
    }

    case 'toggleMvp':
      // Seleccion unica y deseleccionable: volver a tocar al elegido lo quita.
      return { ...state, mvp: samePlayer(state.mvp, action.player) ? null : action.player }

    case 'toggleScorer':
      // Anadir un goleador apaga "sin goles"; quitarlo no lo vuelve a encender.
      return { ...state, scorers: addOne(state.scorers, action.player, state), noGoals: false }

    case 'removeScorer':
      return { ...state, scorers: removeOne(state.scorers, action.player) }

    case 'toggleAssist':
      // Un pase de gol implica un gol: anadir asistente apaga "sin goles" igual
      // que anadir goleador.
      return { ...state, assists: addOne(state.assists, action.player, state), noGoals: false }

    case 'removeAssist':
      return { ...state, assists: removeOne(state.assists, action.player) }

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
