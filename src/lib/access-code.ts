/**
 * El codigo personal de acceso: como se genera y como se lee lo que teclea uno.
 *
 * Puro y sin dependencias, como el reducer del pronostico y por lo mismo: aqui
 * estan los casos raros (minusculas, guiones, la O y el cero) y se prueban sin
 * montar nada.
 *
 * El codigo es la CONTRASENA de Supabase del usuario (migracion 0028). No hay un
 * sistema de sesiones nuevo: se genera aqui, se guarda con
 * `admin.updateUserById({ password })` y se canjea con `signInWithPassword`.
 */

import { randomInt } from 'node:crypto'

/**
 * Alfabeto SIN caracteres que se confunden al copiar de un WhatsApp a mano en un
 * movil: fuera I, L, O, 0 y 1. Quedan 31 simbolos.
 */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/**
 * Ocho caracteres: 31^8, unos 40 bits.
 *
 * Sobra para trece companeros de trabajo. El riesgo real de este sistema no es
 * que alguien adivine un codigo a fuerza bruta, es que se pegue en el grupo
 * equivocado -- por eso lo que de verdad importa es que regenerarlo sea un
 * toque, no que tenga cuatro caracteres mas.
 */
const LARGO = 8

/** Separador visual. Solo para leerlo; se quita al comparar. */
const GRUPO = 4

/**
 * `randomInt` del modulo `crypto`, no `Math.random()`: esto es una credencial.
 * Y sin modulo sobre un byte, que sesgaria hacia las primeras letras del
 * alfabeto -- `randomInt` ya descarta los valores que no reparten parejo.
 */
export function generateAccessCode(): string {
  let out = ''
  for (let i = 0; i < LARGO; i += 1) out += ALFABETO[randomInt(ALFABETO.length)]
  return out
}

/**
 * Lo que teclea una persona -> la forma con la que se compara.
 *
 * Perdona lo que se perdona sin ambiguedad: minusculas, espacios, guiones y los
 * separadores que anade el propio formato. NO perdona confundir O con 0 ni I con
 * 1, porque esos caracteres no existen en el alfabeto: si alguien escribe uno,
 * el codigo no es valido y es mejor decirlo que adivinar.
 */
export function normalizeAccessCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Con separador, para ensenarlo: "ABCD-2K9P". Solo presentacion. */
export function formatAccessCode(code: string): string {
  const limpio = normalizeAccessCode(code)
  if (limpio.length <= GRUPO) return limpio
  return `${limpio.slice(0, GRUPO)}-${limpio.slice(GRUPO)}`
}

/** ¿Tiene la pinta de un codigo, antes de ir a la base a buscarlo? */
export function looksLikeAccessCode(raw: string): boolean {
  const limpio = normalizeAccessCode(raw)
  return limpio.length === LARGO && [...limpio].every((c) => ALFABETO.includes(c))
}
