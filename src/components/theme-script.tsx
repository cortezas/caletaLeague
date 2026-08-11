/**
 * Script sincrono inyectado en el <head>.
 *
 * Corre durante el parseo del HTML, antes del primer pintado, que es la unica
 * forma de que no haya un fogonazo del tema equivocado. Con useEffect o
 * useLayoutEffect el flash esta garantizado.
 *
 * Requiere `suppressHydrationWarning` en <html>, porque este script modifica el
 * atributo `data-theme` que React cree haber renderizado el.
 */

// Se minifica a mano: va inline en cada respuesta HTML.
const script = `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t='dark'}document.documentElement.setAttribute('data-theme',t);document.documentElement.style.colorScheme=t}catch(e){}})()`

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />
}
