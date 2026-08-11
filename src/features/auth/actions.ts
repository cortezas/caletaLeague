'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { AVATAR_COLORS, CODE_KEYS } from '@/lib/seed'
import { createClient, isSupabaseConfigured } from '@/lib/supabase/server'

export type JoinLeagueState = { error: string | null }

const CODE_LENGTH = 6
const MAX_NAME = 24

const ALLOWED_KEYS = new Set<string>(CODE_KEYS)
const ALLOWED_COLORS = new Set<string>(AVATAR_COLORS)

/**
 * Alta en la peña con el codigo de invitacion.
 *
 * La validacion se repite aqui aunque el teclado del onboarding ya solo deje
 * escribir caracteres validos: una Server Action es un endpoint POST publico y
 * el cliente no es frontera de seguridad. La frontera real es `join_league()`
 * (SECURITY DEFINER) + RLS; esto solo evita viajes de ida y vuelta inutiles.
 */
export async function joinLeagueAction(
  prev: JoinLeagueState,
  formData: FormData,
): Promise<JoinLeagueState> {
  const inviteCode = String(formData.get('inviteCode') ?? '').trim().toUpperCase()
  const displayName = String(formData.get('displayName') ?? '').trim().replace(/\s+/g, ' ')
  const avatarColor = String(formData.get('avatarColor') ?? '')

  if (inviteCode.length !== CODE_LENGTH || [...inviteCode].some((char) => !ALLOWED_KEYS.has(char))) {
    return { error: 'Ese código no vale: son 6 caracteres y sin las letras I ni O.' }
  }

  if (!displayName) {
    return { error: 'Ponte un nombre, que es como te ve el resto de la peña.' }
  }

  if (displayName.length > MAX_NAME) {
    return { error: `El nombre se queda en ${MAX_NAME} caracteres como mucho.` }
  }

  if (!ALLOWED_COLORS.has(avatarColor)) {
    return { error: 'Elige uno de los ocho colores de avatar.' }
  }

  if (isSupabaseConfigured) {
    const supabase = await createClient()
    const { data } = await supabase.auth.getClaims()
    if (!data?.claims) {
      return { error: 'Se ha caído la sesión. Pide otra vez el enlace de acceso.' }
    }

    const { error } = await supabase.rpc('join_league', {
      p_invite_code: inviteCode,
      p_display_name: displayName,
      p_avatar_color: avatarColor,
    })

    if (error) {
      // El unico error de la funcion que le importa al usuario es el codigo.
      if (error.message.includes('invalid invite code')) {
        return { error: 'Ese código no existe. Pídeselo otra vez a quien organiza la peña.' }
      }
      return { error: 'No hemos podido darte de alta. Inténtalo dentro de un momento.' }
    }
  }

  // Fase A: sin proyecto Supabase el alta se da por buena y se pasa a la jornada,
  // para que el flujo completo se pueda recorrer en desarrollo.
  revalidatePath('/jornada')
  redirect('/jornada')
}
