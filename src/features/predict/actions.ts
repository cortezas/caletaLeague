'use server'

import { revalidatePath } from 'next/cache'

import { requireMember } from '@/lib/auth'
import { getMatchEditor } from '@/lib/data'
import { normalizePlayer, samePlayer } from '@/lib/squads'
import { createClient, isSupabaseConfigured } from '@/lib/supabase/server'

import { MAX_GOALS, MIN_GOALS } from './reducer'

export type SaveState = { ok: boolean; error: string | null }

type Client = Awaited<ReturnType<typeof createClient>>

/** Tope defensivo: nadie marca 12 goleadores (ni 12 asistentes) en un partido. */
const MAX_SCORERS = 12
const MAX_NAME_LENGTH = 80

/**
 * El plazo se cierra en la base de datos, no aqui: `predictions_update_own`
 * lleva el kickoff en el USING, asi que pasada la hora el UPDATE afecta a 0
 * filas y el INSERT rebota con 42501. Los tres caminos dicen lo mismo.
 */
const CLOSED = 'Este partido ya está cerrado'

function parseGoals(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const value = Number(raw)
  if (!Number.isInteger(value) || value < MIN_GOALS || value > MAX_GOALS) return null
  return value
}

/** Recorta y colapsa espacios. Lo que llega de un POST a pelo no viene limpio. */
function tidy(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

/**
 * `null` = payload invalido. Un array vacio es un valor legitimo.
 * Vale igual para goleadores y para asistentes: mismas reglas, listas distintas.
 */
function parsePlayerList(raw: FormDataEntryValue | null): string[] | null {
  if (typeof raw !== 'string' || raw === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_SCORERS) return null
  const ok = parsed.every(
    (name) => typeof name === 'string' && name.length > 0 && name.length <= MAX_NAME_LENGTH,
  )
  if (!ok) return null

  // Deduplicado por nombre normalizado, no por cadena exacta: "Mbappe" y
  // "Mbappé" son el mismo gol y contarlos dos veces inflaria los puntos.
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw2 of parsed as string[]) {
    const name = tidy(raw2)
    const key = normalizePlayer(name)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

/**
 * Validacion de nombres contra la plantilla. Si el equipo no tiene plantilla
 * cargada NO se valida quien juega (el texto libre es la via normal), solo que
 * el nombre sea razonable.
 */
function checkPlayers(
  players: string[],
  mvp: string | null,
  scorers: string[],
  assists: string[],
): string | null {
  if (players.length > 0) {
    const inSquad = (name: string) => players.some((player) => samePlayer(player, name))
    if (mvp !== null && !inSquad(mvp)) return 'Ese jugador no juega este partido.'
    if (scorers.some((name) => !inSquad(name))) return 'Algún goleador no juega este partido.'
    if (assists.some((name) => !inSquad(name))) return 'Algún asistente no juega este partido.'
    return null
  }

  const bad = [mvp, ...scorers, ...assists].filter(
    (name): name is string => name !== null && (name.length > 40 || normalizePlayer(name) === ''),
  )
  return bad.length > 0 ? 'Ese nombre de jugador no vale.' : null
}

/** PostgREST devuelve el SQLSTATE en `code`. Todo lo demas es ruido para el usuario. */
function writeError(error: { code?: string } | null): string {
  if (error?.code === '42501') return CLOSED
  if (error?.code === '23514') return 'El pronóstico no es válido.'
  return 'No hemos podido guardar el pronóstico.'
}

/** El embed de PostgREST llega como objeto o como array segun la version. */
function embedded(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null
  return (value as Record<string, unknown>) ?? null
}

/**
 * Guarda (o actualiza) el pronostico del usuario para un partido.
 *
 * Campos del FormData: matchId, home, away, mvp (''=null), scorers (JSON string[]),
 * assists (JSON string[]), noGoals ('1'|'').
 *
 * D13: la autorizacion no se delega en el proxy. Una Server Function es un POST a
 * la ruta donde se usa y puede quedar fuera del matcher en silencio, asi que la
 * sesion se comprueba aqui dentro.
 */
export async function savePredictionAction(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  let supabase: Client | null = null
  let userId = ''

  if (isSupabaseConfigured) {
    supabase = await createClient()
    const { data } = await supabase.auth.getClaims()
    const sub = data?.claims?.sub
    if (typeof sub !== 'string' || sub === '') return { ok: false, error: 'unauthorized' }
    userId = sub
  } else {
    // Sin proyecto Supabase la app arranca en seco: la guarda equivalente es la
    // de lib/auth y no hay nada que persistir.
    await requireMember()
  }

  const matchId = formData.get('matchId')
  if (typeof matchId !== 'string' || matchId === '') {
    return { ok: false, error: 'Falta el partido.' }
  }

  const home = parseGoals(formData.get('home'))
  const away = parseGoals(formData.get('away'))
  if (home === null || away === null) {
    return { ok: false, error: 'El marcador no es válido.' }
  }

  const scorers = parsePlayerList(formData.get('scorers'))
  if (scorers === null) {
    return { ok: false, error: 'Los goleadores no son válidos.' }
  }

  const assists = parsePlayerList(formData.get('assists'))
  if (assists === null) {
    return { ok: false, error: 'Los asistentes no son válidos.' }
  }

  const mvpRaw = formData.get('mvp')
  const mvpTidy = typeof mvpRaw === 'string' ? tidy(mvpRaw) : ''
  const mvp = mvpTidy === '' ? null : mvpTidy
  const noGoals = formData.get('noGoals') === '1'

  // D19(a): la exclusividad es una regla del dominio, no un detalle del reducer.
  // Desde la UI es inalcanzable; desde un POST a pelo, no. Vale para las dos
  // listas: el CHECK de la tabla tambien mira `assists`.
  if (noGoals && (scorers.length > 0 || assists.length > 0)) {
    return { ok: false, error: 'No puedes marcar «sin goles» y goleadores o asistentes a la vez.' }
  }

  if (!supabase) {
    // ---------------------------------------------------------------- seco ---
    const editor = await getMatchEditor(matchId)
    if (!editor) return { ok: false, error: 'Ese partido no existe.' }
    if (!editor.editable) return { ok: false, error: CLOSED }

    const problem = checkPlayers(
      editor.squads.flatMap((team) => team.players),
      mvp,
      scorers,
      assists,
    )
    if (problem) return { ok: false, error: problem }

    revalidatePath('/jornada')
    revalidatePath(`/jornada/${matchId}`)
    return { ok: true, error: null }
  }

  // ------------------------------------------------------------------ real ---
  // Con Supabase configurado manda la base de datos, no `getMatchEditor`: el
  // partido, la ficha de miembro y la plantilla se leen de las tablas reales.
  // Alias constante: el estrechamiento de un `let` no sobrevive dentro de `own()`.
  const db = supabase

  const { data: match, error: matchError } = await db
    .from('matches')
    .select('id, home_code, away_code, kickoff_at, gameweeks!inner(league_id)')
    .eq('id', matchId)
    .maybeSingle()

  if (matchError || !match) return { ok: false, error: 'Ese partido no existe.' }

  const leagueId = embedded(match.gameweeks)?.league_id
  if (typeof leagueId !== 'string') return { ok: false, error: 'Ese partido no existe.' }

  // Espejo del sellado de la interfaz. La regla de verdad es la politica RLS;
  // esto solo evita un viaje a escribir lo que ya se sabe que va a rebotar.
  if (Date.parse(String(match.kickoff_at)) <= Date.now()) return { ok: false, error: CLOSED }

  const { data: member } = await db
    .from('members')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!member) return { ok: false, error: 'No eres de esta peña.' }
  const memberId = member.id as string

  // Si `team_squads` aun no existe o el equipo no tiene plantilla, la lista sale
  // vacia y el nombre se valida como texto libre. No es un error.
  const { data: squadRows } = await db
    .from('team_squads')
    .select('players')
    .eq('league_id', leagueId)
    .in('team_code', [match.home_code, match.away_code])

  const players: string[] = (squadRows ?? []).flatMap((row: { players?: string[] }) => row.players ?? [])

  const problem = checkPlayers(players, mvp, scorers, assists)
  if (problem) return { ok: false, error: problem }

  // Se guarda la grafia de la plantilla, no la que se escribio: quien teclea
  // "militao" acaba almacenando "Éder Militão" y el pique se lee igual para todos.
  const canonical = (name: string) => players.find((player) => samePlayer(player, name)) ?? name

  const values = {
    home,
    away,
    mvp: mvp === null ? null : canonical(mvp),
    scorers: scorers.map(canonical),
    assists: assists.map(canonical),
    no_goals: noGoals,
  }
  const own = () =>
    db.from('predictions').update(values).eq('match_id', matchId).eq('member_id', memberId).select('id')

  const { data: updated, error: updateError } = await own()
  if (updateError) return { ok: false, error: writeError(updateError) }

  if (!updated || updated.length === 0) {
    // 0 filas no es un error raro: o no habia pronostico, o el plazo ya cerro y
    // la fila dejo de ser actualizable. Mi propio pronostico si lo puedo leer
    // (predictions_select no mira el kickoff para las filas propias), asi que un
    // select distingue los dos casos.
    const { data: existing } = await db
      .from('predictions')
      .select('id')
      .eq('match_id', matchId)
      .eq('member_id', memberId)
      .maybeSingle()

    if (existing) return { ok: false, error: CLOSED }

    const { error: insertError } = await db
      .from('predictions')
      .insert({ match_id: matchId, member_id: memberId, ...values })

    if (insertError) {
      // 23505: dos envios del mismo formulario a la vez. La fila ya esta, se
      // reintenta como update una sola vez.
      if (insertError.code !== '23505') return { ok: false, error: writeError(insertError) }
      const { data: retry, error: retryError } = await own()
      if (retryError) return { ok: false, error: writeError(retryError) }
      if (!retry || retry.length === 0) return { ok: false, error: CLOSED }
    }
  }

  // D5: solo revalidatePath. La lista de jornada y el propio editor son las dos
  // vistas que quedan obsoletas al guardar.
  revalidatePath('/jornada')
  revalidatePath(`/jornada/${matchId}`)

  return { ok: true, error: null }
}
