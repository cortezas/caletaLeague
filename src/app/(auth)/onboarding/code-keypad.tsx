'use client'

import { Delete, Info } from 'lucide-react'

import { Card } from '@/components/ui'
import { cn } from '@/lib/cn'
import { CODE_KEYS } from '@/lib/seed'

const CODE_LENGTH = 6

export interface CodeKeypadProps {
  value: string
  onValueChange: (value: string) => void
}

/**
 * Casillas del codigo + teclado propio, para escribirlo con un pulgar y sin que
 * salte el teclado del sistema.
 *
 * El alfabeto son las 32 teclas de `CODE_KEYS` (sin I ni O, que se confunden con
 * 1 y 0), no las 12 teclas del prototipo, que eran atrezzo con la palabra CALETA
 * ya escrita. Con 6 columnas cada tecla mide ~53px de ancho en un iPhone, o sea
 * por encima del minimo tactil de 44.
 *
 * La nota informativa vive aqui porque va entre las casillas y el teclado.
 */
export function CodeKeypad({ value, onValueChange }: CodeKeypadProps) {
  const filled = value.length

  function press(key: string) {
    if (filled >= CODE_LENGTH) return
    onValueChange(value + key)
  }

  return (
    <div>
      <div className="mb-[14px] flex gap-[8px]" role="group" aria-label="Código de invitación">
        {Array.from({ length: CODE_LENGTH }, (_, index) => (
          <div
            key={index}
            aria-hidden
            style={{ aspectRatio: '1 / 1.18' }}
            className={cn(
              'flex flex-1 items-center justify-center rounded-[14px] border-[1.5px] bg-card font-num text-[26px] font-bold text-txt',
              index === filled ? 'border-accent' : 'border-line',
            )}
          >
            {value[index] ?? ''}
          </div>
        ))}
      </div>

      {/* Las casillas son decorativas para el lector de pantalla; el progreso se anuncia aqui. */}
      <p className="sr-only" aria-live="polite">
        {filled} de {CODE_LENGTH} caracteres
      </p>

      <Card radius={14} className="mb-[20px] flex items-start gap-[10px] px-[15px] py-[13px]">
        <Info size={17} strokeWidth={2} className="mt-[1px] flex-none text-txt3" aria-hidden />
        <span className="text-[13px] leading-[1.45] text-txt2">
          Cada peña tiene su propio código. Si te equivocas, no pasa nada: puedes reintentarlo.
        </span>
      </Card>

      {/* 32 teclas en filas de 6 dejan 2 huecos en la ultima fila: los ocupa el borrado. */}
      <div className="grid grid-cols-6 gap-[8px]">
        {CODE_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => press(key)}
            disabled={filled >= CODE_LENGTH}
            className="min-h-[52px] rounded-[13px] border border-line bg-card2 font-num text-[19px] font-bold text-txt transition-transform duration-100 active:scale-[.97] active:opacity-90 disabled:opacity-40"
          >
            {key}
          </button>
        ))}

        <button
          type="button"
          onClick={() => onValueChange(value.slice(0, -1))}
          disabled={filled === 0}
          aria-label="Borrar el último carácter"
          className="col-span-4 flex min-h-[52px] items-center justify-center rounded-[13px] border border-line bg-card2 text-txt transition-transform duration-100 active:scale-[.97] active:opacity-90 disabled:opacity-40"
        >
          <Delete size={20} strokeWidth={1.9} aria-hidden />
        </button>
      </div>
    </div>
  )
}
