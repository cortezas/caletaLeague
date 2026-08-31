'use client'

import { AlertTriangle, Check, Copy, KeyRound, Link2, UserMinus } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'

import { Button, Chip, TextInput, useToast } from '@/components/ui'
import { formatAccessCode } from '@/lib/access-code'
import { cn } from '@/lib/cn'
import type { AccessRowVM } from '@/lib/data/access'

import {
  createInviteLinkAction,
  regenerateCodeAction,
  removeMemberAction,
  type CodeState,
  type InviteState,
  type RemoveState,
} from './access-actions'

/** Estado inicial. Aqui y no en las acciones: de un 'use server' solo salen funciones. */
const NO_INVITE: InviteState = { ok: false, error: null, link: null, email: null }

/** Estado inicial del borrado. Aqui por lo mismo: de un 'use server' solo salen funciones. */
const NO_REMOVE: RemoveState = { ok: false, error: null, removed: null }

/** Y el del codigo. Misma razon. */
const NO_CODE: CodeState = { ok: false, error: null, code: null, name: null }

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

  const [removeState, removeAction, removing] = useActionState(removeMemberAction, NO_REMOVE)
  /**
   * A quien se esta a punto de quitar. Dos pasos y no uno: esto borra el
   * historial entero de una persona y no se puede deshacer, asi que una sola
   * pulsacion es poco.
   */
  const [porQuitar, setPorQuitar] = useState<AccessRowVM | null>(null)

  const [seenRemove, setSeenRemove] = useState(removeState)
  if (seenRemove !== removeState) {
    setSeenRemove(removeState)
    if (removeState.ok) setPorQuitar(null)
  }

  useEffect(() => {
    if (removeState.ok && removeState.removed) showToast(`${removeState.removed} fuera de la peña.`)
    else if (removeState.error) showToast(removeState.error, 'bad')
  }, [removeState, showToast])

  const [codeState, codeAction, generando] = useActionState(regenerateCodeAction, NO_CODE)
  useEffect(() => {
    if (codeState.ok && codeState.code) showToast(`Código nuevo para ${codeState.name}.`)
    else if (codeState.error) showToast(codeState.error, 'bad')
  }, [codeState, showToast])

  async function copiarCodigo(code: string, quien: string) {
    try {
      await navigator.clipboard.writeText(code)
      showToast(`Código de ${quien} copiado.`)
    } catch {
      showToast('No hemos podido copiar. Selecciónalo a mano.', 'bad')
    }
  }

  const sinCodigo = rows.filter((row) => row.memberId !== null && row.accessCode === null)
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

      {/* Los codigos personales. Van ANTES de la lista de entradas porque son lo
          que de verdad resuelve el problema: con su codigo, cada uno vuelve a
          entrar solo y no hay que emitirle nada. */}
      <div className="rounded-[17px] border border-line bg-card px-[14px] py-[13px]">
        <div className="mb-[6px] flex items-center gap-[8px]">
          <KeyRound size={15} strokeWidth={2.3} aria-hidden className="flex-none text-accent2" />
          <span className="text-[13px] font-extrabold">Códigos personales</span>
          {sinCodigo.length > 0 && <Chip tone="warn">{sinCodigo.length} sin código</Chip>}
        </div>
        <p className="mb-[12px] text-[11.5px] font-semibold leading-[1.45] text-txt3">
          Cada uno entra con el suyo desde la pantalla de acceso, sin pedirte nada. No caduca. Si
          alguien lo pega donde no debe, dale a rehacer y el viejo deja de valer al instante.
        </p>

        <ul className="flex flex-col gap-[10px]">
          {rows
            .filter((row) => row.memberId !== null)
            .map((row) => (
              <li key={row.memberId} className="flex items-center gap-[9px]">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold text-txt">
                    {row.displayName ?? row.email}
                  </span>
                  <span className="block font-num text-[15px] font-extrabold tracking-[.16em] text-accent2">
                    {row.accessCode ? formatAccessCode(row.accessCode) : '— sin código —'}
                  </span>
                </span>

                {row.accessCode && (
                  <button
                    type="button"
                    onClick={() => copiarCodigo(row.accessCode as string, row.displayName ?? row.email)}
                    aria-label={`Copiar el código de ${row.displayName ?? row.email}`}
                    className="flex size-[34px] flex-none items-center justify-center rounded-[10px] border border-line text-txt3 transition-transform duration-100 active:scale-[.94]"
                  >
                    <Copy size={15} strokeWidth={2.3} aria-hidden />
                  </button>
                )}

                <form action={codeAction} className="flex-none">
                  <input type="hidden" name="memberId" value={row.memberId ?? ''} readOnly />
                  <input
                    type="hidden"
                    name="name"
                    value={row.displayName ?? row.email}
                    readOnly
                  />
                  <Button type="submit" variant="secondary" size="sm" loading={generando}>
                    {row.accessCode ? 'Rehacer' : 'Dar código'}
                  </Button>
                </form>
              </li>
            ))}
        </ul>
      </div>

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

              {/* Solo a quien tiene ficha y no es el organizador. Sin ficha no hay
                  nada que quitar, y quitarte a ti dejaria la peña sin nadie al
                  mando y sin forma de arreglarlo desde la app. */}
              {row.memberId && !row.isAdmin && (
                <button
                  type="button"
                  onClick={() => setPorQuitar(row)}
                  aria-label={`Quitar a ${row.displayName ?? row.email} de la peña`}
                  className="flex size-[34px] flex-none items-center justify-center rounded-[10px] border border-line text-txt3 transition-transform duration-100 active:scale-[.94]"
                >
                  <UserMinus size={15} strokeWidth={2.3} aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {porQuitar && (
        <div className="rounded-[17px] border border-bad bg-bad-soft px-[14px] py-[13px]">
          <div className="mb-[8px] flex items-center gap-[8px]">
            <AlertTriangle size={16} strokeWidth={2.3} aria-hidden className="flex-none text-bad" />
            <span className="text-[13px] font-extrabold text-txt">
              ¿Quitar a {porQuitar.displayName ?? porQuitar.email}?
            </span>
          </div>

          {/* Se dice lo que se pierde ANTES de confirmar: "quitar a Fulano" y
              "borrar los diez pronosticos de Fulano" son la misma accion y no lo
              parecen. */}
          <ul className="mb-[11px] flex flex-col gap-[4px] text-[12.5px] font-semibold leading-[1.45] text-txt2">
            <li>
              Se borran sus <b className="font-extrabold text-txt">{porQuitar.predictions}</b>{' '}
              pronósticos y no se pueden recuperar.
            </li>
            <li>
              Cambia el pasado: quién quedó último en cada jornada se recalcula, así que los euros de
              jornadas ya cerradas pueden moverse.
            </li>
            <li>Su cuenta no se borra: puede volver a entrar con el código de la peña.</li>
          </ul>

          <div className="flex gap-[8px]">
            <form action={removeAction} className="flex-1">
              <input type="hidden" name="memberId" value={porQuitar.memberId ?? ''} readOnly />
              <input
                type="hidden"
                name="name"
                value={porQuitar.displayName ?? porQuitar.email}
                readOnly
              />
              <Button type="submit" variant="danger" size="sm" fullWidth loading={removing}>
                Sí, quitarlo
              </Button>
            </form>
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={() => setPorQuitar(null)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
