/**
 * Claves VAPID: la identidad con la que esta app firma sus avisos.
 *
 * VAPID (RFC 8292) es lo que permite que Google, Apple o Mozilla acepten un
 * push nuestro sin que tengamos cuenta con ellos: firmamos cada envio con la
 * clave privada y el navegador ya conoce la publica porque se la dimos al
 * suscribirse. Si las claves cambian, TODAS las suscripciones existentes se
 * quedan muertas y hay que volver a suscribir a la pena entera.
 *
 * Solo servidor. Ninguna de estas variables lleva prefijo NEXT_PUBLIC_:
 *   - la privada porque con ella cualquiera manda notificaciones en tu nombre
 *   - la publica porque NO hace falta inlinearla en el bundle: la sirve
 *     `GET /api/push/subscribe`, que ya exige sesion
 *
 * Como generarlas: `npx web-push generate-vapid-keys` (ver docs/AVISOS.md).
 *
 * Este modulo usa `Buffer`, asi que solo compila en servidor. No se importa
 * desde ningun Client Component: `notifications-toggle.tsx` recibe la clave
 * publica por fetch, no por import. (No se pone `import 'server-only'` porque
 * ese paquete no esta instalado en el proyecto y anadirlo no es de este lote.)
 */

export interface PushConfig {
  /** `mailto:` o `https://` de contacto. Lo usa el servicio de push si algo va mal. */
  subject: string
  /** Clave publica P-256 sin comprimir, base64url. 65 bytes. */
  publicKey: string
  /** Escalar privado P-256, base64url. 32 bytes. */
  privateKey: string
}

export type PushConfigResult =
  | { ok: true; config: PushConfig }
  | { ok: false; reason: string }

/**
 * Las claves VAPID son puntos y escalares de la curva P-256 en base64url, con
 * longitudes fijas. Comprobarlas aqui convierte el error mas comun (pegar la
 * privada donde va la publica, o copiar la clave con un salto de linea) en un
 * mensaje legible en /ajustes, en vez de un 500 del servicio de push tres dias
 * despues, cuando ya nadie recuerda haber tocado el .env.
 */
function decodedLength(value: string): number | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    return Buffer.from(value, 'base64url').length
  } catch {
    return null
  }
}

function readPushConfig(): PushConfigResult {
  const subject = process.env.VAPID_SUBJECT?.trim()
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim()

  const missing = [
    !publicKey && 'VAPID_PUBLIC_KEY',
    !privateKey && 'VAPID_PRIVATE_KEY',
    !subject && 'VAPID_SUBJECT',
  ].filter(Boolean) as string[]

  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Faltan ${missing.join(', ')}. Genera las claves con "npx web-push generate-vapid-keys" y anadelas a .env.local (ver docs/AVISOS.md).`,
    }
  }
  // El filtro de arriba ya garantiza que los tres son string no vacios.
  if (!subject || !publicKey || !privateKey) return { ok: false, reason: 'configuracion incompleta' }

  if (!subject.startsWith('mailto:') && !subject.startsWith('https://')) {
    return {
      ok: false,
      reason: 'VAPID_SUBJECT tiene que empezar por "mailto:" o "https://". Es el contacto al que escribe el servicio de push si tus envios dan problemas.',
    }
  }
  if (decodedLength(publicKey) !== 65) {
    return {
      ok: false,
      reason: 'VAPID_PUBLIC_KEY no es una clave publica P-256 valida (deben ser 65 bytes en base64url, 87 caracteres). Revisa que no se haya colado un salto de linea ni la clave privada.',
    }
  }
  if (decodedLength(privateKey) !== 32) {
    return {
      ok: false,
      reason: 'VAPID_PRIVATE_KEY no es una clave privada P-256 valida (deben ser 32 bytes en base64url, 43 caracteres).',
    }
  }

  return { ok: true, config: { subject, publicKey, privateKey } }
}

/**
 * Se evalua una vez al cargar el modulo: las variables de entorno no cambian en
 * caliente y asi el interruptor de /ajustes y las tres rutas comparten
 * exactamente el mismo veredicto.
 */
const result = readPushConfig()

/** `false` -> el interruptor sale deshabilitado y las rutas devuelven 503. Nunca a medias. */
export const isPushConfigured = result.ok

/** Explicacion en castellano de por que no esta configurado. `null` si lo esta. */
export const pushConfigError = result.ok ? null : result.reason

/** La clave publica, para dársela al navegador. `null` si no hay configuracion valida. */
export const vapidPublicKey = result.ok ? result.config.publicKey : null

/** Para el envio. Lanza si no esta configurado; las rutas comprueban `isPushConfigured` antes. */
export function requirePushConfig(): PushConfig {
  if (!result.ok) throw new Error(result.reason)
  return result.config
}
