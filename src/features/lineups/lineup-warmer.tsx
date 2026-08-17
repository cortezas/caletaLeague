'use client'

import { useEffect, useRef } from 'react'

/**
 * Pide la alineacion del partido que esta a punto de empezar, desde la LISTA de
 * la jornada.
 *
 * POR QUE AQUI Y NO SOLO EN LA PANTALLA DEL PARTIDO
 * `LineupPoller` ya hacia esto, pero solo se monta al abrir un partido concreto,
 * y la peña se pasa el rato en la lista. Resultado medido en la jornada 1:
 *
 *   ALA-GET  alineacion guardada 14 min antes del pitido
 *   SEV-RAY                       4 min
 *   RAC-VIL                      11 min
 *   ESP-LEV                       3 min
 *
 * O sea que quien queria mirar el once antes de cerrar su pronostico no llegaba.
 * La causa no es un fallo: GitHub Actions dispara cuando puede (huecos medidos
 * de 2 a 58 minutos ese fin de semana) y hasta que no dispara nadie pide nada.
 * Con esto lo dispara la propia peña al entrar, que es justo cuando les importa.
 *
 * NO MULTIPLICA EL GASTO. El freno vive en el servidor (`lineup_fetch_attempts`,
 * migracion 0014): quince personas abriendo /jornada son quince llamadas a
 * NUESTRA ruta y como mucho una a Highlightly cada 4 minutos. Y la ruta barre la
 * ventana entera, asi que una peticion deja listos tambien los partidos vecinos.
 *
 * No pinta nada y no recarga la pagina: la lista no enseña alineaciones. Solo
 * deja el dato guardado para quien abra el partido un minuto despues.
 */
export function LineupWarmer({ matchId, kickoffAt }: { matchId: string; kickoffAt: string }) {
  // Una sola vez por montaje: cada navegacion dentro de la app remonta esto, y
  // sin el candado una persona dando vueltas por las pestañas dispararia una
  // peticion por vuelta.
  const done = useRef(false)

  useEffect(() => {
    if (done.current) return

    const minutes = (Date.parse(kickoffAt) - Date.now()) / 60000
    // Los mismos limites que aplica la ruta. Por debajo de -15 el partido lleva
    // rato en juego y el pronostico esta sellado: ya no hay nada que decidir.
    if (!Number.isFinite(minutes) || minutes > 150 || minutes < -15) return

    done.current = true
    // Sin `then`: no hay nada que hacer con la respuesta. Es oportunista, y si
    // falla la siguiente pasada del cron lo arregla.
    fetch('/api/lineups/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId }),
    }).catch(() => {})
  }, [matchId, kickoffAt])

  return null
}
