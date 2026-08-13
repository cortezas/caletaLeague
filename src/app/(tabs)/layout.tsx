import { PullToRefresh } from '@/components/pull-to-refresh'
import { TabBar } from '@/components/tab-bar'

/**
 * Grupo de pantallas con barra de pestañas. No es root layout: no lleva
 * <html> ni <body>, o cada salto a una pantalla de pila recargaria la pagina.
 *
 * El padding inferior reserva el alto de la TabBar (48 icono + 7 top + 18 base)
 * mas el home indicator.
 *
 * PullToRefresh envuelve solo el contenido, no la TabBar: instalada en la
 * pantalla de inicio del iPhone la app no tiene barra de navegador ni gesto
 * nativo de recarga, y tirar hacia abajo es el unico instinto que queda.
 */
export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PullToRefresh>
        <main className="mx-auto min-h-dvh w-full max-w-[520px] pb-[calc(env(safe-area-inset-bottom)+92px)] lg:max-w-[1020px]">
          {children}
        </main>
      </PullToRefresh>
      <TabBar />
    </>
  )
}
