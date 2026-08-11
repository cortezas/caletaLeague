'use client'

import { Mail } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button, Card, TextInput } from '@/components/ui'
import { pad2 } from '@/lib/format'
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client'

/** Margen antes de poder pedir otro enlace. El prototipo pintaba "0:42" fijo. */
const RESEND_MS = 45_000

/** 45000 -> '0:45'. No usa `formatCountdown` porque aqui sobra el campo de horas. */
function formatResend(msRemaining: number): string {
  const total = Math.ceil(Math.max(0, msRemaining) / 1000)
  return `${Math.floor(total / 60)}:${pad2(total % 60)}`
}

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(0)

  // El tick solo existe mientras corre la espera; al llegar a cero se para solo.
  useEffect(() => {
    if (!resendAt) return
    const id = setInterval(() => {
      const tick = Date.now()
      setNow(tick)
      if (tick >= resendAt) clearInterval(id)
    }, 1000)
    return () => clearInterval(id)
  }, [resendAt])

  const remainingMs = resendAt ? Math.max(0, resendAt - now) : 0
  const canResend = remainingMs === 0

  async function sendMagicLink(target: string) {
    setPending(true)
    setError(null)

    try {
      if (isSupabaseConfigured) {
        // D11: el enlace se pide desde el NAVEGADOR. Si lo pidiera una Server
        // Action, la cookie PKCE se quedaria en el servidor y el correo abierto
        // en el movil no podria canjearse.
        const supabase = createClient()
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email: target,
          options: { emailRedirectTo: `${window.location.origin}/jornada` },
        })

        if (otpError) {
          setError('No hemos podido mandar el enlace. Prueba otra vez en un minuto.')
          return
        }
      }

      // Fase A: sin variables de entorno se simula el envio para que la
      // pantalla "Revisa tu correo" siga siendo navegable en desarrollo.
      const tick = Date.now()
      setSentTo(target)
      setNow(tick)
      setResendAt(tick + RESEND_MS)
    } catch {
      setError('No hemos podido mandar el enlace. Prueba otra vez en un minuto.')
    } finally {
      setPending(false)
    }
  }

  if (sentTo) {
    return (
      <Card radius={20} className="flex animate-pop flex-col gap-[12px] p-[22px]">
        <div className="flex size-[44px] items-center justify-center rounded-[14px] bg-ok-soft text-ok">
          <Mail size={22} strokeWidth={2} aria-hidden />
        </div>

        <h2 className="text-[18px] font-bold tracking-[-0.01em] text-txt">Revisa tu correo</h2>

        <p className="text-[14px] leading-[1.5] text-txt2">
          Te hemos mandado un enlace mágico a{' '}
          <span className="font-semibold text-txt">{sentTo}</span>. Ábrelo en este mismo iPhone y
          entras directo.
        </p>

        <div className="my-[4px] h-px bg-line" />

        <div className="flex items-center justify-between gap-[8px]">
          {canResend ? (
            <button
              type="button"
              onClick={() => void sendMagicLink(sentTo)}
              disabled={pending}
              className="min-h-[44px] px-[4px] text-[13px] font-bold text-accent transition-transform duration-100 active:scale-[.97] active:opacity-90 disabled:opacity-50"
            >
              Reenviar el enlace
            </button>
          ) : (
            <span className="text-[13px] text-txt3">
              ¿No llega? Reenviar en{' '}
              <span className="font-num font-bold tabular-nums text-txt2">
                {formatResend(remainingMs)}
              </span>
            </span>
          )}

          <button
            type="button"
            onClick={() => setSentTo(null)}
            className="min-h-[44px] px-[4px] text-[13.5px] font-bold text-accent transition-transform duration-100 active:scale-[.97] active:opacity-90"
          >
            Cambiar correo
          </button>
        </div>

        {error && (
          <p role="alert" className="text-[12.5px] font-semibold text-bad">
            {error}
          </p>
        )}
      </Card>
    )
  }

  return (
    <form
      className="flex flex-col gap-[12px]"
      onSubmit={(event) => {
        event.preventDefault()
        const target = email.trim()
        if (!target) return
        void sendMagicLink(target)
      }}
    >
      <TextInput
        label="Tu correo"
        inputSize="lg"
        type="email"
        name="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="nombre@empresa.es"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        error={error ?? undefined}
      />

      <Button variant="primary" size="lg" fullWidth type="submit" loading={pending}>
        Enviarme el enlace
      </Button>

      <p className="text-[12.5px] leading-[1.5] text-txt3">
        Sin contraseñas. Te mandamos un enlace de un solo uso que caduca en 15 minutos.
      </p>
    </form>
  )
}
