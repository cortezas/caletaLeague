'use client'

import { LoaderCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'

import { cn } from '@/lib/cn'

/**
 * Tirar para refrescar en las cuatro pantallas con barra de pestañas.
 *
 * POR QUE EXISTE
 * La app va anclada a la pantalla de inicio del iPhone, o sea sin barra de
 * navegador: no hay boton de recargar y iOS tampoco ofrece el gesto nativo en
 * modo standalone. Sin esto, la unica forma de ver un resultado que acaba de
 * meter el organizador es cerrar y reabrir la app.
 *
 * QUE MUEVE
 * Solo el indicador. El contenido se queda quieto a proposito: un `transform`
 * sobre el envoltorio crearia un bloque contenedor y romperia todos los
 * `position: fixed` de dentro (la hoja de PlayerSelect, los toasts).
 */

/** Recorrido del indicador (ya con resistencia) que dispara el refresco. */
const THRESHOLD = 70
/** El indicador avanza la mitad que el dedo: es lo que da sensacion de tension. */
const RESISTANCE = 0.5
/** Tope del estiron, para que pasarse no despegue el circulo de la cabecera. */
const MAX_PULL = 104
/** Hasta que el dedo no recorre esto no se sabe si el gesto es vertical. */
const SLOP = 6
/** En reposo el circulo esta escondido justo por encima del borde. */
const HIDDEN = 44

export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const rootRef = useRef<HTMLDivElement>(null)

  const [pull, setPull] = useState(0)
  const [dragging, setDragging] = useState(false)
  // Dentro de una transicion `isPending` sigue en alto hasta que el payload de
  // los Server Components ha llegado y se ha aplicado. Es el unico estado que
  // hace falta: no hay hueco entre soltar el dedo y que se ponga en alto,
  // porque ambas cosas pasan en la misma vuelta del manejador de touchend.
  const [busy, startTransition] = useTransition()

  // El gesto vive en listeners nativos, que capturan el valor del render en el
  // que se montaron. La ref es la unica forma de que vean el estado de ahora.
  const busyRef = useRef(busy)
  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  // Recoger el indicador es cosa del final del refresco, no del dedo.
  const startRefresh = useCallback(() => {
    startTransition(() => {
      router.refresh()
    })
  }, [router])

  useEffect(() => {
    const root = rootRef.current
    if (root === null) return

    let startX = 0
    let startY = 0
    // Dedo abajo estando arriba del todo, pero sin saber aun hacia donde va.
    let tracking = false
    // Eje vertical confirmado: a partir de aqui el gesto es nuestro.
    let pulling = false
    let distance = 0

    const release = () => {
      tracking = false
      pulling = false
      distance = 0
      setDragging(false)
      setPull(0)
    }

    const onStart = (event: TouchEvent) => {
      if (busyRef.current || event.touches.length !== 1) return
      // Con el rebote elastico de iOS, arriba del todo `scrollY` puede ser
      // negativo: por eso la comparacion es <= 0 y no === 0.
      if (window.scrollY > 0) return

      const touch = event.touches[0]
      startX = touch.clientX
      startY = touch.clientY
      tracking = true
      pulling = false
      distance = 0
    }

    const onMove = (event: TouchEvent) => {
      if (!tracking) return
      if (event.touches.length !== 1) {
        release()
        return
      }

      const touch = event.touches[0]
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY

      if (!pulling) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return
        // Carrusel horizontal (el pique), scroll normal hacia abajo, o la
        // pagina ya se ha movido entre el touchstart y ahora: no es nuestro.
        if (Math.abs(dx) > Math.abs(dy) || dy <= 0 || window.scrollY > 0) {
          tracking = false
          return
        }
        pulling = true
        setDragging(true)
      }

      distance = Math.max(0, Math.min(dy * RESISTANCE, MAX_PULL))
      // Sin esto iOS rebota la pagina entera a la vez que se tira del indicador.
      if (event.cancelable) event.preventDefault()
      setPull(distance)
    }

    const onEnd = () => {
      if (!tracking) return
      const fire = pulling && distance >= THRESHOLD
      release()
      if (fire) startRefresh()
    }

    // `passive: false` solo en touchmove: es el unico que necesita cancelar.
    root.addEventListener('touchstart', onStart, { passive: true })
    root.addEventListener('touchmove', onMove, { passive: false })
    root.addEventListener('touchend', onEnd)
    root.addEventListener('touchcancel', onEnd)

    return () => {
      root.removeEventListener('touchstart', onStart)
      root.removeEventListener('touchmove', onMove)
      root.removeEventListener('touchend', onEnd)
      root.removeEventListener('touchcancel', onEnd)
    }
  }, [startRefresh])

  // Mientras refresca el circulo se queda clavado en el umbral.
  const offset = busy ? THRESHOLD : pull
  const armed = pull >= THRESHOLD

  return (
    <div ref={rootRef}>
      <div
        aria-hidden={offset === 0}
        className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center pt-[env(safe-area-inset-top)]"
      >
        <div
          className={cn(
            'flex size-[38px] items-center justify-center rounded-full border border-line bg-card shadow-card',
            // Durante el arrastre manda el dedo; el muelle es solo al soltar.
            // La regla global de prefers-reduced-motion ya anula ambas.
            !dragging && 'transition-[transform,opacity] duration-200 ease-out',
          )}
          style={{
            transform: `translate3d(0, ${offset - HIDDEN}px, 0)`,
            opacity: Math.min(1, offset / THRESHOLD),
          }}
        >
          <LoaderCircle
            size={19}
            strokeWidth={2.4}
            aria-hidden
            className={cn(
              busy ? 'animate-spin text-accent' : armed ? 'text-accent' : 'text-txt3',
              !busy && 'transition-transform duration-100',
            )}
            // Antes de soltar gira con el dedo, no con una animacion.
            style={busy ? undefined : { transform: `rotate(${(offset / THRESHOLD) * 200}deg)` }}
          />
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        {busy ? 'Actualizando…' : ''}
      </p>

      {children}
    </div>
  )
}
