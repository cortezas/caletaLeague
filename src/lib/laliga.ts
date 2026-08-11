/**
 * LaLiga EA Sports 2026/27: los 20 equipos y el calendario oficial de las 38 jornadas.
 *
 * ORIGEN DE LOS DATOS
 * El calendario lo publicó la RFEF el 30 de junio de 2026. Los 380 emparejamientos
 * de este fichero se extrajeron del calendario publicado y se validaron:
 *   - 38 jornadas x 10 partidos = 380
 *   - cada equipo juega exactamente 19 partidos en casa y 19 fuera
 *   - ningún equipo aparece dos veces en la misma jornada
 *   - El Clásico cae en las jornadas 10 y 35, que concuerda con fuentes independientes
 *
 * HORARIOS
 * LaLiga publica los horarios concretos 15-20 días antes de cada jornada. Aquí solo
 * está la FECHA de la jornada; la hora es provisional (ver `DEFAULT_KICKOFF`) hasta
 * que la ingesta desde football-data.org traiga la definitiva. Ver
 * `src/lib/football-data/`.
 *
 * Este fichero es la semilla de arranque, no la fuente de verdad en producción:
 * ahí manda la tabla `matches` de Supabase, que alimenta la ingesta.
 */

import type { TeamCode } from './types'

export const SEASON = '2026-27'
export const COMPETITION_LABEL = 'LaLiga EA Sports'

export interface LaLigaTeam {
  /** Nombre corto para las filas de partido. */
  name: string
  /** Nombre oficial completo. */
  fullName: string
  city: string
  /** Color base del distintivo. */
  color: string
  /** Color de la sigla sobre `color`. */
  ink: string
}

export const TEAMS: Record<TeamCode, LaLigaTeam> = {
  ALA: { name: 'Alavés', fullName: 'Deportivo Alavés', city: 'Vitoria', color: '#0761AF', ink: '#ffffff' },
  ATH: { name: 'Athletic', fullName: 'Athletic Club', city: 'Bilbao', color: '#D8232A', ink: '#ffffff' },
  ATM: { name: 'Atlético', fullName: 'Club Atlético de Madrid', city: 'Madrid', color: '#CB3524', ink: '#ffffff' },
  BAR: { name: 'Barcelona', fullName: 'Fútbol Club Barcelona', city: 'Barcelona', color: '#A50044', ink: '#ffffff' },
  BET: { name: 'Betis', fullName: 'Real Betis Balompié', city: 'Sevilla', color: '#0E9F5A', ink: '#ffffff' },
  CEL: { name: 'Celta', fullName: 'Real Club Celta de Vigo', city: 'Vigo', color: '#8AC3EE', ink: '#05263D' },
  DEP: { name: 'Dépor', fullName: 'Real Club Deportivo de La Coruña', city: 'A Coruña', color: '#0067B2', ink: '#ffffff' },
  ELC: { name: 'Elche', fullName: 'Elche Club de Fútbol', city: 'Elche', color: '#1E9E52', ink: '#ffffff' },
  ESP: { name: 'Espanyol', fullName: 'Real Club Deportivo Espanyol', city: 'Cornellà', color: '#1AA0DB', ink: '#ffffff' },
  GET: { name: 'Getafe', fullName: 'Getafe Club de Fútbol', city: 'Getafe', color: '#005999', ink: '#ffffff' },
  LEV: { name: 'Levante', fullName: 'Levante Unión Deportiva', city: 'Valencia', color: '#9B1B3B', ink: '#ffffff' },
  MAL: { name: 'Málaga', fullName: 'Málaga Club de Fútbol', city: 'Málaga', color: '#0069B4', ink: '#ffffff' },
  OSA: { name: 'Osasuna', fullName: 'Club Atlético Osasuna', city: 'Pamplona', color: '#D91A21', ink: '#ffffff' },
  RAC: { name: 'Racing', fullName: 'Real Racing Club de Santander', city: 'Santander', color: '#0A9E4F', ink: '#ffffff' },
  RAY: { name: 'Rayo', fullName: 'Rayo Vallecano de Madrid', city: 'Madrid', color: '#EDF0F5', ink: '#1A1A1A' },
  RMA: { name: 'Real Madrid', fullName: 'Real Madrid Club de Fútbol', city: 'Madrid', color: '#E9EEF7', ink: '#0E1420' },
  RSO: { name: 'Real Sociedad', fullName: 'Real Sociedad de Fútbol', city: 'San Sebastián', color: '#1273C7', ink: '#ffffff' },
  SEV: { name: 'Sevilla', fullName: 'Sevilla Fútbol Club', city: 'Sevilla', color: '#F2455F', ink: '#ffffff' },
  VAL: { name: 'Valencia', fullName: 'Valencia Club de Fútbol', city: 'Valencia', color: '#F5A524', ink: '#2A1B00' },
  VIL: { name: 'Villarreal', fullName: 'Villarreal Club de Fútbol', city: 'Villarreal', color: '#F7DF4F', ink: '#221E00' },
}

export const TEAM_CODES = Object.keys(TEAMS) as TeamCode[]

/**
 * Calendario oficial, una línea por jornada: `numero|fecha ISO|LOC-VIS,LOC-VIS,...`
 *
 * Se guarda comprimido a propósito: 38 líneas legibles de un vistazo en vez de 380
 * objetos. `GAMEWEEKS` lo expande al importar el módulo.
 */
const RAW_CALENDAR = [
  '1|2026-08-16|ALA-GET,ATM-MAL,CEL-OSA,DEP-ELC,ESP-LEV,BAR-ATH,RAC-VIL,RMA-RSO,SEV-RAY,VAL-BET',
  '2|2026-08-23|ATH-SEV,ATM-VIL,BET-RSO,ELC-BAR,ESP-RMA,GET-RAC,MAL-DEP,OSA-LEV,RAY-ALA,VAL-CEL',
  '3|2026-08-30|ALA-VIL,CEL-ATH,DEP-VAL,BAR-RAY,LEV-BET,OSA-GET,RAC-ELC,RMA-MAL,RSO-ESP,SEV-ATM',
  '4|2026-09-06|ALA-OSA,ATH-ATM,BET-RMA,ELC-RSO,ESP-SEV,GET-CEL,MAL-LEV,RAY-RAC,VAL-BAR,VIL-DEP',
  '5|2026-09-13|ATH-ELC,CEL-MAL,GET-DEP,LEV-BAR,OSA-ESP,RAC-ALA,RMA-RAY,RSO-ATM,SEV-VAL,VIL-BET',
  '6|2026-09-16|ALA-VAL,ATM-OSA,BET-GET,DEP-SEV,ELC-RMA,BAR-RAC,LEV-ATH,MAL-VIL,RAY-ESP,RSO-CEL',
  '7|2026-09-20|ATH-ALA,ATM-RMA,CEL-RAC,DEP-BET,ESP-ELC,GET-MAL,OSA-RAY,SEV-BAR,VAL-RSO,VIL-LEV',
  '8|2026-10-11|ALA-ATM,BET-OSA,ELC-CEL,BAR-GET,LEV-SEV,MAL-ESP,RAC-VAL,RAY-ATH,RMA-VIL,RSO-DEP',
  '9|2026-10-18|BET-BAR,CEL-ALA,DEP-LEV,ESP-ATM,GET-RAY,MAL-RSO,OSA-RAC,RMA-SEV,VAL-ATH,VIL-ELC',
  '10|2026-10-25|ALA-MAL,ATH-GET,ATM-DEP,CEL-BET,BAR-RMA,RAC-ESP,RAY-ELC,RSO-LEV,SEV-OSA,VAL-VIL',
  '11|2026-11-01|ATH-RSO,BET-MAL,DEP-OSA,ELC-VAL,BAR-ALA,GET-SEV,LEV-ATM,RAC-RMA,RAY-CEL,VIL-ESP',
  '12|2026-11-08|ATM-BAR,CEL-LEV,ELC-BET,ESP-DEP,MAL-RAC,OSA-ATH,RSO-RAY,SEV-ALA,VAL-RMA,VIL-GET',
  '13|2026-11-22|ALA-DEP,ATH-ESP,BAR-VIL,GET-ATM,LEV-ELC,OSA-MAL,RAC-RSO,RAY-VAL,RMA-CEL,SEV-BET',
  '14|2026-11-29|BET-RAY,CEL-VIL,DEP-BAR,ELC-ATM,ESP-GET,LEV-RAC,MAL-ATH,RMA-ALA,RSO-SEV,VAL-OSA',
  '15|2026-12-06|ALA-ESP,ATH-RMA,ATM-BET,BAR-CEL,GET-VAL,OSA-ELC,RAC-DEP,RAY-LEV,SEV-MAL,VIL-RSO',
  '16|2026-12-13|ATM-VAL,BET-RAC,DEP-ATH,ELC-SEV,ESP-CEL,LEV-ALA,MAL-BAR,RMA-OSA,RSO-GET,VIL-RAY',
  '17|2026-12-20|ALA-ELC,ATH-BET,CEL-ATM,DEP-RMA,BAR-RSO,GET-LEV,OSA-VIL,RAY-MAL,SEV-RAC,VAL-ESP',
  '18|2027-01-03|BET-ALA,CEL-DEP,ESP-BAR,LEV-VAL,MAL-ELC,RAC-ATH,RAY-ATM,RMA-GET,RSO-OSA,VIL-SEV',
  '19|2027-01-10|ALA-RSO,ATH-VIL,ATM-RAC,DEP-RAY,ELC-GET,ESP-BET,OSA-BAR,RMA-LEV,SEV-CEL,VAL-MAL',
  '20|2027-01-17|ATM-RSO,BET-DEP,CEL-VAL,BAR-ELC,GET-ATH,LEV-ESP,MAL-RMA,RAC-OSA,RAY-SEV,VIL-ALA',
  '21|2027-01-24|ALA-BAR,ATH-LEV,DEP-ATM,ELC-RAY,ESP-VIL,GET-OSA,RAC-CEL,RMA-BET,RSO-MAL,VAL-SEV',
  '22|2027-01-31|ATM-ESP,BET-ELC,CEL-GET,BAR-VAL,LEV-RSO,MAL-ALA,OSA-DEP,RAY-RMA,SEV-ATH,VIL-RAC',
  '23|2027-02-07|ALA-CEL,ATH-OSA,BET-SEV,DEP-MAL,ELC-LEV,ESP-RAY,BAR-ATM,GET-VIL,RSO-RMA,VAL-RAC',
  '24|2027-02-14|CEL-RAY,ELC-DEP,LEV-MAL,OSA-ATM,RAC-GET,RMA-ATH,RSO-BET,SEV-ESP,VAL-ALA,VIL-BAR',
  '25|2027-02-21|ALA-RAC,ATH-CEL,ATM-ELC,DEP-RSO,ESP-OSA,BAR-LEV,MAL-BET,RAY-GET,SEV-RMA,VIL-VAL',
  '26|2027-02-28|ATH-BAR,BET-VIL,CEL-ESP,GET-ALA,LEV-DEP,MAL-ATM,OSA-SEV,RAC-RAY,RMA-VAL,RSO-ELC',
  '27|2027-03-07|ALA-ATH,ATM-CEL,DEP-GET,ELC-MAL,ESP-RAC,BAR-BET,RAY-OSA,SEV-RSO,VAL-LEV,VIL-RMA',
  '28|2027-03-14|ALA-SEV,ATH-VAL,BET-LEV,ELC-VIL,BAR-DEP,GET-RSO,MAL-RAY,OSA-CEL,RAC-ATM,RMA-ESP',
  '29|2027-03-21|ATM-GET,CEL-RMA,ESP-ATH,LEV-OSA,RAC-BET,RAY-BAR,RSO-ALA,SEV-ELC,VAL-DEP,VIL-MAL',
  '30|2027-04-04|ATH-RAC,BET-CEL,DEP-VIL,ELC-ALA,BAR-SEV,GET-ESP,LEV-RAY,MAL-OSA,RMA-ATM,RSO-VAL',
  '31|2027-04-11|ALA-BET,ATM-LEV,CEL-ELC,ESP-MAL,OSA-RMA,RAC-BAR,RAY-RSO,SEV-DEP,VAL-GET,VIL-ATH',
  '32|2027-04-18|ALA-RAY,ATM-SEV,BET-ATH,DEP-CEL,ELC-OSA,BAR-ESP,GET-RMA,LEV-VIL,MAL-VAL,RSO-RAC',
  '33|2027-04-21|ATH-DEP,CEL-BAR,ESP-RSO,GET-BET,OSA-ALA,RAC-MAL,RMA-ELC,SEV-LEV,VAL-RAY,VIL-ATM',
  '34|2027-05-02|ATM-ALA,BET-VAL,CEL-SEV,DEP-RAC,ELC-ESP,BAR-OSA,LEV-RMA,MAL-GET,RAY-VIL,RSO-ATH',
  '35|2027-05-09|ALA-LEV,ATH-MAL,BET-ESP,GET-ELC,OSA-RSO,RAC-SEV,RAY-DEP,RMA-BAR,VAL-ATM,VIL-CEL',
  '36|2027-05-16|ATM-RAY,DEP-ALA,ELC-ATH,ESP-VAL,LEV-GET,MAL-CEL,OSA-BET,RMA-RAC,RSO-BAR,SEV-VIL',
  '37|2027-05-23|ALA-RMA,ATM-ATH,CEL-RSO,DEP-ESP,BAR-MAL,RAC-LEV,RAY-BET,SEV-GET,VAL-ELC,VIL-OSA',
  '38|2027-05-30|ATH-RAY,BET-ATM,ELC-RAC,ESP-ALA,GET-BAR,LEV-CEL,MAL-SEV,OSA-VAL,RMA-DEP,RSO-VIL',
] as const

/**
 * Hora provisional hasta que LaLiga publique la definitiva, en hora de Madrid.
 * Se reparten a lo largo del domingo para que la jornada no se cierre de golpe:
 * el sellado es por partido, y con los 10 a la misma hora se perdería esa gracia.
 */
const PROVISIONAL_HOURS = [14, 16, 16, 18, 18, 18, 20, 20, 21, 21] as const

/**
 * Horarios YA CONFIRMADOS por LaLiga, en hora de Madrid: `jornada:LOC-VIS` -> `YYYY-MM-DD HH:MM`.
 *
 * LaLiga los publica 15-20 días antes de cada jornada, así que esta tabla crece
 * poco a poco. Lo que no esté aquí sale con la hora provisional y marcado como
 * tal, para que la interfaz no presente una hora inventada como si fuera buena.
 *
 * LA JORNADA 1 NO ES UN FIN DE SEMANA. Va del sábado 15 al jueves 27 de agosto:
 * los partidos de Atlético, Valencia, Real Madrid y Barcelona se aplazaron
 * porque esos clubes tenían jugadores en las semifinales del Mundial 2026. Por
 * eso el sellado individual por partido importa aquí más que nunca: quien juega
 * el 15 tiene que estar sellado mientras el resto sigue pronosticando.
 *
 * Fuente: la ficha de partidos de laliga.com. OJO: el texto del artículo de
 * LaLiga dice que la temporada arranca "a las 19:00H", pero su propia ficha de
 * partidos marca las 19:30. Manda la ficha.
 *
 * Esta tabla es un puente hasta que la ingesta desde football-data.org rellene
 * `kickoff_at` con el dato real. En cuanto haya token, la API manda sobre esto.
 */
const OFFICIAL_KICKOFFS: Record<string, string> = {
  // ---- Jornada 1: del sábado 15 al jueves 27 de agosto ----
  '1:ALA-GET': '2026-08-15 19:30',
  '1:SEV-RAY': '2026-08-15 21:30',
  '1:RAC-VIL': '2026-08-16 17:00',
  '1:ESP-LEV': '2026-08-16 19:00',
  '1:CEL-OSA': '2026-08-16 21:30',
  '1:DEP-ELC': '2026-08-17 21:00',
  '1:ATM-MAL': '2026-08-19 21:00', // aplazado
  '1:VAL-BET': '2026-08-25 21:00', // aplazado
  '1:RMA-RSO': '2026-08-26 21:00', // aplazado
  '1:BAR-ATH': '2026-08-27 21:00', // aplazado

  // ---- Jornada 2: solo apertura y cierre publicados ----
  '2:RAY-ALA': '2026-08-20 21:00',
  '2:MAL-DEP': '2026-08-24 21:30',
}

export interface CalendarMatch {
  /** Estable entre despliegues: `2026-27-J01-M03`. */
  id: string
  home: TeamCode
  away: TeamCode
  /** ISO 8601 en UTC. */
  kickoffAt: string
  /** true mientras la hora sea la provisional y no la oficial de LaLiga. */
  kickoffProvisional: boolean
}

export interface CalendarGameweek {
  number: number
  /**
   * Fecha nominal de la jornada, `YYYY-MM-DD`. NO es el día en que se juega
   * todo: la jornada 1 va del 15 al 27 de agosto por los aplazamientos del
   * Mundial. Para el rango real usa `firstKickoffAt` y `lastKickoffAt`.
   */
  date: string
  matches: CalendarMatch[]
  /** Primer pitido inicial de la jornada, ISO 8601 UTC. */
  firstKickoffAt: string
  /** Último pitido inicial de la jornada, ISO 8601 UTC. */
  lastKickoffAt: string
  /** true si a algún partido le falta todavía el horario oficial. */
  hasProvisionalKickoffs: boolean
}

/**
 * España va en CEST (UTC+2) desde el último domingo de marzo hasta el último de
 * octubre, y en CET (UTC+1) el resto. Con jornadas repartidas entre agosto y mayo
 * hay que distinguirlo o los horarios bailan una hora media temporada.
 */
function madridOffsetHours(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const lastSunday = (year: number, month: number) => {
    const last = new Date(Date.UTC(year, month, 0))
    return last.getUTCDate() - last.getUTCDay()
  }
  const start = { month: 3, day: lastSunday(y, 3) }
  const end = { month: 10, day: lastSunday(y, 10) }
  const after = (mm: number, dd: number) => m > mm || (m === mm && d >= dd)
  const before = (mm: number, dd: number) => m < mm || (m === mm && d < dd)
  return after(start.month, start.day) && before(end.month, end.day) ? 2 : 1
}

/** Convierte una hora de PARED de Madrid (`YYYY-MM-DD HH:MM`) a ISO en UTC. */
function madridWallToUtc(day: string, time: string): string {
  const [h, min] = time.split(':').map(Number)
  const at = new Date(`${day}T00:00:00Z`)
  at.setUTCHours(h - madridOffsetHours(day), min)
  return at.toISOString()
}

export const GAMEWEEKS: CalendarGameweek[] = RAW_CALENDAR.map((line) => {
  const [num, date, pairs] = line.split('|')
  const number = Number(num)

  const matches: CalendarMatch[] = pairs.split(',').map((pair, i) => {
    const [home, away] = pair.split('-') as [TeamCode, TeamCode]

    // Si LaLiga ya publicó el horario, manda ese. Si no, uno provisional
    // repartido a lo largo de la fecha nominal, marcado como tal.
    const official = OFFICIAL_KICKOFFS[`${number}:${home}-${away}`]
    const [day, time] = official
      ? official.split(' ')
      : [date, `${String(PROVISIONAL_HOURS[i] ?? 20).padStart(2, '0')}:00`]

    return {
      id: `${SEASON}-J${String(number).padStart(2, '0')}-M${String(i + 1).padStart(2, '0')}`,
      home,
      away,
      kickoffAt: madridWallToUtc(day, time),
      kickoffProvisional: official === undefined,
    }
  })

  // Ordenados por hora real: con los aplazamientos, el orden del sorteo ya no
  // es el orden en que se juegan, y la lista de la jornada se lee por fecha.
  matches.sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt))

  return {
    number,
    date,
    matches,
    firstKickoffAt: matches[0].kickoffAt,
    lastKickoffAt: matches[matches.length - 1].kickoffAt,
    hasProvisionalKickoffs: matches.some((m) => m.kickoffProvisional),
  }
})

export function gameweek(number: number): CalendarGameweek | null {
  return GAMEWEEKS.find((g) => g.number === number) ?? null
}

/** La jornada en curso: la primera que aún tiene algún partido por empezar. */
export function currentGameweek(now: Date = new Date()): CalendarGameweek {
  const t = now.getTime()
  return (
    GAMEWEEKS.find((g) => g.matches.some((m) => new Date(m.kickoffAt).getTime() > t)) ??
    GAMEWEEKS[GAMEWEEKS.length - 1]
  )
}
