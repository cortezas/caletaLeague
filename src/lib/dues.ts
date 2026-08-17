/**
 * Quien paga cada jornada, y cuanto.
 *
 * LA REGLA DE LA PEÑA
 * Los tres ultimos de cada jornada pagan: el ultimo 3 euros, el penultimo 2 y el
 * antepenultimo 1. Siempre son tres y siempre salen 6 euros.
 *
 * LOS EMPATES NO SON UN CASO RARO, SON EL CASO NORMAL
 * En la jornada 1, con quince personas y cuatro partidos jugados, hubo DOS
 * empatados en el ultimo puesto y CINCO en el siguiente: "los tres ultimos" eran
 * siete personas. Con puntuaciones bajas eso va a pasar casi todas las jornadas,
 * asi que el desempate es parte de la regla, no un apaño.
 *
 * ORDEN DE PEOR A MEJOR:
 *   1. menos puntos;
 *   2. menos partidos pronosticados -- no jugar es peor que jugar y fallar, y es
 *      justo lo que interesa desincentivar;
 *   3. menos aciertos de 1X2;
 *   4. y si aun asi hay empate, el id de miembro.
 *
 * El cuarto criterio no es "justo", es DETERMINISTA, que es lo que importa: sin
 * el, dos personas idénticas podrian intercambiarse el puesto entre una carga y
 * la siguiente y la pantalla diria una cosa distinta cada vez. Con dinero en
 * medio, eso es peor que un criterio feo.
 *
 * SOLO CON LA JORNADA ACABADA
 * Quien llama a esto decide cuando; aqui no se sabe si faltan partidos. Marcar al
 * ultimo a media jornada genera piques por nada, asi que las pantallas solo lo
 * piden con los diez partidos jugados.
 */

/** Lo que paga cada puesto, del ULTIMO hacia arriba. */
export const DUES_BY_PLACE = [3, 2, 1] as const

/** Total que se recauda en una jornada completa. */
export const DUES_TOTAL = DUES_BY_PLACE.reduce((sum, euros) => sum + euros, 0)

export type DuesInput = {
  memberId: string
  points: number
  /** Partidos de esa jornada en los que dejo pronostico. */
  predictionsMade: number
  /** Aciertos de 1X2 en esa jornada. */
  signHits: number
}

/**
 * Cuanto paga cada uno en UNA jornada. Solo salen los que pagan.
 *
 * Con menos de tres participantes se reparten los puestos que haya: el ultimo
 * paga 3 y ya esta. No se inventa a nadie para cuadrar los 6 euros.
 */
export function duesForGameweek(rows: DuesInput[]): Map<string, number> {
  const peorPrimero = [...rows].sort(
    (a, b) =>
      a.points - b.points ||
      a.predictionsMade - b.predictionsMade ||
      a.signHits - b.signHits ||
      a.memberId.localeCompare(b.memberId),
  )

  const out = new Map<string, number>()
  for (const [i, euros] of DUES_BY_PLACE.entries()) {
    const row = peorPrimero[i]
    if (!row) break
    out.set(row.memberId, euros)
  }
  return out
}
