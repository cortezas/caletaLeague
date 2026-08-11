/**
 * Concatena clases descartando falsy. No hay conflictos de utilidades que
 * resolver en este proyecto, asi que no hace falta tailwind-merge.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}
