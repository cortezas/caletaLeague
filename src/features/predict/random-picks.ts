/**
 * Goleadores y asistentes al azar, para quien no tiene tiempo de elegirlos.
 *
 * Puro y sin React, como el reducer y por lo mismo: aqui estan los casos raros
 * (un equipo sin plantilla, un 0-0, la lista ya medio llena) y se pueden probar
 * sin montar la pantalla. La tirada se inyecta (`random`) para poder fijarla.
 *
 * DOS DECISIONES QUE NO SON OBVIAS:
 *
 *  1. Los nombres se reparten POR EQUIPO segun el marcador. En un 2-1 salen dos
 *     del local y uno del visitante, no tres de un bombo comun. Un 3-0 en el que
 *     te toca de goleador un delantero del equipo que no marco no es aleatorio,
 *     es absurdo, y encima no puede acertar nunca.
 *
 *  2. Nadie se asiste su propio gol. Los indices de las dos listas hablan del
 *     mismo gol, asi que al elegir el asistente del gol `i` se excluye al
 *     goleador del gol `i`. En un 1-0 eso importa: sin la exclusion, la mitad de
 *     las veces salia el mismo nombre en las dos listas.
 *
 * Salen de la plantilla ENTERA, titulares y suplentes, porque al pronosticar
 * todavia no hay alineacion: no se sabe quien va a ser titular.
 *
 * RELLENA, NO BORRA. Se respeta lo que ya hubiera puesto la persona y solo se
 * completan los huecos que queden hasta el tope de goles. Un boton que te borra
 * de una pulsacion lo que llevabas elegido en el movil no es una ayuda.
 */

import { samePlayer } from '@/lib/squads'

export interface RandomPicksInput {
  homeGoals: number
  awayGoals: number
  homePlayers: string[]
  awayPlayers: string[]
  /** Lo que ya hay puesto. Se conserva tal cual. */
  scorers: string[]
  assists: string[]
  /** Inyectable para poder probarlo con una tirada fija. */
  random?: () => number
}

export interface RandomPicks {
  scorers: string[]
  assists: string[]
}

export function randomPicks(input: RandomPicksInput): RandomPicks {
  const dado = input.random ?? Math.random
  const goles = Math.max(0, input.homeGoals) + Math.max(0, input.awayGoals)

  // Un hueco por gol, cada uno con el equipo que lo mete. Los del local primero,
  // que es el orden en el que se leen las dos listas.
  const lados: Array<'home' | 'away'> = [
    ...Array<'home'>(Math.max(0, input.homeGoals)).fill('home'),
    ...Array<'away'>(Math.max(0, input.awayGoals)).fill('away'),
  ]

  const plantilla = (lado: 'home' | 'away'): string[] => {
    const propia = lado === 'home' ? input.homePlayers : input.awayPlayers
    if (propia.length > 0) return propia
    // Sin plantilla de ese equipo se tira de la del otro: mejor un nombre del
    // rival que dejar el hueco vacio y que parezca que el boton no hizo nada.
    return lado === 'home' ? input.awayPlayers : input.homePlayers
  }

  // `samePlayer` y no `===`: la plantilla y lo ya elegido pueden traer grafias
  // distintas del mismo jugador, y sacarlo dos veces seria un doblete que nadie
  // pidio.
  const elegir = (candidatos: string[], fuera: string[]): string | null => {
    const libres = candidatos.filter((c) => !fuera.some((e) => samePlayer(e, c)))
    if (libres.length === 0) return null
    return libres[Math.min(libres.length - 1, Math.floor(dado() * libres.length))]
  }

  const scorers = input.scorers.slice(0, goles)
  for (let i = scorers.length; i < lados.length; i++) {
    const elegido = elegir(plantilla(lados[i]), scorers)
    if (elegido === null) break
    scorers.push(elegido)
  }

  const assists = input.assists.slice(0, goles)
  for (let i = assists.length; i < lados.length; i++) {
    const suyo = scorers[i] === undefined ? [] : [scorers[i]]
    const elegido = elegir(plantilla(lados[i]), [...assists, ...suyo])
    if (elegido === null) break
    assists.push(elegido)
  }

  return { scorers, assists }
}
