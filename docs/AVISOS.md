# Avisos antes del cierre (Web Push)

Como se avisa a quien no ha pronosticado un partido que empieza dentro de una
hora: como se generan las claves, como se programa el cron, y - sobre todo -
**donde NO llegan los avisos**, que es la parte que hay que leer entera antes de
prometerle nada a la peña.

Hasta este lote, la fila "Avisos antes del cierre · 1 hora antes" de `/ajustes`
era texto muerto: no habia nada detras. Ahora si lo hay.

Piezas:

```
supabase/migrations/0009_push.sql              push_subscriptions, push_reminders_sent, push_reminder_targets()
public/sw.js                                   service worker: SOLO push y notificationclick, cero cache
src/lib/push/vapid.ts                          claves VAPID desde entorno + validacion
src/lib/push/send.ts                           envio con la libreria web-push
src/app/api/push/subscribe/route.ts            GET clave publica / POST alta de suscripcion
src/app/api/push/unsubscribe/route.ts          POST baja
src/app/api/push/dispatch/route.ts             POST del cron, protegido con CRON_SECRET
src/features/settings/notifications-toggle.tsx interruptor de /ajustes
```

---

## 1. Donde llegan los avisos y donde no (leelo primero)

| Plataforma | Llegan | Condicion |
|---|---|---|
| Android / Chrome | SI | permiso concedido |
| Windows / macOS, Chrome, Edge, Firefox | SI | permiso concedido |
| **iPhone y iPad** | **SOLO instalada** | **iOS/iPadOS 16.4+ Y la app añadida a la pantalla de inicio** |
| iPhone/iPad en Safari normal | **NO** | `window.PushManager` ni siquiera existe |
| Cualquiera sin HTTPS | NO | salvo `localhost`, que cuenta como contexto seguro |

### 1.1 iOS: la letra pequeña que se lleva por delante media peña

Apple soporta Web Push desde iOS 16.4 (marzo de 2023), pero **solo desde una
"Home Screen Web App"**. Traducido: si el compañero abre la app en Safari y le
da al interruptor, no pasa nada. Tiene que hacer **Compartir → Añadir a pantalla
de inicio** y abrirla **desde ese icono**.

Consecuencias practicas, todas ya contempladas en el codigo:

- `notifications-toggle.tsx` detecta iPhone/iPad sin instalar y lo dice con esas
  palabras, en vez de soltar un "tu navegador no lo admite" que mandaria a la
  gente a pensar que su movil esta roto.
- **Al desinstalar la app de la pantalla de inicio, iOS borra la suscripcion**.
  El endpoint se queda muerto y el envio devuelve 410; el cron borra la fila
  solo. Quien reinstale tiene que volver a darle al interruptor.
- El permiso en iOS **solo se puede pedir dentro de un gesto del usuario**. Por
  eso `Notification.requestPermission()` es la primera linea del `onClick`, sin
  ningun `await` antes: cualquier cosa en medio rompe la cadena del gesto y el
  dialogo no aparece nunca.
- iOS no tiene "badge" ni acciones en la notificacion. Se usa titulo, cuerpo e
  icono y punto.

### 1.2 HTTPS

Sin contexto seguro no hay service worker, y sin service worker no hay push.
`localhost` cuenta como seguro, asi que **en local se puede probar todo el
circuito**, pero:

> **Esto NO se puede dar por verificado hasta desplegar en HTTPS con un dominio
> real.** En local se ha comprobado la base de datos, las politicas, el cifrado
> del payload y la firma VAPID; lo que no se ha comprobado es la entrega real de
> un aviso a un movil, porque hace falta un endpoint de FCM/APNs de verdad.

Para probar en local por HTTPS con el movil en la misma red:

```bash
npx next dev --experimental-https
```

---

## 2. Generar las claves VAPID

VAPID (RFC 8292) es la identidad con la que esta app firma sus envios. Es lo que
permite mandar notificaciones a traves de Google, Apple o Mozilla sin tener
cuenta con ellos.

```bash
npx web-push generate-vapid-keys
```

Sale algo asi:

```
Public Key:
<87 caracteres base64url: TU CLAVE PUBLICA>
Private Key:
<43 caracteres base64url: TU CLAVE PRIVADA, NUNCA LA COMMITEES>
```

Al `.env.local` (y a las variables del hosting):

```ini
VAPID_PUBLIC_KEY=<87 caracteres base64url: TU CLAVE PUBLICA>
VAPID_PRIVATE_KEY=<43 caracteres base64url: TU CLAVE PRIVADA, NUNCA LA COMMITEES>
VAPID_SUBJECT=mailto:organizador@lacaleta.example
```

Comprobaciones que hace `src/lib/push/vapid.ts` al arrancar, para que el error
salga en `/ajustes` y no tres dias despues en un 500 del servicio de push:

| Variable | Formato exigido | Verificado |
|---|---|---|
| `VAPID_PUBLIC_KEY` | base64url, **87 caracteres / 65 bytes** | si |
| `VAPID_PRIVATE_KEY` | base64url, **43 caracteres / 32 bytes** | si |
| `VAPID_SUBJECT` | empieza por `mailto:` o `https://` | si |

Esas longitudes no son inventadas: son las que devuelve
`webpush.generateVAPIDKeys()`, comprobado en este proyecto. El fallo mas comun
es pegar la privada en el hueco de la publica; con esta validacion el interruptor
dice exactamente eso.

> **Cambiar las claves invalida TODAS las suscripciones existentes.** La peña
> entera tendria que volver a activar el interruptor. Guardalas donde no se
> pierdan.

### 2.1 Si faltan las claves

No se degrada a medias, que es la unica forma de que esto no acabe en "creia que
lo tenia activado":

- el interruptor de `/ajustes` sale **deshabilitado** con el motivo escrito
- `GET`/`POST /api/push/subscribe` y `POST /api/push/dispatch` responden **503**
  con el mismo motivo
- el resto de la app funciona igual

---

## 3. Como se dispara el cron

```
POST /api/push/dispatch
X-Cron-Secret: <CRON_SECRET>
```

O `Authorization: Bearer <CRON_SECRET>`, que es lo que manda Vercel Cron. Es el
**mismo** `CRON_SECRET` que ya usa `/api/sync`: un secreto, dos rutas de cron.

| Parametro | Efecto |
|---|---|
| `minutes=60` | horizonte de aviso en minutos (1..1440). Por defecto 60 |
| `dryRun=1` | calcula a quien se avisaria y **no manda nada ni registra acuse** |

| Codigo | Cuando |
|---|---|
| `200` | informe en el cuerpo |
| `400` | `minutes` fuera de 1..1440 |
| `401` | secreto ausente o incorrecto |
| `405` | se ha entrado por `GET` |
| `503` | falta `CRON_SECRET`, faltan claves VAPID, o falta la service role key |
| `500` | fallo de Supabase |

Ejemplo manual:

```bash
curl -X POST 'http://localhost:3000/api/push/dispatch?dryRun=1' -H "X-Cron-Secret: $CRON_SECRET"
curl -X POST 'https://<dominio>/api/push/dispatch' -H "X-Cron-Secret: $CRON_SECRET"
```

Informe que devuelve:

```json
{
  "ok": true, "minutes": 60, "dryRun": false,
  "targets": 4,          // pares (partido, miembro) sin pronostico en el horizonte
  "claimed": 2,          // los que esta pasada ha reclamado; el resto ya estaban avisados
  "membersNotified": 1,
  "notificationsSent": 2,
  "subscriptionsRemoved": 0,
  "failures": []
}
```

### 3.1 Cadencia recomendada

**Cada 15 minutos durante las franjas de partido.** El horizonte es de 60
minutos, asi que con 15 de cadencia el aviso llega entre 45 y 60 minutos antes
del cierre. Cadencias mas lentas se acercan peligrosamente al pitido inicial.

```json
{
  "crons": [
    { "path": "/api/push/dispatch", "schedule": "*/15 10-23 * * *" }
  ]
}
```

No hace falta afinar mas los dias: si no hay partidos en la proxima hora, la
pasada devuelve `targets: 0` sin tocar nada ni mandar nada.

### 3.2 Por que no se manda el mismo aviso cuatro veces

Porque el acuse esta en la base, no en un temporizador de JavaScript.
`public.push_reminders_sent` tiene clave primaria `(match_id, member_id)`, y el
cron hace:

```sql
insert into push_reminders_sent (match_id, member_id)
values (...) on conflict do nothing
returning match_id, member_id
```

**Solo se avisa por las filas que el INSERT ha conseguido crear.** Si dos
pasadas se solapan, o el hosting dispara el cron dos veces, la segunda inserta
cero filas y no manda nada. Comprobado contra la base local: primera llamada
devuelve 2 filas, segunda con el mismo cuerpo devuelve `[]`, y una tercera con
un par nuevo devuelve solo el nuevo.

Excepcion deliberada: si **ningun** envio de ese miembro llega y el fallo era
transitorio (red caida, 429, 5xx), el acuse se **suelta** para que la siguiente
pasada reintente. Si el fallo no era transitorio (400, 403: configuracion mal),
el acuse se mantiene, porque reintentar cada 15 minutos hasta el partido no
arregla nada.

---

## 4. Que dice el aviso

Un unico aviso por persona y pasada, agrupando todos sus partidos pendientes.
No un aviso por partido: con diez partidos en una tarde eso seria diez
notificaciones y el interruptor apagado esa misma noche.

| Caso | Titulo | Cuerpo | Lleva a |
|---|---|---|---|
| 1 partido | `Sevilla–Rayo cierra a las 19:30` | `Jornada 1 · aún no has pronosticado.` | `/jornada/<matchId>` |
| N partidos | `Te faltan 3 pronósticos` | `Jornada 1 · el primero cierra a las 19:30 (Sevilla–Rayo).` | `/jornada` |

Detalles que no son cosmeticos:

- **Hora en `Europe/Madrid` fija** (D17), igual que en toda la interfaz.
- Si algun partido tiene `kickoff_provisional = true`, el cuerpo añade
  `Hora provisional.`. Avisar de un cierre a una hora que LaLiga aun no ha
  confirmado sin decirlo seria peor que no avisar.
- Si los partidos pendientes son de **dos jornadas distintas** (pasa en el salto
  de jornada), no se nombra ninguna. Poner una sola seria mentir.
- `tag: 'cierre-jornada'` en el navegador y `Topic: cierre-jornada` en el
  servicio de push: los avisos se sustituyen entre si en vez de apilarse.
- TTL = segundos que faltan para el pitido inicial. Si el movil esta apagado
  hasta mañana, el servicio de push tira el mensaje en vez de entregarlo tarde.
- `Urgency: high`, para despertar el movil en modo ahorro. Va como **opcion** de
  `web-push`, no como cabecera: la libreria escribe `headers.Urgency` la ultima
  con su propio valor y pasarlo en `headers` se pierde en silencio (comprobado:
  salia `normal`).

---

## 5. El service worker

`public/sw.js`. Fichero estatico, escrito a mano, **no pasa por el bundler**.

- **NADA de Serwist ni de plugins de PWA.** Inyectan configuracion de webpack y
  el build por defecto de Next 16 es Turbopack: lo romperia. Esto revierte D15
  del plan ("sin service worker en v1") solo para notificaciones.
- **NO cachea nada. No hay escuchador `fetch`.** El dato central de esta app es
  "que hora es y si ya ha empezado el partido": servir una jornada cacheada
  seria enseñar un cierre que ya paso. Ademas, sin escuchador `fetch` los
  navegadores modernos ni arrancan el worker al navegar, asi que no cuesta nada.
- Dos escuchadores y para de contar: `push` y `notificationclick`.
- El payload que llega esta **cifrado extremo a extremo** con las claves del
  navegador: ni Google ni Apple pueden leer lo que pone. Comprobado que el texto
  en claro no aparece en el cuerpo de la peticion.
- Un payload roto **no se descarta en silencio**: se enseña un aviso generico.
  En Chrome, un push que no acaba en notificacion visible acaba revocando el
  permiso.
- La `url` del payload solo se acepta si empieza por `/`. Un payload manipulado
  no puede convertir la notificacion en un enlace a otro dominio.

---

## 6. Seguridad y privacidad

| Riesgo | Como se corta |
|---|---|
| Alguien registra una suscripcion a nombre de otro | RLS: `push_subscriptions_insert_own`. Comprobado: un usuario sin ficha recibe `new row violates row-level security policy` |
| Alguien lee los endpoints de la peña | RLS + grants. Comprobado: `anon` recibe 401 `permission denied for table push_subscriptions`; un usuario ajeno ve 0 filas |
| Alguien llama al listado de destinatarios | `push_reminder_targets()` tiene el execute **revocado** a `anon` y `authenticated`. Comprobado: 401 `permission denied for function` |
| Alguien dispara el cron | `CRON_SECRET` con comparacion en tiempo constante. Sin secreto configurado, 503; la ruta nunca queda abierta |
| Un `GET` de un prefetch manda avisos | `GET /api/push/dispatch` responde 405 |
| Alguien borra la suscripcion de otro | RLS: el DELETE por endpoint ajeno afecta a 0 filas. Comprobado |

**Por que el dispatch usa la service role key.** Saber "quien NO ha
pronosticado" es exactamente la informacion que 0003 oculta a proposito: nadie
ve el pronostico de otro antes del pitido inicial. El cron no tiene sesion y no
puede tenerla. Es la misma excepcion ya documentada para la ingesta: **codigo de
cron, nunca codigo de usuario**. Las tres rutas que si llama una persona
(`subscribe` GET y POST, `unsubscribe`) usan el cliente de sesion y pasan por RLS.

`0009_push.sql` concede sus propios grants (`authenticated` sobre
`push_subscriptions`, `service_role` sobre `push_reminders_sent`) porque los
privilegios por defecto de Supabase sobre las tablas nuevas de `public` dan
`TRUNCATE/REFERENCES/TRIGGER/MAINTAIN` y nada mas, y el
`grant ... on all tables` de 0003 solo alcanzo a las tablas que existian
entonces. Por eso **este lote no depende del arreglo de grants pendiente que
documenta `docs/INGESTA.md` §5.1**.

---

## 7. Lo que hace falta y no existe todavia

### 7.1 El proxy bloquea el cron (BLOQUEANTE)

`src/lib/supabase/proxy.ts` redirige a `/login` todo lo que no este en
`isPublicPath()`, y ahi solo esta `/api/sync`. **El cron no tiene cookies de
sesion, asi que `POST /api/push/dispatch` recibe un 307 a `/login` y no se
ejecuta nunca** - y el servicio de cron ve un 200 (el HTML del login) y da la
pasada por buena. Es exactamente el mismo fallo que ya se documento para
`/api/sync`.

Comprobado que el matcher de `src/proxy.ts` deja pasar `/api/push/dispatch` y
`/sw.js` por el proxy. Arreglo (fichero fuera de este lote):

```ts
// src/lib/supabase/proxy.ts, dentro de isPublicPath()
pathname === '/api/push/dispatch' ||
```

Es seguro dejarla pasar: la ruta se protege sola con `CRON_SECRET` y responde
503 si no existe.

`/api/push/subscribe` y `/api/push/unsubscribe` **no** hay que añadirlas: las
llama el navegador con sesion, y si no la hay, que redirija a `/login` es lo
correcto.

### 7.2 El proxy tambien intercepta `/sw.js`

Con sesion no pasa nada: el proxy refresca y el estatico se sirve. Sin sesion,
la peticion se convierte en un 307 a `/login` y la **actualizacion** del service
worker falla (se queda con la version anterior, que para un worker de
notificaciones es inocuo, pero es ruido dificil de depurar). Arreglo, en el
matcher de `src/proxy.ts`, fuera de este lote:

```
'/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icon|apple-icon|...
```

### 7.3 Enganchar el interruptor en `/ajustes` (BLOQUEANTE)

`src/app/(tabs)/ajustes/page.tsx` **no es de este lote** y sigue pintando la
fila muerta. El cambio es de dos lineas: sustituir

```tsx
<SettingsRow label="Avisos antes del cierre" value="1 hora antes" valueTone="accent2" />
```

por

```tsx
<NotificationsToggle />
```

con `import { NotificationsToggle } from '@/features/settings/notifications-toggle'`.
El componente es autosuficiente: no recibe props, consulta el estado el solo y
se renderiza con el relleno de una fila de `SettingsGroup`.

### 7.4 Limpieza de acuses viejos

`push_reminders_sent` crece una fila por (partido, persona) avisada: con 12
personas y 380 partidos, el techo son 4560 filas por temporada. No merece un
cron de limpieza; el `on delete cascade` sobre `matches` y `members` ya la vacia
cuando toca.

---

## 8. Como probar en local sin despertar a nadie

```bash
# 1. A quien se avisaria ahora mismo, sin mandar nada
curl -X POST 'http://localhost:3000/api/push/dispatch?dryRun=1' -H "X-Cron-Secret: $CRON_SECRET"

# 2. Destinatarios directamente en SQL, sin pasar por la app
docker exec -i supabase_db_la-caleta-league psql -U postgres -d postgres \
  -c "select * from public.push_reminder_targets(60);"

# 3. Forzar un escenario: adelantar un partido a dentro de 30 minutos
docker exec -i supabase_db_la-caleta-league psql -U postgres -d postgres \
  -c "update public.matches set kickoff_at = now() + interval '30 minutes' where id='<uuid>';"
```

**Apunta el `kickoff_at` original antes de tocarlo y restauralo despues.** Es
dato real de calendario, no de prueba.

Para ver la notificacion de verdad hace falta un navegador con la app abierta,
el interruptor activado y las claves VAPID puestas. El buzon de correo local
(`http://127.0.0.1:54324`) no interviene aqui: eso es para los enlaces magicos.
