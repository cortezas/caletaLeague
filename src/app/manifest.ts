import type { MetadataRoute } from 'next'

/**
 * Next sirve esto en /manifest.webmanifest e inyecta el <link rel="manifest">
 * automaticamente. Por eso el root layout NO declara `manifest` en su metadata.
 *
 * iOS ignora los iconos de aqui y usa app/apple-icon.png; los de este fichero
 * son para Android y para el escritorio.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'La Caleta League',
    short_name: 'La Caleta',
    description:
      'La peña de pronósticos de la oficina. Nadie ve tu pronóstico hasta el pitido inicial. Cero excusas.',
    lang: 'es-ES',
    start_url: '/jornada',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0B0F14',
    theme_color: '#0B0F14',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
