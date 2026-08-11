import type { Metadata, Viewport } from 'next'
import { Barlow_Condensed, Figtree } from 'next/font/google'

import { ThemeScript } from '@/components/theme-script'
import { ToastProvider } from '@/components/ui/toast'

import './globals.css'

// Figtree es fuente variable: pasarle `weight` la convertiria en 6 @font-face estaticos.
const figtree = Figtree({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-figtree',
})

// Barlow Condensed NO es variable: `weight` es obligatorio o falla la compilacion.
const barlowCondensed = Barlow_Condensed({
  weight: ['700', '800'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-barlow-condensed',
})

export const metadata: Metadata = {
  title: 'La Caleta League',
  description:
    'La peña de pronósticos de la oficina. Nadie ve tu pronóstico hasta el pitido inicial. Cero excusas.',
  applicationName: 'La Caleta League',
  appleWebApp: {
    capable: true,
    title: 'La Caleta League',
    // Funde la barra de estado con la cabecera; exige respetar las safe areas.
    statusBarStyle: 'black-translucent',
  },
  formatDetection: { telephone: false, date: false, address: false, email: false },
  // `icons` no se declara: app/icon.png y app/apple-icon.png ya generan los tags.
  // `manifest` tampoco: app/manifest.ts inyecta el link automaticamente.
}

export const viewport: Viewport = {
  themeColor: '#0B0F14',
  colorScheme: 'dark light',
  width: 'device-width',
  initialScale: 1,
  // Sin esto env(safe-area-inset-*) devuelve 0px en iPhone y la tab bar
  // se queda debajo del home indicator.
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="es"
      data-theme="dark"
      suppressHydrationWarning
      className={`${figtree.variable} ${barlowCondensed.variable}`}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh bg-bg font-ui text-txt antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  )
}
