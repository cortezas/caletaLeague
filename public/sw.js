/*
 * Service worker de La Caleta League.
 *
 * SOLO NOTIFICACIONES. Dos escuchadores: `push` y `notificationclick`.
 *
 * NO hay escuchador `fetch` y NO se cachea nada, a proposito. El dato central
 * de esta app es "que hora es y si ya ha empezado el partido": servir una
 * jornada cacheada seria ensenar un cierre que ya paso. Ademas, sin escuchador
 * `fetch` los navegadores modernos ni siquiera arrancan el worker al navegar,
 * asi que no cuesta nada.
 *
 * Escrito a mano y servido como estatico desde /public. NADA de Serwist ni de
 * plugins de PWA: inyectan configuracion de webpack y el build por defecto de
 * Next 16 es Turbopack, que reventaria. Este fichero no pasa por el bundler,
 * por eso es JavaScript plano sin imports ni sintaxis moderna arriesgada.
 *
 * Lo registra `src/features/settings/notifications-toggle.tsx`. Al estar en la
 * raiz del dominio su ambito es "/", que es lo que hace falta para que
 * `clients.matchAll` encuentre cualquier pestana de la app.
 */

// Un worker de notificaciones no tiene nada que conservar de la version
// anterior: activarse en cuanto se instala evita que un despliegue con un
// formato de payload nuevo se quede semanas esperando a que cierren la pestana.
self.addEventListener('install', function () {
  self.skipWaiting()
})

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim())
})

var FALLBACK = {
  title: 'La Caleta League',
  body: 'Tienes pronósticos pendientes.',
  url: '/jornada',
  tag: 'la-caleta',
}

function readPayload(event) {
  if (!event.data) return FALLBACK
  try {
    var data = event.data.json()
    return {
      title: typeof data.title === 'string' && data.title ? data.title : FALLBACK.title,
      body: typeof data.body === 'string' && data.body ? data.body : FALLBACK.body,
      // Solo rutas relativas del propio sitio: un payload manipulado no puede
      // convertir la notificacion en un enlace a otro dominio.
      url: typeof data.url === 'string' && data.url.charAt(0) === '/' ? data.url : FALLBACK.url,
      tag: typeof data.tag === 'string' && data.tag ? data.tag : FALLBACK.tag,
    }
  } catch {
    // Payload que no es JSON. Se avisa igual con el texto generico: quedarse
    // callado seria peor, porque en Chrome un push sin notificacion visible
    // acaba revocando el permiso.
    return FALLBACK
  }
}

self.addEventListener('push', function (event) {
  var payload = readPayload(event)

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      tag: payload.tag,
      // Con `renotify` el aviso vuelve a sonar aunque reutilice la `tag`: si
      // quedan 10 minutos para el cierre, sustituir en silencio no sirve.
      renotify: true,
      // Nada de `requireInteraction`: el aviso caduca solo cuando empieza el
      // partido y no tiene sentido dejarlo clavado en la barra.
      data: { url: payload.url },
    }),
  )
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()

  var target = (event.notification.data && event.notification.data.url) || FALLBACK.url

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
      // Si la app ya esta abierta se reutiliza esa ventana: en iOS instalada,
      // abrir una nueva relanza la PWA entera y se pierde el sitio.
      function openNew() {
        return self.clients.openWindow ? self.clients.openWindow(target) : undefined
      }

      for (var i = 0; i < windowClients.length; i += 1) {
        var client = windowClients[i]
        if ('focus' in client) {
          if ('navigate' in client) {
            return client
              .focus()
              .then(function (focused) {
                return focused.navigate(target)
              })
              // `navigate` falla si esa pestaña se cargo antes de que existiera
              // el worker y no esta controlada. Abrir una ventana nueva es mejor
              // que dejar el toque sin efecto.
              .catch(openNew)
          }
          return client.focus()
        }
      }
      return openNew()
    }),
  )
})
