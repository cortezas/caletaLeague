/**
 * Identidad visual de los clubes.
 *
 * POR QUE NO HAY ESCUDOS OFICIALES AQUI
 * Los escudos de los clubes y el logotipo de LaLiga son marcas registradas. El
 * handoff de diseno lo fija como decision de producto. Lo que hay en su lugar es
 * un patron de equipacion ORIGINAL por club (rayas, mitades, banda diagonal o
 * color plano) con los colores del club, que se reconoce de un golpe de vista y
 * no copia nada.
 *
 * SI QUIERES METER LOS ESCUDOS DE VERDAD
 * 1. Pon los ficheros en `public/crests/` con el nombre de la sigla en
 *    mayusculas: `SEV.png`, `BAR.svg`, etc. Cuadrados y con fondo transparente.
 * 2. Descomenta la entrada correspondiente en `CREST_FILES`, mas abajo.
 * `TeamBadge` empieza a usarlos sin tocar nada mas, y los clubes que no tengan
 * fichero siguen con su patron. La responsabilidad sobre los derechos de esas
 * imagenes es de quien las anade.
 */

import type { TeamCode } from './types'

/** Color plano, rayas verticales, mitades verticales o banda diagonal. */
export type KitPattern =
  | { kind: 'plain' }
  | { kind: 'stripes'; alt: string; count?: number }
  | { kind: 'halves'; alt: string }
  | { kind: 'sash'; alt: string }

/**
 * El color base de cada club vive en `TEAMS` (src/lib/seed.ts) y en la columna
 * `home_code` de la base de datos. Aqui solo va el patron y el color secundario.
 */
export const KITS: Record<TeamCode, KitPattern> = {
  ALA: { kind: 'stripes', alt: '#FFFFFF', count: 7 },
  ATH: { kind: 'stripes', alt: '#FFFFFF', count: 7 },
  ATM: { kind: 'stripes', alt: '#FFFFFF', count: 7 },
  // Blaugrana.
  BAR: { kind: 'stripes', alt: '#004D98', count: 5 },
  BET: { kind: 'stripes', alt: '#FFFFFF', count: 7 },
  CEL: { kind: 'plain' },
  DEP: { kind: 'stripes', alt: '#FFFFFF', count: 7 },
  ELC: { kind: 'stripes', alt: '#FFFFFF', count: 7 },
  ESP: { kind: 'stripes', alt: '#FFFFFF', count: 7 },
  GET: { kind: 'plain' },
  // Granate y azul.
  LEV: { kind: 'stripes', alt: '#0B4EA2', count: 5 },
  MAL: { kind: 'stripes', alt: '#FFFFFF', count: 7 },
  OSA: { kind: 'plain' },
  RAC: { kind: 'stripes', alt: '#FFFFFF', count: 7 },
  // La franja del Rayo: base blanca, banda roja en diagonal.
  RAY: { kind: 'sash', alt: '#E53027' },
  RMA: { kind: 'plain' },
  RSO: { kind: 'stripes', alt: '#FFFFFF', count: 7 },
  SEV: { kind: 'plain' },
  VAL: { kind: 'plain' },
  VIL: { kind: 'plain' },
}

/**
 * Escudos reales. ACTIVOS.
 *
 * DE DONDE SALEN
 * Del CDN de football-data.org (`https://crests.football-data.org/{id}.png`), que
 * es la misma API cuyo plan gratuito ya alimenta el calendario, los resultados y
 * las plantillas: los sirve ella como parte de los datos del equipo. No se ha
 * scrapeado nada de LaLiga ni de las webs de los clubes.
 *
 * Se descargaron una vez y se sirven desde `public/crests/` en vez de enlazar al
 * CDN: van desde nuestro dominio (mas rapido), no dependen de que su CDN este en
 * pie, y siguen viendose con la app instalada y sin cobertura decente.
 * Reescalados a 96px, que es el doble del distintivo mas grande (46px): 98 KB los
 * veinte, la mitad que los originales de 200px.
 *
 * SI ALGUN DIA HAY QUE QUITARLOS
 * Los escudos son marca registrada de cada club. Para una peña privada de trece
 * personas el riesgo es nulo, pero si esto se abriera al publico habria que
 * revisarlo. Vaciar este mapa devuelve la app a los patrones de equipacion
 * originales sin tocar ni una linea mas: `TeamBadge` cae solo en ese modo.
 */
export const CREST_FILES: Partial<Record<TeamCode, string>> = {
  ALA: '/crests/ALA.png',
  ATH: '/crests/ATH.png',
  ATM: '/crests/ATM.png',
  BAR: '/crests/BAR.png',
  BET: '/crests/BET.png',
  CEL: '/crests/CEL.png',
  DEP: '/crests/DEP.png',
  ELC: '/crests/ELC.png',
  ESP: '/crests/ESP.png',
  GET: '/crests/GET.png',
  LEV: '/crests/LEV.png',
  MAL: '/crests/MAL.png',
  OSA: '/crests/OSA.png',
  RAC: '/crests/RAC.png',
  RAY: '/crests/RAY.png',
  RMA: '/crests/RMA.png',
  RSO: '/crests/RSO.png',
  SEV: '/crests/SEV.png',
  VAL: '/crests/VAL.png',
  VIL: '/crests/VIL.png',
}

export function crestFile(code: TeamCode): string | null {
  return CREST_FILES[code] ?? null
}

export function kitOf(code: TeamCode): KitPattern {
  return KITS[code] ?? { kind: 'plain' }
}
