'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Refresca el pique mientras el partido se juega.
 *
 * POR QUE NO BASTA CON ENTRAR
 * La pantalla es un Server Component: lo que se pinta es la foto del momento en
 * que se cargo. Durante un partido eso envejece en minutos -- cambia el
 * marcador, entran goleadores y con ellos los puntos de los quince. Sin esto
 * habria que recargar a mano para ver si sigues ganando.
 *
 * CADA CUANTO
 * Un minuto. El dato de verdad no se mueve mas rapido: el cron trae marcadores
 * cada pasada y los goleadores llegan por Highlightly, que va a su ritmo. Pedir
 * mas seria gastar por gusto -- y esto NO llama a ninguna API externa, solo
 * vuelve a preguntar a nuestra base.
 *
 * Se para solo cuando el partido deja de estar en juego: el `live` que llega
 * viene del servidor, asi que en cuanto una recarga devuelve el partido cerrado
 * el efecto se desmonta y no queda ningun temporizador vivo.
 */
export function LiveRefresher({ live }: { live: boolean }) {
  const router = useRouter()

  useEffect(() => {
    if (!live) return

    const id = setInterval(() => {
      // Sin recargar la pagina: `refresh()` vuelve a pedir el arbol de servidor
      // y React reconcilia. No se pierde el scroll ni parpadea la pantalla.
      router.refresh()
    }, 60_000)

    return () => clearInterval(id)
  }, [live, router])

  return null
}
