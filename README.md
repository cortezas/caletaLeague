# La Caleta League

PWA de pronosticos de LaLiga para la pena de la oficina: 12 companeros, 10 partidos por jornada,
una clasificacion y bastante pique. Interfaz enteramente en espanol.

Stack: Next.js 16.2.12 (App Router, Turbopack), React 19.2.4, Tailwind v4 (CSS-first), TypeScript,
Supabase (Postgres + Auth por magic link + RLS).

---

## Requisitos

- **Node.js >= 20.9.0** (fijado en `engines`; con Node 18 el build falla).
- npm.
- Opcional, solo para el backend real: un proyecto de Supabase y la Supabase CLI.

## Como levantarlo

```bash
npm install
npm run dev          # http://localhost:3000
```

La app **arranca y es navegable sin Supabase**. Mientras no existan las variables de entorno,
la capa de datos (`src/lib/data/`) sirve los datos de `src/lib/seed.ts` y `src/lib/supabase/proxy.ts`
deja pasar todas las rutas sin redirigir a `/login`.

| Script | Que hace |
|---|---|
| `npm run dev` | Servidor de desarrollo. Escribe en `.next/dev`. |
| `npm run build` | Build de produccion. Turbopack es el compilador por defecto: **no anadas `--turbopack`**. |
| `npm start` | Sirve el build de produccion. |
| `npm run lint` | ESLint 9 con flat config. **No es `next lint`**, que ya no existe. |
| `npx tsc --noEmit` | Comprobacion de tipos aislada. |

### Probar la instalacion como PWA en un iPhone

`env(safe-area-inset-*)` y "Anadir a pantalla de inicio" solo funcionan sobre HTTPS:

```bash
npx next dev --experimental-https
```

Abre la URL de red en Safari, Compartir > Anadir a pantalla de inicio. Debe arrancar en standalone,
con la barra de estado fundida en `#0B0F14`, sin que la tab bar quede bajo el home indicator.

---

## Variables de entorno

Copia la plantilla y rellena los dos valores:

```bash
cp .env.example .env.local
```

| Variable | De donde sale |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Dashboard > Project Settings > Data API > Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Dashboard > Project Settings > API Keys > Publishable key |

Las dos son **publicas por diseno**: viajan al navegador. La frontera de seguridad real es RLS.
Nunca pongas aqui la `service_role` / secret key.

`.env.local` no se commitea. `.env.example` **si** (de ahi la excepcion `!.env.example` en `.gitignore`).

### Configuracion manual en el dashboard de Supabase

Estos tres pasos no los puede hacer ningun script y sin ellos el login no funciona:

1. **Authentication > URL Configuration**
   - Site URL: `http://localhost:3000` en local, el dominio real en produccion.
   - Redirect URLs: anade `http://localhost:3000/**` y `https://<dominio>/**`.

2. **Authentication > Emails > Magic Link** — cambia el enlace de la plantilla por este, tal cual:

   ```
   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}
   ```

   La plantilla por defecto usa `{{ .ConfirmationURL }}`, que dispara el flujo PKCE con `code`.
   Ese flujo **no funciona aqui** (decision D10): el `code_verifier` se queda en el navegador que
   pidio el enlace, y en movil el correo se abre en otro navegador. Con `token_hash` + `verifyOtp`
   el enlace es autosuficiente. Si no cambias la plantilla, `/auth/confirm` respondera siempre
   `reason=invalid`.

3. **Authentication > Providers > Email** — `Enable Email provider: ON`, `Confirm email: ON`.

---

## Migraciones

Viven en `supabase/migrations/` y se aplican **en orden**:

| Fichero | Contenido |
|---|---|
| `0001_schema.sql` | Tablas `leagues`, `members`, `gameweeks`, `matches`, `predictions` + indices y constraints |
| `0002_private.sql` | Esquema `private` + funciones `SECURITY DEFINER` + grants |
| `0003_rls.sql` | `enable row level security` + politicas de las 5 tablas |
| `0004_scoring.sql` | `calc_points()` `IMMUTABLE` + vistas `prediction_points` y `standings` con `security_invoker = true` |
| `0005_rpc.sql` | `join_league()` + trigger que congela `members.league_id` y `members.user_id` |
| `supabase/seed.sql` | Liga La Caleta, 12 miembros y la jornada 24 con sus 10 partidos |

Con la CLI enlazada al proyecto:

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push                          # aplica las 5 migraciones
npx supabase db execute -f supabase/seed.sql  # datos de arranque
```

Alternativa sin CLI: pega el contenido de cada fichero, en orden, en el SQL Editor del dashboard.

Nunca uses `create materialized view` para la clasificacion: las matviews no soportan RLS y
expondrian los puntos de todas las ligas (decision D14).

---

## Estructura

```
src/
  app/            Rutas. Un unico root layout con <html>/<body>; (auth), (tabs) y (stack) son grupos
  components/ui/  Primitivas compartidas. Se importan siempre desde '@/components/ui'
  features/       Componentes de pantalla, agrupados por dominio
  lib/
    data/         UNICA fuente de datos para las pantallas. Las pantallas no importan seed.ts
    supabase/     Clientes de navegador, de servidor y de proxy
  proxy.ts        Refresco de sesion. En Next 16 el fichero se llama proxy, NO middleware
supabase/         Migraciones SQL y seed
docs/PLAN.md      Arquitectura y decisiones cerradas D1..D20
```

Convenciones que no son negociables (detalle en `docs/PLAN.md`):

- `params` es una `Promise` y se resuelve con `await`. `cookies()` es asincrona.
- Invalidacion de cache solo con `revalidatePath()`.
- Nada de `middleware.ts`, `typedRoutes`, `"use cache"`, `revalidateTag` ni la clave `experimental`.
- En servidor solo `supabase.auth.getClaims()`, jamas `getSession()`.
- Todo formateo de fecha usa `Intl` con `es-ES` y `Europe/Madrid` fijados.
- Sin escudos ni logos de clubes: circulo de color + sigla de 3 letras.
