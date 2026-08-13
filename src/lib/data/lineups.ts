/**
 * La alineacion de un partido, LEIDA DE NUESTRA BASE.
 *
 * ESTE FICHERO NO LLAMA A LA API. NUNCA. Es la razon de ser de la tabla
 * `match_lineups` (migracion 0013): Highlightly da 100 peticiones al dia en el
 * plan gratuito, y doce personas abriendo el mismo partido serian doce
 * peticiones. Quien pide a la API es el cron, una vez por partido, y guarda.
 *
 * NO LANZA Y NO DEVUELVE `null`. Ninguna de las dos cosas: una alineacion que
 * falta no es un fallo, es el estado normal hasta una hora antes del partido.
 * Devuelve `{ available: false, ... }` y la pantalla pinta "No disponible
 * todavia". Que un `select` falle tampoco puede tumbar la pagina del partido,
 * donde ademas del campo esta el pique, que si tiene datos.
 *
 * QUIEN DECIDE SI SE VE: la politica `match_lineups_select` de 0013, no este
 * codigo. Se consulta con el cliente del USUARIO (`ctx.supabase`), asi que un
 * miembro de otra peña recibe cero filas de Postgres. Aqui no hay ningun `if`
 * que comprobar la liga, y no lo hay a proposito: la comprobacion vive en la
 * base o no vale nada.
 */

import { getDataContext } from './league'
import type { LineupPlayerVM, MatchLineupsVM, TeamLineupVM } from '../view-models'

/** El estado "todavia no hay nada". Fresco en cada llamada: nadie comparte objeto. */
function empty(): MatchLineupsVM {
  return { available: false, fetchedAt: null, home: null, away: null }
}

/**
 * La API dice 'Goalkeeper' | 'Defender' | 'Midfielder' | 'Forward'. Se aceptan
 * tambien las iniciales y las formas cortas porque `HlLineupPlayer.position`
 * documenta que se han visto las dos, y llegar aqui con 'D' no puede significar
 * "no se donde ponerlo".
 */
const POSITIONS: Record<string, LineupPlayerVM['position']> = {
  goalkeeper: 'GK', gk: 'GK', g: 'GK',
  defender: 'DEF', defence: 'DEF', defense: 'DEF', def: 'DEF', d: 'DEF',
  midfielder: 'MID', midfield: 'MID', mid: 'MID', m: 'MID',
  forward: 'FWD', attacker: 'FWD', striker: 'FWD', fwd: 'FWD', f: 'FWD',
}

/**
 * Una demarcacion que no reconocemos cae en 'MID'. Es la unica invencion de todo
 * el fichero y esta acotada a proposito: el contrato obliga a una de las cuatro
 * lineas, y el centro del campo es la banda donde un jugador mal colocado menos
 * chirria (ni de portero ni de punta). El nombre y el dorsal, que es lo que la
 * peña lee, siguen siendo los de verdad. Si esto empezara a pasar en masa se
 * veria en el campo a simple vista: once centrocampistas.
 */
function toPosition(raw: unknown): LineupPlayerVM['position'] {
  if (typeof raw !== 'string') return 'MID'
  return POSITIONS[raw.trim().toLowerCase()] ?? 'MID'
}

/**
 * El dorsal. `Number(null)` es 0 y `Number('')` tambien, asi que un jugador sin
 * dorsal saldria con el 0 a la espalda, que no existe: hay que descartar los
 * vacios ANTES de convertir. La API lo manda como numero o como cadena.
 */
function toNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** Lo guardado es `jsonb`: no hay tipos, hay que comprobar campo a campo. */
function toPlayers(raw: unknown): LineupPlayerVM[] {
  if (!Array.isArray(raw)) return []
  const out: LineupPlayerVM[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as { name?: unknown; number?: unknown; position?: unknown }
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    if (name === '') continue
    out.push({ name, number: toNumber(row.number), position: toPosition(row.position) })
  }
  return out
}

/**
 * `null` si el lado guardado no trae ni un titular. Media alineacion no se pinta:
 * un campo con un equipo de once y otro vacio parece un fallo de la app, no una
 * alineacion a medias. La ingesta ya evita guardar eso (exige 11 y 11), asi que
 * esto es el segundo cerrojo.
 */
function toTeam(raw: unknown): TeamLineupVM | null {
  if (!raw || typeof raw !== 'object') return null
  const side = raw as { formation?: unknown; starters?: unknown; substitutes?: unknown }
  const starters = toPlayers(side.starters)
  if (starters.length === 0) return null
  return {
    formation: typeof side.formation === 'string' && side.formation.trim() !== '' ? side.formation.trim() : null,
    starters,
    substitutes: toPlayers(side.substitutes),
  }
}

export async function getMatchLineups(matchId: string): Promise<MatchLineupsVM> {
  try {
    const ctx = await getDataContext()
    // Sin backend (modo mock) no hay alineaciones: no se inventan once jugadores.
    if (!ctx) return empty()

    const { data, error } = await ctx.supabase
      .from('match_lineups')
      .select('home, away, fetched_at')
      .eq('match_id', matchId)
      .maybeSingle()

    // Un error aqui (tabla sin migrar, red caida) se trata igual que "no hay
    // alineacion". La pagina del partido tiene que seguir pintandose.
    if (error || !data) return empty()

    const home = toTeam(data.home)
    const away = toTeam(data.away)
    if (!home || !away) return empty()

    return {
      available: true,
      fetchedAt: typeof data.fetched_at === 'string' ? data.fetched_at : null,
      home,
      away,
    }
  } catch {
    // Incluye `NoMemberError`: quien no es de la peña no ve alineaciones, y
    // enterarse de eso es cosa de `requireMember()`, no de esta funcion.
    return empty()
  }
}
