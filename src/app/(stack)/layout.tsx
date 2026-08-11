/**
 * Grupo de pantallas de pila: pronóstico, resumen, pique y admin.
 * Sin barra de pestañas, por eso no reserva espacio abajo. Las pantallas que
 * llevan barra de acción fija se reservan el suyo propio.
 *
 * Cada pantalla renderiza su propia cabecera con <ScreenHeader> (los layouts no
 * se re-renderizan al navegar y aquí cada pantalla tiene título distinto).
 */
export default function StackLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col lg:max-w-[720px]">
      {children}
    </main>
  )
}
