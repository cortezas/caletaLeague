'use client'

import { Check, Copy, Link2 } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'

import { Button, Chip, TextInput, useToast } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { AccessRowVM } from '@/lib/data/access'

import { createInviteLinkAction, NO_INVITE } from './access-actions'

export interface AdminAccessFormProps {
  rows: AccessRowVM[]
}

const LABEL = 'mb-[7px] block text-[11px] font-extrabold uppercase tracking-[.11em] text-txt3'

function whenLabel(iso: string | null): string {
  if (!iso) return 'No ha entrado nunca'
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return 'No ha entrado nunca'
  return `Última vez: ${at.toLocaleDateString('es-ES', {
    timeZone: 'Europe/Madrid',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })}`
}

/**
 * Emitir enlaces de acceso sin depender del correo.
 *
 * Resend envia desde `onboarding@resend.dev`, que solo entrega al dueño de la
 * cuenta: el boton "pedir otro enlace" del login no le llega a nadie mas. El fin
 * de semana del 15-17/08/2026 eso dejo a gente fuera durante dos dias enteros.
 * Con esto el enlace lo emites tu y lo mandas por WhatsApp.
 *
 * El enlace se enseña UNA vez y no se guarda: es una credencial de un solo uso.
 * Si se pierde, se emite otro y el anterior deja de valer.
 */
export function AdminAccessForm({ rows }: AdminAccessFormProps) {
  const showToast = useToast()
  const [state, formAction, pending] = useActionState(createInviteLinkAction, NO_INVITE)
  const [email, setEmail] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (state.error) showToast(state.error, 'bad')
  }, [state, showToast])

  // Ajuste en render, NO en un efecto: "copiado" depende del enlace que hay en
  // pantalla, no de ningun sistema externo. Es el mismo patron que usa
  // `edit-profile.tsx` para cerrar el editor al guardar.
  const [seenLink, setSeenLink] = useState(state.link)
  if (seenLink !== state.link) {
    setSeenLink(state.link)
    setCopied(false)
  }

  async function copy() {
    if (!state.link) return
    try {
      await navigator.clipboard.writeText(state.link)
      setCopied(true)
      showToast('Enlace copiado. Mándaselo por WhatsApp.')
    } catch {
      showToast('No hemos podido copiar. Selecciónalo a mano.', 'bad')
    }
  }

  const pendientes = rows.filter((row) => row.lastSignInAt === null || row.displayName === null)

  return (
    <div className="flex flex-col gap-[13px] px-[14px] pt-[14px] pb-[30px]">
      <p className="rounded-[14px] border border-line bg-warn-soft px-[13px] py-[11px] text-[12.5px] font-semibold leading-[1.45] text-txt2">
        Los correos de la app solo te llegan a ti, porque Resend todavía envía desde una dirección de
        pruebas. Hasta que haya dominio verificado, los enlaces los emites aquí y los repartes tú.
      </p>

      <form action={formAction} className="flex flex-col gap-[10px]">
        <label className="block">
          <span className={LABEL}>Correo</span>
          <TextInput
            inputSize="lg"
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="alguien@gmail.com"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </label>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={pending}
          leading={<Link2 size={16} strokeWidth={2.3} aria-hidden />}
        >
          Generar enlace de acceso
        </Button>
      </form>

      {state.link && (
        <div className="rounded-[17px] border border-accent bg-accent-soft px-[14px] py-[13px]">
          <p className="mb-[8px] text-[12.5px] font-extrabold text-accent2">
            Enlace para {state.email}
          </p>
          <p className="mb-[11px] break-all rounded-[11px] bg-card px-[11px] py-[9px] font-num text-[11.5px] leading-[1.45] text-txt2">
            {state.link}
          </p>
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            onClick={copy}
            leading={
              copied ? (
                <Check size={15} strokeWidth={2.6} aria-hidden />
              ) : (
                <Copy size={15} strokeWidth={2.3} aria-hidden />
              )
            }
          >
            {copied ? 'Copiado' : 'Copiar enlace'}
          </Button>
          <p className="mt-[9px] text-[11.5px] font-semibold leading-[1.4] text-txt3">
            Dura 24 horas y solo se puede usar una vez. Al abrirlo hay que pulsar el botón: abrirlo
            no basta, y eso es lo que impide que WhatsApp lo gaste al hacer la vista previa.
          </p>
        </div>
      )}

      <div className="rounded-[17px] border border-line bg-card px-[14px] py-[13px]">
        <div className="mb-[11px] flex items-center gap-[8px]">
          <span className="text-[13px] font-extrabold">Quién ha entrado</span>
          {pendientes.length > 0 && <Chip tone="warn">{pendientes.length} sin entrar</Chip>}
        </div>

        <ul className="flex flex-col gap-[9px]">
          {rows.map((row) => (
            <li key={row.email} className="flex items-center gap-[10px]">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-txt">
                  {row.displayName ?? row.email}
                </span>
                <span className="block truncate text-[11.5px] font-semibold text-txt3">
                  {row.displayName ? row.email : 'Tiene cuenta pero no se ha unido a la peña'}
                </span>
              </span>
              <span
                className={cn(
                  'flex-none text-right text-[11px] font-bold',
                  row.lastSignInAt === null ? 'text-bad' : 'text-txt3',
                )}
              >
                {whenLabel(row.lastSignInAt)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
