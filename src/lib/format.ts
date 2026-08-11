/**
 * Formateo compartido entre servidor y cliente.
 *
 * D17: TODO formateo de fecha/hora fija `locale: 'es-ES'` y `timeZone: 'Europe/Madrid'`.
 * Sin la zona horaria fija, servidor y cliente producen strings distintos segun donde
 * corran y React lanza un mismatch de hidratacion.
 */

const TZ = 'Europe/Madrid'
const LOCALE = 'es-ES'

/** Formateadores cacheados: construir un Intl.DateTimeFormat no es barato. */
const shortWeekdayFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, weekday: 'short' })
const longWeekdayFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, weekday: 'long' })
const timeFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const dayFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, day: 'numeric' })

/**
 * Iniciales para el avatar: "Curro M." -> "CM".
 * D19(e): esta es la UNICA implementacion; la clave es el `.replace(/\./g,'')`,
 * que descarta los puntos de los apellidos abreviados ("Jose A." -> "JA").
 */
export function initials(displayName: string): string {
  return displayName
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .join('')
    .replace(/\./g, '')
    .slice(0, 2)
    .toUpperCase()
}

/** 7 -> '07'. Para los numeros de fila del resumen de jornada ('01'...'10'). */
export function pad2(n: number): string {
  return String(Math.trunc(Math.abs(n))).padStart(2, '0')
}

/** plural(1,'partido','partidos') -> '1 partido'; plural(3,...) -> '3 partidos'. */
export function plural(count: number, singular: string, many: string): string {
  return `${count} ${count === 1 ? singular : many}`
}

/**
 * Cuenta atras en HH:MM:SS con clamp a '00:00:00'.
 * Las horas NO se acotan a 24: una jornada puede abrirse con tres dias de margen
 * y '72:14:03' es preferible a perder la informacion.
 */
export function formatCountdown(msRemaining: number): string {
  const total = Math.max(0, Math.floor(msRemaining / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Algunos ICU devuelven el dia abreviado con punto ("vie."); se normaliza. */
function weekday(iso: string, style: 'short' | 'long'): string {
  const date = new Date(iso)
  const raw = style === 'short' ? shortWeekdayFmt.format(date) : longWeekdayFmt.format(date)
  return capitalize(raw.replace(/\.$/, ''))
}

/**
 * Etiqueta del pitido inicial en hora de Madrid.
 *  - 'short' (por defecto): 'Sáb 18:30'  -> filas de partido y cabeceras
 *  - 'long':                'Viernes 21:00' -> cabecera del pique
 */
/**
 * 'Sáb 15 · 19:30'.
 *
 * Lleva el dia del mes a proposito, aunque el handoff solo pedia 'Sáb 18:30'.
 * Ese diseño daba por hecho que una jornada cabe en un fin de semana, y no es
 * cierto: la jornada 1 de 2026/27 va del 15 al 27 de agosto por los aplazamientos
 * del Mundial, y tiene DOS miercoles (Atlético–Málaga el 19 y Real Madrid–Real
 * Sociedad el 26). Sin el numero, las dos filas ponen 'Mié 21:00' y alguien se
 * queda sin pronosticar creyendo que le quedaba una semana.
 */
export function formatKickoff(iso: string, style: 'short' | 'long' = 'short'): string {
  const day = dayFmt.format(new Date(iso))
  return `${weekday(iso, style)} ${day} · ${timeFmt.format(new Date(iso))}`
}

/**
 * Marcador como texto. Devuelve el placeholder '· ·' cuando falta algun lado,
 * que es lo que pinta el resumen de jornada para un partido sin pronosticar.
 */
export function scoreLabel(
  home: number | null | undefined,
  away: number | null | undefined,
  separator = '-',
): string {
  if (typeof home !== 'number' || typeof away !== 'number') return '· ·'
  return `${home}${separator}${away}`
}
