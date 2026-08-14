/**
 * Guardas de sesion y de pertenencia a la peña.
 *
 * D13: el proxy SOLO refresca la sesion; la autorizacion real es RLS mas una de
 * estas guardas al principio de cada pantalla protegida y dentro de cada Server
 * Action. Un cambio de matcher no puede dejar una ruta sin proteger en silencio.
 *
 * DE DONDE SALE LA SESION
 * De `getDataContext()`, que ya hace `getClaims()` y trae la ficha de miembro y
 * la liga en UNA consulta. Esta memoizada con `cache()` por peticion, asi que
 * llamar aqui a `requireMember()` y despues a `getProfile()` no consulta dos
 * veces: es la misma lectura. Por eso la direccion de los imports es auth ->
 * data y nunca al reves.
 *
 * Riesgo Supabase: NUNCA `getSession()` en servidor, solo `getClaims()`. Aqui ni
 * siquiera se toca el cliente: lo hace `getDataContext()`.
 *
 * SIN SUPABASE CONFIGURADO
 * Las cuatro funciones devuelven el miembro `isMe` del seed y no redirigen a
 * ningun sitio, para que la app se pueda recorrer entera sin backend.
 */

import { redirect } from 'next/navigation'

import { NoMemberError, getDataContext } from './data/league'
import { mockMemberSession } from './data/mock'
import { createClient, isSupabaseConfigured } from './supabase/server'

export type Session = {
  userId: string
  email: string
}

export type MemberSession = {
  memberId: string
  userId: string
  displayName: string
  avatarColor: string; avatarUrl: string | null
  leagueId: string
  leagueName: string
  isAdmin: boolean
}

/**
 * Traduce el fallo de la capa de datos a una redireccion.
 *
 * Sin sesion se va a /login (a pedir el enlace magico). CON sesion pero sin
 * ficha de miembro se va a /onboarding (a meter el codigo de la peña): mandar a
 * /login a quien ya ha entrado lo dejaria dando vueltas.
 *
 * `redirect()` lanza, de ahi el `never`.
 */
function bounce(error: unknown): never {
  if (error instanceof NoMemberError) {
    redirect(error.reason === 'no-session' ? '/login' : '/onboarding')
  }
  throw error
}

/**
 * Hay sesion de Supabase, pero puede que aun no pertenezca a ninguna peña.
 *
 * No usa `getDataContext()`: esa funcion exige ficha de miembro, y el punto de
 * `requireSession` es justamente admitir a quien todavia no la tiene (el
 * onboarding). Se resuelven los claims a pelo.
 */
export async function requireSession(): Promise<Session> {
  if (!isSupabaseConfigured) {
    const me = mockMemberSession()
    return { userId: me.userId, email: 'curro@lacaleta.test' }
  }

  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (!claims?.sub) redirect('/login')

  return { userId: claims.sub, email: typeof claims.email === 'string' ? claims.email : '' }
}

/** Hay sesion Y es miembro de la peña. Si no, redirige. */
export async function requireMember(): Promise<MemberSession> {
  let ctx
  try {
    ctx = await getDataContext()
  } catch (error) {
    bounce(error)
  }
  // `null` = no hay Supabase configurado.
  if (!ctx) return mockMemberSession()

  return {
    memberId: ctx.memberId,
    userId: ctx.userId,
    displayName: ctx.displayName,
    avatarColor: ctx.avatarColor,
    avatarUrl: ctx.avatarUrl,
    leagueId: ctx.leagueId,
    leagueName: ctx.leagueName,
    isAdmin: ctx.isAdmin,
  }
}

/** Igual que `requireMember` pero devuelve `null` en vez de redirigir. */
export async function getOptionalMember(): Promise<MemberSession | null> {
  try {
    const ctx = await getDataContext()
    if (!ctx) return mockMemberSession()
    return {
      memberId: ctx.memberId,
      userId: ctx.userId,
      displayName: ctx.displayName,
      avatarColor: ctx.avatarColor,
    avatarUrl: ctx.avatarUrl,
      leagueId: ctx.leagueId,
      leagueName: ctx.leagueName,
      isAdmin: ctx.isAdmin,
    }
  } catch (error) {
    if (error instanceof NoMemberError) return null
    throw error
  }
}

/**
 * Organizador de la peña. Lanza `Error('forbidden')` si no lo es, y quien llama
 * decide: `/ajustes/admin` hace notFound() (para quien no organiza esa pantalla
 * no existe) y las Server Actions devuelven un error de formulario.
 */
export async function requireAdmin(): Promise<MemberSession> {
  const member = await requireMember()
  if (!member.isAdmin) throw new Error('forbidden')
  return member
}
