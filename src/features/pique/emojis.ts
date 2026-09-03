/**
 * Los emojis con los que se puede reaccionar. Lista CERRADA.
 *
 * VIVE AQUI Y NO EN `reaction-actions.ts` POR UNA RAZON DURA: de un fichero
 * `'use server'` solo pueden salir funciones async. Exportar de ahi una
 * constante rompe la pantalla al cargarla, y con un error que no menciona ni el
 * fichero ni la constante -- lo que se ve es la pantalla de "Sin conexion".
 *
 * Es la segunda vez que pasa en este repo: la primera fue `NO_INVITE` en
 * `admin/access-actions.ts`, que se llevo por delante la pestaña de Accesos y
 * esta documentada alli mismo. De ahi este fichero, que existe solo para que la
 * lista no tenga que vivir en un `'use server'`.
 *
 * La usan las dos partes: el componente para pintar los botones y la accion
 * para validar lo que llega. El CHECK de `public.reactions` (migracion 0035)
 * tiene la misma lista: si cambia una, cambian las tres.
 */
export const EMOJIS = ['🔥', '💀', '🤡', '👏', '😂', '🧠'] as const
