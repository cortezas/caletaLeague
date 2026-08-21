/**
 * Tipos de la API de Highlightly (`https://soccer.highlightly.net`).
 *
 * QUE ES ESTO Y POR QUE EXISTE
 * football-data.org sostiene el calendario, los horarios, los estados y el
 * marcador, pero en el plan gratuito NO da goleadores, asistentes ni
 * alineaciones. Highlightly si los da. Este modulo es la segunda fuente, y es
 * SUBORDINADA: si falla, se cae este paso y nada mas.
 *
 * TODOS LOS CAMPOS SON OPCIONALES A PROPOSITO
 * Estos tipos describen una API de terceros que no controlamos y cuyo contrato
 * exacto no esta verificado campo a campo contra una respuesta real (ver
 * docs/EVENTOS.md, seccion "Lo que NO esta verificado"). Declararlos como
 * obligatorios seria mentirle al compilador: TypeScript no valida en runtime, y
 * un `player: string` que llega `undefined` explota en el primer `.trim()`.
 * Con todo opcional el codigo esta OBLIGADO a comprobar antes de usar, que es
 * justo lo que hace falta cuando la respuesta puede cambiar sin avisar.
 */

// ---------------------------------------------------------------------------
// Ligas
// ---------------------------------------------------------------------------

/** Entrada de `GET /leagues`. */
export interface HlLeague {
  id?: number | string
  name?: string | null
  /** Pais de la competicion. Sirve para desempatar "La Liga" de otras ligas homonimas. */
  country?: { code?: string | null; name?: string | null } | string | null
  logo?: string | null
}

// ---------------------------------------------------------------------------
// Partidos
// ---------------------------------------------------------------------------

/**
 * Equipo dentro de un partido. `name` es lo unico que se usa para emparejar:
 * los ids de Highlightly no tienen nada que ver con los de football-data.org,
 * asi que no hay forma de cruzarlos sin pasar por el nombre.
 */
export interface HlTeamRef {
  id?: number | string | null
  name?: string | null
  logo?: string | null
}

/**
 * Estado del partido. Highlightly lo sirve como objeto con `description`
 * (verificado en la nota de la API: `state` trae el estado del encuentro), pero
 * tambien se ha visto la forma plana en cadena. Se aceptan las dos porque leer
 * mal el estado solo nos costaria una peticion de mas, y romper por ello nos
 * costaria la ingesta entera.
 */
export type HlMatchState =
  | string
  | {
      description?: string | null
      /** Minuto de juego cuando el partido esta en curso. */
      clock?: number | string | null
      score?: string | null
    }
  | null

/** Entrada de `GET /matches?leagueId=...&date=YYYY-MM-DD`. */
export interface HlMatch {
  id?: number | string
  /** ISO 8601. Se usa solo como desempate; el emparejamiento fuerte es por dia + equipos. */
  date?: string | null
  state?: HlMatchState
  homeTeam?: HlTeamRef | null
  awayTeam?: HlTeamRef | null
  league?: { id?: number | string; name?: string | null } | null
}

/**
 * `GET /matches` devuelve o bien el array pelado o bien un sobre con `data`.
 * Se aceptan los dos: `readList()` en `client.ts` desenvuelve.
 */
export type HlListResponse<T> = T[] | { data?: T[] | null; count?: number }

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

/**
 * Un evento de `GET /events/{matchId}`.
 *
 * Forma documentada en el encargo y asumida aqui:
 *   { team, time, type, player, playerId, assist, assistingPlayerId, substituted }
 *
 * `type` toma valores como 'Goal', 'Yellow Card', 'Substitution', 'Penalty'.
 * Un evento de gol trae GOLEADOR (`player`) Y ASISTENTE (`assist`) en la misma
 * entrada: no hay que cruzar nada.
 *
 * Los campos `detail` / `comment` / `description` no estan verificados; se
 * declaran porque son los sitios donde otras APIs del ramo meten el matiz
 * "Own Goal" o "Missed Penalty", y `events.ts` los rastrea por si acaso. Si no
 * vienen, el codigo se comporta igual: no depende de ellos para funcionar, solo
 * para afinar.
 */
export interface HlEvent {
  /** Nombre del equipo al que se le apunta el evento. */
  team?: string | HlTeamRef | null
  /** Minuto. Puede llegar como número o como "45+2". */
  time?: number | string | null
  type?: string | null
  player?: string | null
  playerId?: number | string | null
  /** Asistente. Ausente o vacio en los goles sin asistencia (penaltis, jugadas individuales). */
  assist?: string | null
  assistingPlayerId?: number | string | null
  /**
   * En las sustituciones, quien ENTRA. Y `player` es quien SALE.
   *
   * SI, AL REVES DE LO QUE SUGIEREN LOS NOMBRES. Verificado el 20/08/2026
   * contra la respuesta real del ATM-MAL del dia 19:
   *
   *   min 57  Substitution  player: "C. Martin"   substituted: "Lee Kang-In"
   *   min 70  Goal          player: "Lee Kang-In"
   *
   * Si `substituted` fuera el que sale, Lee Kang-In se habria ido en el 57 y
   * habria marcado en el 70. Ademas, los cuatro `player` de los cambios de ese
   * partido son los que SALIAN en el once inicial que guardamos.
   *
   * No se usa para goleadores.
   */
  substituted?: string | null
  /** Matiz del evento cuando la API lo manda. NO verificado. */
  detail?: string | null
  comment?: string | null
  description?: string | null
}

// ---------------------------------------------------------------------------
// Alineaciones
// ---------------------------------------------------------------------------

/**
 * Jugador dentro de una alineacion. Los nombres vienen COMPLETOS
 * ("Ayoze Pérez"), al reves que en los eventos, que llegan abreviados
 * ("A. Perez"). Esa asimetria es el motivo de que exista `resolvePlayerName()`.
 */
export interface HlLineupPlayer {
  name?: string | null
  /** Dorsal. */
  number?: number | string | null
  /** Demarcacion tal cual la da la API ('G', 'D', 'M', 'F' o el nombre largo). */
  position?: string | null
  /** Mismo espacio de ids que `HlEvent.playerId`. */
  id?: number | string | null
}

export interface HlLineupSide {
  id?: number | string | null
  name?: string | null
  /** Dibujo tactico, p. ej. "4-3-3". */
  formation?: string | null
  /** El once inicial. */
  initialLineup?: HlLineupPlayer[] | HlLineupPlayer[][] | null
  /** El banquillo. */
  substitutes?: HlLineupPlayer[] | null
}

/** Respuesta de `GET /lineups/{matchId}`. */
export interface HlLineupsResponse {
  homeTeam?: HlLineupSide | null
  awayTeam?: HlLineupSide | null
}

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

/** Cuerpo de error de la API. Verificado el 12/08/2026 pidiendo sin cabecera. */
export interface HlErrorBody {
  status?: number
  error?: string
  message?: string
}
