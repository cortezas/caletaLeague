'use client'

import { useState } from 'react'

import { Segmented } from '@/components/ui'
import type { ThemeName } from '@/lib/types'

const OPTIONS = [
  { value: 'dark', label: 'Oscuro' },
  { value: 'light', label: 'Claro' },
]

/**
 * Misma fuente de verdad que el script inline del <head>: la clave 'theme' de
 * localStorage. Si se leyera con useEffect, el primer render del cliente
 * marcaria "Oscuro" aunque el tema aplicado fuese el claro.
 */
function readTheme(): ThemeName {
  if (typeof document === 'undefined') return 'dark'
  try {
    return localStorage.getItem('theme') === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function ThemeToggle() {
  // Lazy initializer, no useState('dark'): el valor tiene que estar bien en el
  // primer render del cliente. El HTML del servidor siempre dice 'dark', asi que
  // con el tema claro React corrige estos dos botones al hidratar; es el precio
  // de no tener el tema disponible en el servidor.
  const [theme, setTheme] = useState<ThemeName>(readTheme)

  function apply(value: string) {
    const next: ThemeName = value === 'light' ? 'light' : 'dark'
    setTheme(next)
    try {
      localStorage.setItem('theme', next)
    } catch {
      // Modo privado de Safari: el tema se aplica igual, solo no se recuerda.
    }
    document.documentElement.setAttribute('data-theme', next)
    // Sin esto los controles nativos (scrollbars, inputs) se quedan en el otro tema.
    document.documentElement.style.colorScheme = next
  }

  return <Segmented size="sm" options={OPTIONS} value={theme} onValueChange={apply} />
}
