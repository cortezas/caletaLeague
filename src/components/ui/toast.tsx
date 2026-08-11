'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/cn'

export type ToastTone = 'neutral' | 'bad'

type ShowToast = (message: string, tone?: ToastTone) => void

const ToastContext = createContext<ShowToast | null>(null)

interface ToastState {
  id: number
  message: string
  tone: ToastTone
}

/** Se muestra uno cada vez: el nuevo sustituye al anterior y reinicia el temporizador. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextId = useRef(0)

  const show = useCallback<ShowToast>((message, tone = 'neutral') => {
    if (timer.current) clearTimeout(timer.current)
    nextId.current += 1
    setToast({ id: nextId.current, message, tone })
    timer.current = setTimeout(() => setToast(null), 2600)
  }, [])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div
          // `key` fuerza que la animacion se reproduzca de nuevo en toasts consecutivos.
          key={toast.id}
          role="status"
          aria-live="polite"
          className={cn(
            'fixed inset-x-[14px] bottom-[96px] z-[60] animate-slidein rounded-[16px] px-[16px] py-[13px]',
            'text-[13.5px] font-semibold leading-snug shadow-card',
            toast.tone === 'bad' ? 'bg-bad text-white' : 'bg-txt text-bg',
          )}
        >
          {toast.message}
        </div>
      )}
    </ToastContext.Provider>
  )
}

export function useToast(): ShowToast {
  const show = useContext(ToastContext)
  if (!show) throw new Error('useToast() requiere <ToastProvider>, que vive en el root layout')
  return show
}
