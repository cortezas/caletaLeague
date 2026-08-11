/**
 * Datos de demostracion de la PEÑA. Aqui no hay nada de LaLiga.
 *
 * Reparto de responsabilidades:
 *  - equipos y calendario de las 38 jornadas -> `src/lib/laliga.ts`
 *  - plantillas de jugadores                 -> `src/lib/squads.ts` (vacias por defecto)
 *  - partidos, pronosticos y resultados de demo -> se generan en `src/lib/data/mock.ts`
 *
 * Lo que queda aqui son los 12 de la peña y sus cifras de temporada, que no salen
 * de ninguna API: sirven para renderizar la app en desarrollo sin Supabase y para
 * poblar la base de datos con el seed SQL.
 */

import type { Member } from './types'

/** Paleta de avatares ofrecida en el onboarding. */
export const AVATAR_COLORS = [
  '#7C5CFF', '#F2455F', '#F5A524', '#3ED27E',
  '#1AA0DB', '#E0143C', '#6E2E8F', '#0E9F5A',
] as const

/** Los 12 participantes de la pena. `isMe` marca al usuario del prototipo. */
export const PEOPLE: Member[] = [
  { id: 'm1', displayName: 'Rocío P.', avatarColor: '#F2455F' },
  { id: 'm2', displayName: 'Kiko S.', avatarColor: '#F5A524' },
  { id: 'm3', displayName: 'Manu G.', avatarColor: '#1AA0DB' },
  { id: 'm4', displayName: 'Curro M.', avatarColor: '#7C5CFF', isMe: true },
  { id: 'm5', displayName: 'Bea L.', avatarColor: '#3ED27E' },
  { id: 'm6', displayName: 'Paqui R.', avatarColor: '#E0143C' },
  { id: 'm7', displayName: 'Álvaro T.', avatarColor: '#6E2E8F' },
  { id: 'm8', displayName: 'Inma C.', avatarColor: '#0E9F5A' },
  { id: 'm9', displayName: 'Lolo B.', avatarColor: '#2B4C7E' },
  { id: 'm10', displayName: 'Vane D.', avatarColor: '#B31942' },
  { id: 'm11', displayName: 'Jose A.', avatarColor: '#6FB7E8' },
  { id: 'm12', displayName: 'Nacho F.', avatarColor: '#F26A4B' },
]

/** Puntos totales de temporada, en el mismo orden que PEOPLE. */
export const STANDINGS = [148, 141, 137, 134, 130, 126, 121, 117, 112, 104, 96, 88]

/** Puestos ganados o perdidos respecto a la jornada anterior. */
export const TREND = [1, -1, 0, 2, -1, 1, -2, 0, 1, -1, 0, 0]

/** Evolucion de puntos del usuario en diez jornadas, para la grafica del perfil. */
export const MY_GAMEWEEK_HISTORY = [
  { gameweek: 15, points: 11 }, { gameweek: 16, points: 8 }, { gameweek: 17, points: 14 },
  { gameweek: 18, points: 9 }, { gameweek: 19, points: 23 }, { gameweek: 20, points: 12 },
  { gameweek: 21, points: 7 }, { gameweek: 22, points: 15 }, { gameweek: 23, points: 10 },
  { gameweek: 24, points: 14 },
]

/** Alfabeto del teclado propio del onboarding: sin I ni O para no confundir con 1 y 0. */
export const CODE_KEYS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M',
  'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
  '2', '3', '4', '5', '6', '7', '8', '9',
] as const

export const LEAGUE = {
  name: 'La Caleta League',
  inviteCode: 'CALETA',
  memberCount: PEOPLE.length,
}
