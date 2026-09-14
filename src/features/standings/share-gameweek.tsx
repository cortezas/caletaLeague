'use client'

import { Check, Copy, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button, useToast } from '@/components/ui'
import type { GameweekStandingsVM } from '@/lib/view-models'

import { dibujarTarjeta } from './share-card'

/**
 * El resumen de la jornada, listo para soltarlo en el grupo.
 *
 * La peña vive en WhatsApp: el resultado de cada jornada se cuenta alli de todas
 * formas, escrito a mano y a veces mal. Esto lo escribe la app con los datos
 * buenos y en un toque.
 *
 * SE COMPARTE UNA IMAGEN, NO TEXTO. Antes esto solo copiaba un bloque de texto al
 * portapapeles; lo que llegaba al grupo era un ladrillo monoespaciado que
 * WhatsApp aplasta y nadie lee. La tarjeta se ve de un vistazo en la lista de
 * chats y no depende del tamaño de letra de cada uno. El texto se queda como
 * plan B: `navigator.share` con ficheros no existe en escritorio ni en algunos
 * navegadores de movil, y ahi se sigue pudiendo copiar y pegar.
 *
 * POR QUE NO LO MANDA SOLO UN BOT. Porque WhatsApp no deja: para escribir en un
 * grupo hay que ser un miembro del grupo, y un miembro es un NUMERO DE TELEFONO.
 * Tanto la API oficial de Meta como las librerias no oficiales piden una linea
 * dedicada, y una linea que hace de bot se puede quedar baneada sin aviso. Asi
 * que el ultimo toque lo da una persona, a proposito.
 *
 * SOLO CON LA JORNADA ACABADA. A media jornada el podio cambia cada partido y el
 * reparto de euros todavia no existe (`dues.ts` solo lo calcula con los diez
 * jugados), asi que un resumen adelantado seria mentira con formato bonito.
 */
export function ShareGameweek({ standings }: { standings: GameweekStandingsVM }) {
  const showToast = useToast()
  const [copiado, setCopiado] = useState(false)
  const [imagen, setImagen] = useState<{ file: File; url: string } | null>(null)

  const acabada = standings.rows.length > 0 && standings.rows.every((r) => r.pendingCount === 0)

  const podio = standings.rows.slice(0, 3)
  const pagan = standings.rows.filter((r) => r.euros !== null)
  const medallas = ['1.', '2.', '3.']

  const lineas = [
    `JORNADA ${standings.number} - LA CALETA LEAGUE`,
    '',
    ...podio.map((r, i) => `${medallas[i] ?? `${r.position}.`} ${r.displayName} - ${r.points} pts`),
  ]

  if (pagan.length > 0) {
    lineas.push('', 'A pagar:')
    // De mas a menos, que es como se lee el castigo.
    for (const r of [...pagan].sort((a, b) => (b.euros ?? 0) - (a.euros ?? 0))) {
      lineas.push(`  ${r.displayName}: ${r.euros} EUR`)
    }
  }

  const texto = lineas.join('\n')

  // Lo unico de lo que depende el dibujo. Sin esto la dependencia del efecto
  // seria el objeto `standings` entero, y cualquier re-render del padre volveria
  // a generar el PNG para nada.
  const firma = JSON.stringify(
    standings.rows.map((r) => [r.position, r.displayName, r.points, r.euros]),
  )

  // La imagen se dibuja EN CUANTO SE PUEDE, no al pulsar. En iOS el permiso para
  // abrir el menu de compartir se pierde si entre el toque y la llamada hay un
  // await, asi que cuando el dedo llega el fichero ya tiene que estar hecho.
  useEffect(() => {
    if (!acabada) return
    let vivo = true
    let creada: string | null = null

    dibujarTarjeta({
      number: standings.number,
      rows: standings.rows.map((r) => ({
        position: r.position,
        displayName: r.displayName,
        points: r.points,
        euros: r.euros,
      })),
    })
      .then((blob) => {
        if (!vivo) return
        creada = URL.createObjectURL(blob)
        setImagen({
          file: new File([blob], `jornada-${standings.number}.png`, { type: 'image/png' }),
          url: creada,
        })
      })
      .catch(() => {
        // Sin imagen no se rompe nada: queda el boton de copiar el texto.
      })

    return () => {
      vivo = false
      if (creada) URL.revokeObjectURL(creada)
    }
    // `firma` resume las filas; `standings` entra solo para leerlas dentro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acabada, standings.number, firma])

  if (!acabada) return null

  async function compartir() {
    if (!imagen) return
    try {
      await navigator.share({ files: [imagen.file], title: `Jornada ${standings.number}` })
    } catch (error) {
      // Cancelar el menu de compartir tira AbortError. No es un fallo y no se avisa.
      if (error instanceof DOMException && error.name === 'AbortError') return
      showToast('No hemos podido compartir. Copia el texto.', 'bad')
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
      showToast('Copiado. Pégalo en el grupo.')
    } catch {
      showToast('No hemos podido copiar. Seleccionalo a mano.', 'bad')
    }
  }

  const sePuedeCompartir =
    imagen !== null &&
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [imagen.file] })

  return (
    <div className="rounded-[17px] border border-line bg-card px-[14px] py-[13px]">
      <p className="mb-[9px] text-[13px] font-extrabold">Resumen para el grupo</p>

      {imagen ? (
        // next/image no sirve aqui: la fuente es un blob: creado en el navegador,
        // no hay nada que optimizar en el servidor ni tamaño que conozca de antes.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imagen.url}
          alt={`Resumen de la jornada ${standings.number}`}
          className="mb-[11px] w-full rounded-[12px] border border-line"
        />
      ) : (
        <pre className="mb-[11px] overflow-x-auto whitespace-pre-wrap rounded-[12px] bg-sunk px-[12px] py-[10px] font-num text-[12px] leading-[1.6] text-txt2">
          {texto}
        </pre>
      )}

      <div className="flex flex-col gap-[7px]">
        {sePuedeCompartir && (
          <Button
            variant="primary"
            size="sm"
            fullWidth
            onClick={compartir}
            leading={<Share2 size={15} strokeWidth={2.3} aria-hidden />}
          >
            Compartir la tarjeta
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          fullWidth
          onClick={copiar}
          leading={
            copiado ? (
              <Check size={15} strokeWidth={2.6} aria-hidden />
            ) : (
              <Copy size={15} strokeWidth={2.3} aria-hidden />
            )
          }
        >
          {copiado ? 'Copiado' : 'Copiar el texto'}
        </Button>
      </div>
    </div>
  )
}
