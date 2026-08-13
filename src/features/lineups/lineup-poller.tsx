'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Dispara la peticion de alineacion cuando alguien abre un partido que esta a
 * punto de empezar y todavia no la tenemos.
 *
 * POR QUE HACE FALTA
 * El cron de GitHub Actions no es puntual: medido, una pasada cada 42 minutos de
 * media con picos de 156. La alineacion sale sobre una hora antes del partido, y
 * ese es justo el rato en que la peña la mira para decidir. Sin esto, quien abre
 * el partido a las 19:00 puede no verla aunque lleve publicada 20 minutos.
 *
 * El freno vive en el servidor (`lineup_fetch_attempts`), no aqui: doce personas
 * abriendo el mismo partido son doce llamadas a NUESTRA ruta y como mucho una a
 * Highlightly.
 *
 * No pinta nada. Solo actua si la alineacion no esta y el partido esta cerca.
 */
export function LineupPoller({
  matchId,
  kickoffAt,
  available,
}: {
  matchId: string
  kickoffAt: string
  available: boolean
}) {
  const router = useRouter()
  // Una sola vez por montaje: sin esto, cada `router.refresh()` volveria a
  // dispararlo y entrariamos en bucle.
  const done = useRef(false)

  useEffect(() => {
    if (available || done.current) return

    const minutes = (Date.parse(kickoffAt) - Date.now()) / 60000
    // Fuera de la ventana no se molesta al servidor. El limite de arriba es el
    // mismo que aplica la ruta; el de abajo evita pedirla con el partido ya en
    // juego, cuando el pronostico lleva rato sellado.
    if (!Number.isFinite(minutes) || minutes > 150 || minutes < -15) return

    done.current = true
    let cancelled = false

    fetch('/api/lineups/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        // Solo se recarga si se ha guardado algo: un refresco en vano hace
        // parpadear la pantalla para nada.
        if (!cancelled && data?.fetched) router.refresh()
      })
      .catch(() => {
        // Silencio a proposito: esto es una mejora oportunista. Si falla, la
        // pantalla sigue diciendo "aun no disponibles", que es la verdad.
      })

    return () => {
      cancelled = true
    }
  }, [available, kickoffAt, matchId, router])

  return null
}
