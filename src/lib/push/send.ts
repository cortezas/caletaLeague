/**
 * Envio de Web Push con la libreria `web-push`.
 *
 * Solo runtime nodejs: `web-push` cifra el payload con `node:crypto` y habla
 * con el servicio de push por `https`. En edge no arranca.
 *
 * El payload viaja CIFRADO extremo a extremo con las claves del navegador
 * (p256dh + auth): ni Google ni Apple ni Mozilla pueden leer que pone. Lo unico
 * que ven es que hay un mensaje para ese endpoint.
 */

import webpush, { WebPushError } from 'web-push'

import { requirePushConfig } from './vapid'

/** Las tres columnas de `public.push_subscriptions` que hacen falta para enviar. */
export interface PushSubscriptionRecord {
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * Lo que recibe `public/sw.js` en el evento `push`. Cualquier cambio aqui hay
 * que hacerlo tambien alli: son dos ficheros que no comparten tipos porque el
 * service worker no pasa por el bundler.
 */
export interface PushPayload {
  title: string
  body: string
  /** Ruta a la que lleva el toque en la notificacion. Siempre relativa. */
  url: string
  /**
   * Notificaciones con la misma `tag` se sustituyen en vez de apilarse. Sin
   * esto, dos pasadas del cron dejan dos avisos en la barra.
   */
  tag?: string
}

export type PushOutcome =
  /** Aceptado por el servicio de push. No garantiza que el movil lo ensene. */
  | 'sent'
  /** 404/410: el navegador desinstalo la PWA o revoco el permiso. Hay que borrar la fila. */
  | 'gone'
  /** Cualquier otro fallo. `retryable` distingue el corte de red del error de configuracion. */
  | 'failed'

export interface PushResult {
  endpoint: string
  outcome: PushOutcome
  statusCode: number | null
  error: string | null
  /** 429 y 5xx son transitorios: reintentar en la siguiente pasada tiene sentido. */
  retryable: boolean
}

export interface SendOptions {
  /**
   * Segundos que el servicio de push guarda el mensaje si el movil esta
   * apagado. Un aviso de "cierra en una hora" no sirve de nada mañana, asi que
   * el llamante pasa los segundos que faltan para el pitido inicial.
   */
  ttlSeconds?: number
}

const DEFAULT_TTL_SECONDS = 3600

export async function sendPush(
  subscription: PushSubscriptionRecord,
  payload: PushPayload,
  options: SendOptions = {},
): Promise<PushResult> {
  const vapid = requirePushConfig()
  // TTL negativo o gigante lo rechazan algunos servicios; se acota a [0, 1 dia].
  const ttl = Math.max(0, Math.min(86400, Math.round(options.ttlSeconds ?? DEFAULT_TTL_SECONDS)))

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
      {
        // Se pasan por llamada en vez de con `setVapidDetails`, que es estado
        // global del modulo y en un servidor con varias peticiones a la vez es
        // una carrera esperando a pasar.
        vapidDetails: {
          subject: vapid.subject,
          publicKey: vapid.publicKey,
          privateKey: vapid.privateKey,
        },
        TTL: ttl,
        // `high` es lo que despierta el movil en modo ahorro. Es legitimo: el
        // usuario pidio este aviso y caduca en una hora.
        //
        // VA COMO OPCION, NO COMO CABECERA: `web-push` escribe
        // `headers.Urgency` el ultimo con su propio valor, asi que pasarlo en
        // `headers` se pierde en silencio (comprobado: salia 'normal').
        urgency: 'high',
        // `topic` es la version del servicio de push de lo que `tag` es en el
        // navegador: si el movil esta apagado y llegan dos avisos con el mismo
        // topic, solo se entrega el ultimo. Tiene que ser base64url y <= 32.
        topic: payload.tag && /^[A-Za-z0-9_-]{1,32}$/.test(payload.tag) ? payload.tag : undefined,
      },
    )
    return { endpoint: subscription.endpoint, outcome: 'sent', statusCode: 201, error: null, retryable: false }
  } catch (error) {
    if (error instanceof WebPushError) {
      const status = error.statusCode
      if (status === 404 || status === 410) {
        return { endpoint: subscription.endpoint, outcome: 'gone', statusCode: status, error: 'suscripcion caducada', retryable: false }
      }
      const retryable = status === 429 || status >= 500
      return {
        endpoint: subscription.endpoint,
        outcome: 'failed',
        statusCode: status,
        // `error.body` trae el motivo real del servicio de push (clave VAPID mal,
        // payload demasiado grande...). Sin el, depurar esto es adivinar.
        error: error.body?.slice(0, 300) || error.message,
        retryable,
      }
    }
    const message = error instanceof Error ? error.message : String(error)
    return { endpoint: subscription.endpoint, outcome: 'failed', statusCode: null, error: message, retryable: true }
  }
}

/**
 * Envia el mismo aviso a varios navegadores del mismo usuario (movil, portatil).
 * En paralelo y sin `Promise.all` cortocircuitando: un endpoint muerto no puede
 * impedir que el aviso llegue al movil que si funciona.
 */
export async function sendPushToMany(
  subscriptions: PushSubscriptionRecord[],
  payload: PushPayload,
  options: SendOptions = {},
): Promise<PushResult[]> {
  return Promise.all(subscriptions.map((subscription) => sendPush(subscription, payload, options)))
}
