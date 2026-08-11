'use client'

import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/cn'
import { formatCountdown } from '@/lib/format'

export interface CountdownProps {
  /** ISO 8601 del pitido inicial del primer partido abierto. */
  deadlineAt: string
  className?: string
  onExpire?: () => void
}

/**
 * Cuenta atras HH:MM:SS con clamp a 00:00:00.
 *
 * `useState(() => Date.now())`: llamar a Date.now() durante el render da un
 * valor en el servidor y otro en el cliente, o sea mismatch de hidratacion
 * garantizado. El lazy initializer lo confina al primer render de cada lado y
 * `suppressHydrationWarning` en el <time> absorbe la diferencia de ese render.
 */
export function Countdown({ deadlineAt, className, onExpire }: CountdownProps) {
  const [now, setNow] = useState(() => Date.now())
  const target = new Date(deadlineAt).getTime()
  const remaining = Number.isNaN(target) ? 0 : Math.max(0, target - now)

  useEffect(() => {
    if (Number.isNaN(target) || target <= Date.now()) return
    const id = setInterval(() => {
      const tick = Date.now()
      setNow(tick)
      if (tick >= target) clearInterval(id)
    }, 1000)
    return () => clearInterval(id)
  }, [target])

  // onExpire dispara una sola vez por deadline, no en cada tick posterior.
  const fired = useRef(false)
  useEffect(() => {
    fired.current = false
  }, [deadlineAt])
  useEffect(() => {
    if (remaining > 0 || fired.current) return
    fired.current = true
    onExpire?.()
  }, [remaining, onExpire])

  return (
    <time
      dateTime={deadlineAt}
      suppressHydrationWarning
      className={cn('font-num font-bold tabular-nums tracking-[.02em] text-warn', className)}
    >
      {formatCountdown(remaining)}
    </time>
  )
}
