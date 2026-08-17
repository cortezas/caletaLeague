'use client'

import { LoaderCircle } from 'lucide-react'
import { useLinkStatus } from 'next/link'

/**
 * Señal de "voy" mientras se navega. Se pone DENTRO de un `<Link>`.
 *
 * QUE PROBLEMA RESUELVE
 * Las pantallas son Server Components: al pulsar una fila, el navegador se
 * queda quieto hasta que el servidor contesta. Con el movil en 4G eso son
 * decimas, y sin nada que se mueva parece que el toque no ha entrado -- se
 * vuelve a pulsar, y la segunda pulsacion tampoco enseña nada.
 *
 * `loading.tsx` ya existe en las rutas, pero solo entra cuando la navegacion se
 * ha comprometido; el hueco que se siente es el de antes. `useLinkStatus` cubre
 * justo ese hueco: viene de `next/link` y solo funciona dentro del Link.
 *
 * POR QUE EL RETRASO
 * Sin el, cada navegacion rapida daria un parpadeo, que molesta mas que la
 * espera. La animacion arranca invisible y tarda 150 ms en aparecer, asi que en
 * las navegaciones cortas no llega a verse. Es el patron que recomiendan los
 * docs de Next para esto.
 */
export function NavSpinner({ size = 15 }: { size?: number }) {
  const { pending } = useLinkStatus()
  if (!pending) return null

  return (
    <LoaderCircle
      size={size}
      strokeWidth={2.4}
      aria-hidden
      className="opacity-0 [animation:spin_1s_linear_infinite,navspin_1ms_linear_150ms_forwards]"
    />
  )
}
