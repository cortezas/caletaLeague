'use client'

import { useCallback, useEffect, useState } from 'react'

import { cn } from '@/lib/cn'

/**
 * Interruptor de "Avisos antes del cierre" para /ajustes.
 *
 * Hasta ahora esa fila era texto muerto ("1 hora antes" sin nada detras). Este
 * componente la hace real: pide permiso, registra `public/sw.js`, se suscribe y
 * manda la suscripcion a `/api/push/subscribe`.
 *
 * Se renderiza como una fila mas dentro de un `<SettingsGroup>`: el separador
 * lo pone el `divide-y` del padre, aqui solo va el relleno.
 *
 * TRES COSAS QUE LA INTERFAZ TIENE QUE DECIR EN VOZ ALTA, NO FALLAR EN SILENCIO:
 *
 *  1. iOS. Desde iOS 16.4 hay notificaciones web, pero SOLO si la app esta
 *     instalada en la pantalla de inicio (Compartir > Añadir a pantalla de
 *     inicio). En Safari normal `window.PushManager` ni existe. Un mensaje
 *     generico de "tu navegador no lo admite" mandaria a la mitad de la peña a
 *     pensar que su iPhone esta roto.
 *  2. HTTPS. Sin contexto seguro no hay service worker. `localhost` cuenta como
 *     seguro para poder probar en local, pero el hosting tiene que servir HTTPS.
 *  3. Sin claves VAPID configuradas el interruptor sale DESHABILITADO con su
 *     explicacion. Nunca a medias: un interruptor que se puede encender y no
 *     hace nada es peor que un interruptor apagado.
 */

/** Todo lo que impide activar los avisos, con su explicacion para el usuario. */
type Blocker =
  | { kind: 'ios-safari' }
  | { kind: 'insecure' }
  | { kind: 'unsupported' }
  | { kind: 'not-configured'; message: string }
  | { kind: 'no-session' }

interface Ready {
  publicKey: string
  subscribed: boolean
}

function isIOS(): boolean {
  const ua = navigator.userAgent
  // El iPad con iPadOS 13+ se anuncia como Macintosh; los puntos tactiles lo delatan.
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
}

function isStandalone(): boolean {
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  // `navigator.standalone` es propietario de Safari y no esta en los tipos DOM.
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true
}

/**
 * La clave VAPID viaja en base64url y `pushManager.subscribe` quiere bytes.
 * Se construye sobre un ArrayBuffer explicito para que el tipo encaje con
 * `BufferSource` sin castings.
 */
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** Lee un error de una respuesta que puede no ser JSON (el proxy devuelve HTML). */
async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown }
    return typeof body.error === 'string' ? body.error : fallback
  } catch {
    return fallback
  }
}

export function NotificationsToggle() {
  // 'checking' es el primer render en servidor Y en cliente: sin un estado
  // neutro habria mismatch de hidratacion, porque nada de esto se sabe en el
  // servidor.
  const [phase, setPhase] = useState<'checking' | 'blocked' | 'ready'>('checking')
  const [blocker, setBlocker] = useState<Blocker | null>(null)
  const [ready, setReady] = useState<Ready | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function check() {
      const supported =
        'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

      if (!supported) {
        // El orden importa: en iPhone sin instalar, la causa REAL es esa, no
        // que el navegador sea viejo.
        if (isIOS() && !isStandalone()) return finishBlocked({ kind: 'ios-safari' })
        if (!window.isSecureContext) return finishBlocked({ kind: 'insecure' })
        return finishBlocked({ kind: 'unsupported' })
      }
      if (!window.isSecureContext) return finishBlocked({ kind: 'insecure' })

      let response: Response
      try {
        response = await fetch('/api/push/subscribe', { headers: { Accept: 'application/json' } })
      } catch {
        return finishBlocked({
          kind: 'not-configured',
          message: 'No se ha podido comprobar la configuración de los avisos.',
        })
      }

      if (response.status === 401) return finishBlocked({ kind: 'no-session' })
      if (!response.ok) {
        return finishBlocked({
          kind: 'not-configured',
          message: await readError(response, 'Los avisos no están configurados en este entorno.'),
        })
      }

      const body = (await response.json()) as { publicKey?: unknown }
      if (typeof body.publicKey !== 'string' || !body.publicKey) {
        return finishBlocked({
          kind: 'not-configured',
          message: 'El servidor no ha devuelto la clave pública de los avisos.',
        })
      }

      // NO se registra el service worker aqui: solo se mira si ya lo hay. Un
      // registro sin que nadie haya pedido avisos seria trabajo por la cara.
      const registration = await navigator.serviceWorker.getRegistration('/')
      const existing = registration ? await registration.pushManager.getSubscription() : null

      if (cancelled) return
      setPermissionDenied(Notification.permission === 'denied')
      setReady({ publicKey: body.publicKey, subscribed: Boolean(existing) })
      setPhase('ready')
    }

    function finishBlocked(next: Blocker) {
      if (cancelled) return
      setBlocker(next)
      setPhase('blocked')
    }

    void check()
    return () => {
      cancelled = true
    }
  }, [])

  const enable = useCallback(async () => {
    if (!ready) return
    setError(null)

    // PRIMERA LINEA, SIN NINGUN `await` ANTES: Safari solo concede el permiso si
    // la llamada sale directamente del gesto del usuario. Un `await` intermedio
    // rompe la cadena y el dialogo no aparece.
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      setPermissionDenied(permission === 'denied')
      setError(
        permission === 'denied'
          ? 'Has bloqueado las notificaciones para esta web. Vuelve a permitirlas desde los ajustes del navegador.'
          : 'No has dado permiso para las notificaciones.',
      )
      return
    }

    setBusy(true)
    setPermissionDenied(false)
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      await navigator.serviceWorker.ready

      const existing = await registration.pushManager.getSubscription()
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          // Obligatorio en Chrome: nos comprometemos a que cada push muestre una
          // notificacion visible. `public/sw.js` la muestra siempre, incluso si
          // el payload viene roto.
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(ready.publicKey),
        }))

      const json = subscription.toJSON()
      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      })

      if (!response.ok) {
        // El servidor no la ha guardado: se deshace la suscripcion local para
        // no dejar al navegador creyendo que esta apuntado a algo que no existe.
        await subscription.unsubscribe().catch(() => undefined)
        setError(await readError(response, 'No se ha podido guardar la suscripción.'))
        return
      }

      setReady({ ...ready, subscribed: true })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se han podido activar los avisos.')
    } finally {
      setBusy(false)
    }
  }, [ready])

  const disable = useCallback(async () => {
    if (!ready) return
    setError(null)
    setBusy(true)
    try {
      const registration = await navigator.serviceWorker.getRegistration('/')
      const subscription = registration ? await registration.pushManager.getSubscription() : null

      if (subscription) {
        // Primero el servidor, luego el navegador: al reves, si el borrado en
        // servidor fallara ya no tendriamos el endpoint que hay que borrar y la
        // fila se quedaria ahi mandando avisos a un buzon muerto.
        const response = await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        })
        if (!response.ok) {
          setError(await readError(response, 'No se ha podido desactivar en el servidor.'))
          return
        }
        await subscription.unsubscribe()
      }

      setReady({ ...ready, subscribed: false })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se han podido desactivar los avisos.')
    } finally {
      setBusy(false)
    }
  }, [ready])

  const subscribed = ready?.subscribed ?? false
  const interactive = phase === 'ready' && !busy

  let hint: string
  if (phase === 'checking') hint = 'Comprobando…'
  else if (phase === 'blocked') hint = 'No disponible en este dispositivo'
  else if (busy) hint = 'Un momento…'
  else hint = subscribed ? 'Activados · 1 hora antes' : 'Desactivados'

  return (
    <div className="px-[15px] py-[13px]">
      <div className="flex min-h-[50px] items-center gap-[12px]">
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-bold">Avisos antes del cierre</span>
          <span className="block text-[12px] font-semibold text-txt3">{hint}</span>
        </span>

        <button
          type="button"
          role="switch"
          aria-checked={subscribed}
          aria-label="Avisos antes del cierre"
          disabled={!interactive}
          onClick={subscribed ? disable : enable}
          className={cn(
            'flex min-h-[44px] min-w-[56px] flex-none items-center justify-center rounded-[14px]',
            'transition-transform duration-100 active:scale-[.97]',
            !interactive && 'opacity-45',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'flex h-[30px] w-[52px] items-center rounded-full border px-[3px] transition-colors duration-150',
              subscribed ? 'justify-end border-accent bg-accent' : 'justify-start border-line2 bg-sunk',
            )}
          >
            <span
              className={cn(
                'h-[24px] w-[24px] rounded-full',
                subscribed ? 'bg-accent-ink' : 'bg-card2',
              )}
            />
          </span>
        </button>
      </div>

      {phase === 'blocked' && blocker && <BlockerNote blocker={blocker} />}

      {phase === 'ready' && permissionDenied && !subscribed && (
        <p className="mt-[8px] text-[12px] font-semibold leading-[1.45] text-warn">
          Este navegador tiene las notificaciones bloqueadas para La Caleta League. Permítelas desde
          sus ajustes de sitio y vuelve a intentarlo.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-[8px] text-[12px] font-semibold leading-[1.45] text-bad">
          {error}
        </p>
      )}

      {phase === 'ready' && subscribed && (
        <p className="mt-[8px] text-[12px] font-semibold leading-[1.45] text-txt3">
          Un aviso por dispositivo y por partido: solo si a menos de una hora del pitido inicial aún
          no has pronosticado.
        </p>
      )}
    </div>
  )
}

function BlockerNote({ blocker }: { blocker: Blocker }) {
  const text = (() => {
    switch (blocker.kind) {
      case 'ios-safari':
        return 'En iPhone y iPad los avisos solo funcionan con la app instalada: Compartir → Añadir a pantalla de inicio, y ábrela desde ahí. Requiere iOS 16.4 o superior.'
      case 'insecure':
        return 'Los avisos necesitan una conexión segura (HTTPS). En localhost funcionan para pruebas.'
      case 'unsupported':
        return 'Este navegador no admite notificaciones web.'
      case 'no-session':
        return 'Tu sesión ha caducado. Vuelve a entrar para configurar los avisos.'
      case 'not-configured':
        return blocker.message
    }
  })()

  return (
    <p className="mt-[8px] text-[12px] font-semibold leading-[1.45] text-txt3">{text}</p>
  )
}
