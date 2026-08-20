/**
 * Plantillas de jugadores y comparación tolerante de nombres.
 *
 * POR QUÉ `SQUADS` ESTÁ VACÍO
 * El plan gratuito de football-data.org da partidos, resultados y clasificación,
 * pero NO da jugadores: plantillas, alineaciones y goleadores por partido están
 * en el paquete de pago. Cablear aquí una lista de futbolistas sería escribir
 * datos falsos (hubo mercado de verano en 2026), así que se queda vacío a
 * propósito y NO se rellena a mano desde el código.
 *
 * Cómo entran los nombres entonces:
 *  1. la peña los escribe en texto libre en el editor de pronóstico, con
 *     autocompletado sobre los nombres que ya se han usado;
 *  2. el organizador puede pegar una plantilla entera por equipo desde el panel
 *     de admin (`src/features/admin/admin-squad-form.tsx`), y eso es lo que
 *     acaba poblando este mapa (vía base de datos, no vía este fichero).
 *
 * POR QUÉ SE COMPARA NORMALIZANDO
 * Al escribir a mano nadie pone las tildes igual: "Vinicius", "Vinícius" y
 * "  vinicius  " son el mismo jugador. La misma regla existe en SQL para que el
 * cálculo de puntos del servidor y el de `src/lib/scoring.ts` no discrepen.
 */

import type { TeamCode } from './types'

/**
 * Plantillas conocidas, por código de equipo. Vacío por defecto: ver cabecera.
 * Un equipo sin entrada no es un error, es el caso normal hoy.
 */
export const SQUADS: Partial<Record<TeamCode, string[]>> = {}

/** Plantilla del equipo, o `[]` si no la hay. Nunca devuelve `undefined`. */
export function squadOf(code: TeamCode): string[] {
  return SQUADS[code] ?? []
}

/** Marcas combinantes que deja `normalize('NFD')`: las tildes ya separadas. */
const DIACRITICS = /[\u0300-\u036f]/g

/**
 * Forma canónica de un nombre para compararlo: minúsculas, sin diacríticos,
 * espacios colapsados y recortados.
 *
 * Se usa el rango de marcas combinantes y no `\p{Diacritic}` porque el target
 * de TypeScript es ES2017 y los escapes de propiedad Unicode piden ES2018.
 * Efecto colateral aceptado: la eñe acaba en ene, así que "Núñez" y "Nunez" son
 * el mismo jugador. Es justo lo que se busca aquí.
 */
export function normalizePlayer(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(DIACRITICS, '')
      .toLowerCase()
      // La PUNTUACION no cuenta: pasa a espacio y luego se colapsa.
      //
      // Sin esto, "Lee Kang In" y "Lee Kang-In" eran dos futbolistas distintos.
      // Paso de verdad: el 19/08/2026 Lee Kang-In marco en el ATM-MAL, la API lo
      // escribe con guion y nuestra plantilla lo tenia con espacio. Un pronostico
      // que lo eligiera como goleador se quedaba sin los 2 puntos y no habia
      // forma de entender por que. En los resultados de esta temporada ya hay
      // "Pierre-Emerick Aubameyang", "R. Fernandez Jaen" y "M. Rodriguez": el
      // mismo problema esperando.
      //
      // Juntar de mas no es el riesgo: para que dos futbolistas DISTINTOS
      // colisionen tendrian que llamarse igual salvo la puntuacion, y entonces
      // ya colisionaban por los acentos.
      //
      // ESPEJO de `public.norm_player` (migracion 0024). Si se toca una, se toca
      // la otra.
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  )
}

/**
 * ¿Son el mismo jugador? Falso si falta alguno de los dos o si alguno queda
 * vacío al normalizar: un hueco sin rellenar no puede acertar a nada.
 */
export function samePlayer(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return false
  const left = normalizePlayer(a)
  if (left === '') return false
  return left === normalizePlayer(b)
}
