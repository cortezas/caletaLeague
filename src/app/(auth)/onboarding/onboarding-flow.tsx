'use client'

import { useActionState, useEffect, useState } from 'react'

import { Avatar, Button, SectionLabel, TextInput } from '@/components/ui'
import { joinLeagueAction } from '@/features/auth/actions'
import { cn } from '@/lib/cn'
import { AVATAR_COLORS } from '@/lib/seed'

import { CodeKeypad } from './code-keypad'

const CODE_LENGTH = 6
/** El retardo del prototipo: deja ver la ultima casilla antes de cambiar de paso. */
const STEP_DELAY_MS = 260
const MAX_NAME = 24

/** Placeholder del avatar mientras no hay nombre: da "CM", como el prototipo. */
const NAME_PLACEHOLDER = 'Curro M.'

export function OnboardingFlow() {
  const [step, setStep] = useState<0 | 1>(0)
  const [code, setCode] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [avatarColor, setAvatarColor] = useState<string>(AVATAR_COLORS[0])
  const [state, formAction, pending] = useActionState(joinLeagueAction, { error: null })

  // Se salta al paso 2 al completar los 6 caracteres. Si se borra uno antes de
  // que venza el temporizador, el cleanup lo cancela.
  useEffect(() => {
    if (step !== 0 || code.length < CODE_LENGTH) return
    const id = setTimeout(() => setStep(1), STEP_DELAY_MS)
    return () => clearTimeout(id)
  }, [code, step])

  return (
    <>
      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={2}
        aria-valuenow={step + 1}
        aria-label={`Paso ${step + 1} de 2`}
        className="mb-[26px] flex gap-[6px]"
      >
        <span className="h-[4px] flex-1 rounded-[99px] bg-accent" />
        <span className={cn('h-[4px] flex-1 rounded-[99px]', step === 1 ? 'bg-accent' : 'bg-line')} />
      </div>

      {step === 0 ? (
        <section className="animate-slidein">
          <h1 className="mb-[8px] text-[27px] font-extrabold tracking-[-0.03em] text-txt">
            Código de invitación
          </h1>
          <p className="mb-[26px] text-[14.5px] leading-[1.5] text-txt2">
            Te lo pasa quien organiza la peña. Son 6 caracteres.
          </p>

          <CodeKeypad value={code} onValueChange={setCode} />
        </section>
      ) : (
        <form action={formAction} className="animate-slidein">
          <h1 className="mb-[8px] text-[27px] font-extrabold tracking-[-0.03em] text-txt">
            ¿Cómo te llamamos?
          </h1>
          <p className="mb-[24px] text-[14.5px] leading-[1.5] text-txt2">
            Así te verá el resto de la peña en la clasificación.
          </p>

          <div className="mb-[24px] flex justify-center">
            <Avatar
              name={displayName.trim() || NAME_PLACEHOLDER}
              color={avatarColor}
              size={96}
              className="shadow-[0_12px_30px_rgba(0,0,0,.3)]"
            />
          </div>

          <div className="mb-[22px]">
            <TextInput
              inputSize="lg"
              name="displayName"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder={NAME_PLACEHOLDER}
              aria-label="Tu nombre en la peña"
              autoComplete="nickname"
              maxLength={MAX_NAME}
              required
              // El peso 600 del prototipo gana a la utilidad del primitivo.
              style={{ fontWeight: 600 }}
            />
          </div>

          <SectionLabel className="mb-[12px]">Color de tu avatar</SectionLabel>

          <div role="radiogroup" aria-label="Color de tu avatar" className="mb-[26px] flex flex-wrap gap-[11px]">
            {AVATAR_COLORS.map((hex, index) => (
              <button
                key={hex}
                type="button"
                role="radio"
                aria-checked={avatarColor === hex}
                aria-label={`Color ${index + 1}`}
                onClick={() => setAvatarColor(hex)}
                style={{
                  background: hex,
                  border: `3px solid ${avatarColor === hex ? 'var(--txt)' : 'transparent'}`,
                }}
                className="min-h-[48px] w-[48px] rounded-[16px] transition-transform duration-100 active:scale-[.97] active:opacity-90"
              />
            ))}
          </div>

          <input type="hidden" name="inviteCode" value={code} />
          <input type="hidden" name="avatarColor" value={avatarColor} />

          {state.error && (
            <p role="alert" className="mb-[12px] text-[13px] font-semibold leading-[1.45] text-bad">
              {state.error}
            </p>
          )}

          <Button
            variant="primary"
            size="lg"
            fullWidth
            type="submit"
            loading={pending}
            disabled={displayName.trim().length === 0}
          >
            Entrar a La Caleta League
          </Button>

          {/* Sin esto, un codigo mal tecleado deja al usuario encerrado en el paso 2. */}
          {state.error && (
            <button
              type="button"
              onClick={() => {
                setCode('')
                setStep(0)
              }}
              className="mt-[10px] min-h-[44px] w-full text-[13px] font-bold text-accent transition-transform duration-100 active:scale-[.97] active:opacity-90"
            >
              Cambiar el código
            </button>
          )}
        </form>
      )}
    </>
  )
}
