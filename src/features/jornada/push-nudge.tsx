'use client'

import { BellRing, X } from 'lucide-react'
import Link from 'next/link'
import { useState, useSyncExternalStore } from 'react'

/**
 * Empujon para activar los avisos.
 *
 * El recordatorio de "te falta pronosticar" funciona y lleva 99 enviados, pero
 * solo 6 de los 13 lo tienen puesto: el interruptor vive en /ajustes y ahi no
 * entra nadie. Y no pronosticar es la forma numero uno de acabar pagando.
 *
 * NO REIMPLEMENTA NADA. `NotificationsToggle` ya resuelve el permiso, el service
 * worker, el caso de iOS sin instalar y los bloqueos del navegador; duplicar ese
 * cuidado aqui seria tener dos versiones de lo delicado. Esto es un cartel que
 * señala, y el trabajo lo sigue haciendo el interruptor de siempre.
 *
 * Se puede cerrar y no vuelve. Un aviso que insiste cada vez que abres la app
 * deja de ser un empujon y pasa a ser una mosca.
 */
const CERRADO = 'lcl.aviso-push.cerrado'

/** Nada a lo que suscribirse: el permiso no cambia sin recargar. */
function sinCambios() {
  return () => {}
}

/** Si hace falta el empujon. Solo tiene sentido en el navegador. */
function hacefalta(): boolean {
  try {
    if (localStorage.getItem(CERRADO) === '1') return false
  } catch {
    // Navegador con el almacenamiento capado: se enseña igual, que es lo
    // conservador. Como mucho lo cierra otra vez.
  }
  if (typeof Notification === 'undefined') return false
  return Notification.permission !== 'granted'
}

/** En el servidor no hay `Notification`: no se pinta y no hay parpadeo. */
function enServidor(): boolean {
  return false
}

export function PushNudge() {
  // `useSyncExternalStore` y no un efecto: esto es leer un valor del navegador,
  // no un efecto secundario, y asi no se pinta primero y se esconde despues.
  const falta = useSyncExternalStore(sinCambios, hacefalta, enServidor)
  const [cerrado, setCerrado] = useState(false)

  if (!falta || cerrado) return null

  function cerrar() {
    try {
      localStorage.setItem(CERRADO, '1')
    } catch {
      // Si no se puede recordar, al menos desaparece en esta sesion.
    }
    setCerrado(true)
  }

  return (
    <div className="mx-[14px] mb-[12px] flex items-start gap-[10px] rounded-[16px] border border-line bg-accent-soft px-[13px] py-[11px]">
      <BellRing size={16} strokeWidth={2.2} aria-hidden className="mt-[2px] flex-none text-accent2" />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-semibold leading-[1.45] text-txt2">
          Ponte los avisos y te llega un toque cuando te falte pronosticar.{' '}
          <b className="font-extrabold text-txt">Quedarse sin pronosticar es la forma número uno</b>{' '}
          de acabar pagando.
        </p>
        <Link
          href="/ajustes"
          className="mt-[6px] inline-flex min-h-[36px] items-center text-[12.5px] font-extrabold text-accent"
        >
          Activarlos en Ajustes
        </Link>
      </div>
      <button
        type="button"
        onClick={cerrar}
        aria-label="No volver a enseñar esto"
        className="flex size-[30px] flex-none items-center justify-center rounded-[9px] text-txt3 transition-transform duration-100 active:scale-[.94]"
      >
        <X size={15} strokeWidth={2.4} aria-hidden />
      </button>
    </div>
  )
}
