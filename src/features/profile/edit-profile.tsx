'use client'

import { Pencil } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'

import { Avatar, Button, Card, SectionLabel, TextInput, useToast } from '@/components/ui'
import { AVATAR_COLORS } from '@/lib/seed'

import { updateProfileAction, type UpdateProfileState } from './actions'

const INITIAL: UpdateProfileState = { ok: false, error: null, warning: null }

/** Mismo limite que el alta y que el CHECK de `members.display_name`. */
const MAX_NAME = 24

export interface EditProfileProps {
  displayName: string
  avatarColor: string
  position: number
  memberCount: number
  leagueName: string
  totalPoints: number
}

/**
 * Bloque de identidad del perfil, con edicion del nombre visible y del color.
 *
 * El editor repite el aspecto del paso 2 del onboarding (avatar de 96 arriba,
 * campo de nombre, paleta de ocho) a proposito: la peña ya paso por ahi al
 * darse de alta y no tiene que aprender otra pantalla.
 *
 * En vista se pintan las PROPS y no el borrador: al guardar, `revalidatePath`
 * devuelve el arbol ya actualizado en la misma transicion que el estado de la
 * accion, asi que no hay parpadeo con el nombre viejo.
 */
export function EditProfile({
  displayName,
  avatarColor,
  position,
  memberCount,
  leagueName,
  totalPoints,
}: EditProfileProps) {
  const showToast = useToast()
  const [state, formAction, pending] = useActionState(updateProfileAction, INITIAL)
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(displayName)
  const [draftColor, setDraftColor] = useState(avatarColor)

  // Ajuste en render, NO en un efecto: el cierre del editor depende del
  // resultado de la accion, no de ningun sistema externo. Es el patron que
  // recomienda React para derivar estado de otro estado.
  const [seenResult, setSeenResult] = useState(state)
  if (seenResult !== state) {
    setSeenResult(state)
    if (state.ok) setEditing(false)
  }

  useEffect(() => {
    // El aviso de nombre repetido sustituye al "guardado": dice las dos cosas.
    if (state.ok) showToast(state.warning ?? 'Perfil actualizado.')
    else if (state.error) showToast(state.error, 'bad')
  }, [state, showToast])

  function open() {
    // El borrador se rearma desde las props: si el nombre cambio en otro sitio,
    // se edita lo que hay ahora y no lo que se dejo a medias la vez anterior.
    setDraftName(displayName)
    setDraftColor(avatarColor)
    setEditing(true)
  }

  if (!editing) {
    return (
      <section className="flex flex-col gap-[12px]">
        <div className="flex items-center gap-[14px]">
          <button
            type="button"
            onClick={open}
            aria-label="Editar tu nombre y tu color"
            className="flex-none rounded-[22px] transition-transform duration-100 active:scale-[.97] active:opacity-90"
          >
            <Avatar name={displayName} color={avatarColor} size={64} />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[19px] font-extrabold tracking-[-.02em]">{displayName}</h2>
            <p className="text-[12.5px] font-semibold text-txt3">
              {position}º de {memberCount} · {leagueName}
            </p>
          </div>
          <div className="flex-none text-right">
            <div className="font-num text-[34px] font-extrabold tabular-nums leading-none text-volt">
              {totalPoints}
            </div>
            <div className="text-[10.5px] font-extrabold uppercase tracking-[.1em] text-txt3">
              Puntos
            </div>
          </div>
        </div>

        <div className="flex">
          <Button
            variant="secondary"
            size="sm"
            onClick={open}
            leading={<Pencil size={15} strokeWidth={2.4} aria-hidden />}
          >
            Editar nombre y color
          </Button>
        </div>
      </section>
    )
  }

  return (
    <Card as="section" radius={20} className="animate-slidein px-[16px] pt-[18px] pb-[16px]">
      <form action={formAction}>
        <div className="mb-[20px] flex justify-center">
          <Avatar
            name={draftName.trim() || displayName}
            color={draftColor}
            size={96}
            className="shadow-[0_12px_30px_rgba(0,0,0,.3)]"
          />
        </div>

        <div className="mb-[20px]">
          <TextInput
            inputSize="lg"
            name="displayName"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder={displayName}
            aria-label="Tu nombre en la peña"
            autoComplete="nickname"
            maxLength={MAX_NAME}
            required
            autoFocus
            // El peso 600 del onboarding gana a la utilidad del primitivo.
            style={{ fontWeight: 600 }}
          />
        </div>

        <SectionLabel className="mb-[12px]">Color de tu avatar</SectionLabel>

        <div
          role="radiogroup"
          aria-label="Color de tu avatar"
          className="mb-[22px] flex flex-wrap gap-[11px]"
        >
          {AVATAR_COLORS.map((hex, index) => (
            <button
              key={hex}
              type="button"
              role="radio"
              aria-checked={draftColor === hex}
              aria-label={`Color ${index + 1}`}
              onClick={() => setDraftColor(hex)}
              style={{
                background: hex,
                border: `3px solid ${draftColor === hex ? 'var(--txt)' : 'transparent'}`,
              }}
              className="min-h-[48px] w-[48px] rounded-[16px] transition-transform duration-100 active:scale-[.97] active:opacity-90"
            />
          ))}
        </div>

        <input type="hidden" name="avatarColor" value={draftColor} />

        {state.error && (
          <p role="alert" className="mb-[12px] text-[13px] font-semibold leading-[1.45] text-bad">
            {state.error}
          </p>
        )}

        <div className="flex gap-[10px]">
          <Button
            variant="secondary"
            size="lg"
            className="flex-1"
            disabled={pending}
            onClick={() => setEditing(false)}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="lg"
            type="submit"
            className="flex-1"
            loading={pending}
            disabled={draftName.trim().length === 0}
          >
            Guardar
          </Button>
        </div>
      </form>
    </Card>
  )
}
