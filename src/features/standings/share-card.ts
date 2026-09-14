/**
 * La tarjeta de la jornada, dibujada en un canvas y exportada como PNG.
 *
 * POR QUE UNA IMAGEN Y NO TEXTO
 * El resumen ya se podia copiar y pegar, pero lo que llegaba al grupo era un
 * bloque de texto plano que WhatsApp aplasta y nadie lee. Una imagen se ve de un
 * vistazo en la lista de chats, sobrevive a las citas y a los reenvios, y no se
 * descoloca si alguien tiene la letra grande.
 *
 * POR QUE EN EL NAVEGADOR Y NO EN EL SERVIDOR
 * Aqui no hay que pagar nada ni levantar nada: el movil ya tiene el canvas y ya
 * tiene los datos en pantalla. Generarla en Vercel obligaria a meter una
 * libreria de imagenes y una ruta nueva para ahorrar 40 ms que nadie nota.
 *
 * TODO EN MODO OSCURO, SIEMPRE. La tarjeta no sigue el tema de quien la comparte:
 * es una imagen que van a ver doce personas con doce ajustes distintos, y tiene
 * que verse igual en todas. Se eligio el oscuro porque es el tema por defecto de
 * la app y el que se lee mejor sobre el fondo de un chat.
 */

/** Paleta fija, copiada de los tokens oscuros de globals.css. */
const C = {
  bg: '#0B0F14',
  card: '#161D26',
  card2: '#1E2733',
  line: 'rgba(255,255,255,0.08)',
  txt: '#F3F6FA',
  txt2: '#96A2B2',
  txt3: '#5E6B7A',
  accent: '#7C5CFF',
  accent2: '#9B84FF',
  oro: '#F5C451',
  rojo: '#FF6B6B',
} as const

const W = 1080
const PAD = 64
const CABECERA = 300
const FILA = 68
const PIE = 96

export interface FilaTarjeta {
  position: number
  displayName: string
  points: number
  /** Lo que paga en esta jornada. `null` si no le toca. */
  euros: number | null
}

export interface DatosTarjeta {
  number: number
  rows: FilaTarjeta[]
}

/**
 * Las familias reales que next/font ha generado.
 *
 * `ctx.font` no entiende `var(--font-figtree)`, hay que darle el nombre ya
 * resuelto. Si por lo que sea no estan, se cae a las del sistema: una tarjeta
 * con otra tipografia sigue siendo legible, y es mejor que no generar nada.
 */
function familias(): { texto: string; numero: string } {
  if (typeof document === 'undefined') return { texto: 'sans-serif', numero: 'sans-serif' }
  const css = getComputedStyle(document.documentElement)
  const texto = css.getPropertyValue('--font-figtree').trim()
  const numero = css.getPropertyValue('--font-barlow-condensed').trim()
  return {
    texto: texto === '' ? 'system-ui, sans-serif' : `${texto}, system-ui, sans-serif`,
    numero: numero === '' ? 'system-ui, sans-serif' : `${numero}, system-ui, sans-serif`,
  }
}

/** Recorta con puntos suspensivos para que un nombre largo no pise a los puntos. */
function recorta(ctx: CanvasRenderingContext2D, texto: string, ancho: number): string {
  if (ctx.measureText(texto).width <= ancho) return texto
  let corte = texto
  while (corte.length > 1 && ctx.measureText(`${corte}...`).width > ancho) {
    corte = corte.slice(0, -1)
  }
  return `${corte}...`
}

function rect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  relleno: string,
) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fillStyle = relleno
  ctx.fill()
}

/**
 * Dibuja la tarjeta y devuelve el PNG.
 *
 * Espera a `document.fonts.ready` antes de medir nada: si se dibuja con la
 * tipografia de reserva y las buenas llegan despues, los recortes de los nombres
 * se calculan con anchos que no son los finales.
 */
export async function dibujarTarjeta(datos: DatosTarjeta): Promise<Blob> {
  if (document.fonts?.ready) await document.fonts.ready

  const pagan = datos.rows.filter((r) => r.euros !== null)
  const altoPagan = pagan.length > 0 ? 70 + pagan.length * 52 + 28 : 0
  const H = CABECERA + datos.rows.length * FILA + altoPagan + PIE

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('sin canvas 2d')

  const f = familias()

  // ---- Fondo -------------------------------------------------------------
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, W, H)
  // Un halo morado arriba a la izquierda, lo justo para que no sea un folio negro.
  const halo = ctx.createRadialGradient(180, 60, 0, 180, 60, 720)
  halo.addColorStop(0, 'rgba(124,92,255,0.22)')
  halo.addColorStop(1, 'rgba(124,92,255,0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, W, 620)

  // ---- Cabecera ----------------------------------------------------------
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = C.accent2
  ctx.font = `700 30px ${f.texto}`
  ctx.letterSpacing = '3px'
  ctx.fillText('LA CALETA LEAGUE', PAD, 116)
  ctx.letterSpacing = '0px'

  ctx.fillStyle = C.txt
  ctx.font = `700 140px ${f.numero}`
  ctx.fillText(`JORNADA ${datos.number}`, PAD, 232)

  ctx.fillStyle = C.txt3
  ctx.font = `600 26px ${f.texto}`
  ctx.fillText('Clasificación de la jornada', PAD, 276)

  // ---- Filas -------------------------------------------------------------
  const medalla = [C.oro, '#C8D2DE', '#C98B5B']
  let y = CABECERA

  for (const fila of datos.rows) {
    const podio = fila.position <= 3
    rect(ctx, PAD, y, W - PAD * 2, FILA - 10, 16, podio ? C.card2 : C.card)

    if (podio) {
      rect(ctx, PAD, y, 6, FILA - 10, 3, medalla[fila.position - 1])
    }

    ctx.fillStyle = podio ? medalla[fila.position - 1] : C.txt3
    ctx.font = `700 ${podio ? 40 : 32}px ${f.numero}`
    ctx.textAlign = 'center'
    ctx.fillText(String(fila.position), PAD + 52, y + 40)

    ctx.textAlign = 'left'
    ctx.fillStyle = C.txt
    ctx.font = `${podio ? 700 : 600} ${podio ? 36 : 32}px ${f.texto}`
    ctx.fillText(recorta(ctx, fila.displayName, 540), PAD + 96, y + 39)

    ctx.textAlign = 'right'
    ctx.fillStyle = podio ? C.txt : C.txt2
    ctx.font = `700 ${podio ? 46 : 38}px ${f.numero}`
    ctx.fillText(String(fila.points), W - PAD - 86, y + 41)

    ctx.fillStyle = C.txt3
    ctx.font = `600 22px ${f.texto}`
    ctx.textAlign = 'left'
    ctx.fillText('pts', W - PAD - 74, y + 39)
    ctx.textAlign = 'left'

    y += FILA
  }

  // ---- Quien paga --------------------------------------------------------
  if (pagan.length > 0) {
    y += 26
    ctx.fillStyle = C.rojo
    ctx.font = `700 26px ${f.texto}`
    ctx.letterSpacing = '2px'
    ctx.fillText('PAGAN ESTA JORNADA', PAD, y + 18)
    ctx.letterSpacing = '0px'
    y += 44

    // De mas a menos, que es como se lee el castigo.
    for (const r of [...pagan].sort((a, b) => (b.euros ?? 0) - (a.euros ?? 0))) {
      ctx.fillStyle = C.txt2
      ctx.font = `600 30px ${f.texto}`
      ctx.fillText(recorta(ctx, r.displayName, 640), PAD, y + 28)

      ctx.textAlign = 'right'
      ctx.fillStyle = C.rojo
      ctx.font = `700 34px ${f.numero}`
      ctx.fillText(`${r.euros} €`, W - PAD, y + 30)
      ctx.textAlign = 'left'
      y += 52
    }
    y += 28
  }

  // ---- Pie ---------------------------------------------------------------
  ctx.fillStyle = C.line
  ctx.fillRect(PAD, H - PIE + 8, W - PAD * 2, 2)
  ctx.fillStyle = C.txt3
  ctx.font = `600 24px ${f.texto}`
  ctx.fillText('caleta-league.vercel.app', PAD, H - 34)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('el canvas no ha dado imagen'))
    }, 'image/png')
  })
}
