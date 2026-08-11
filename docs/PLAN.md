# Plan de implementacion - La Caleta League (Next.js 16.2.12 / React 19.2.4 / Tailwind v4 / Supabase)

Estado verificado del repo en `E:/ProyectosAudinDev/la-caleta-league`: existen `src/app/{layout.tsx,page.tsx,globals.css,favicon.ico}`, `src/lib/{types.ts,scoring.ts,seed.ts}`, `next.config.ts` vacio, `postcss.config.mjs` correcto para v4, `package.json` con `dev: next dev` (sin `--turbopack`) y `lint: eslint` (ya migrado), `lucide-react ^1.28.0` instalado. NO existe Supabase, NI proxy, NI rutas mas alla de `/`.

---

## 0. Decisiones tecnicas cerradas (no son opciones)

| # | Decision | Justificacion en una linea |
|---|---|---|
| D1 | **Tema oscuro por defecto con `data-theme` en `<html>` + script inline sincrono en `<head>` via `dangerouslySetInnerHTML` + `suppressHydrationWarning` en `<html>`** | Es el unico patron que corre durante el parseo del HTML, antes del primer paint; `useEffect`/`useLayoutEffect` garantizan flash. |
| D2 | **Los params dinamicos se tipan a mano: `{ params }: { params: Promise<{ matchId: string }> }` con `await`. NO se usan los helpers `PageProps<'/...'>`** | Los helpers dependen de `next typegen`; con varios agentes en paralelo un artefacto generado es un punto de fallo evitable, y el tipo inline es igual de estricto. |
| D3 | **`typedRoutes` NO se activa** | Obligaria a `as Route` en todos los hrefs con template literal (`/jornada/${id}`) y bloquearia a los agentes con tipos generados. |
| D4 | **`cacheComponents` NO se activa** | Sin el, `loading.tsx` funciona como marcador clasico de prefetch, que es lo que necesitamos; con el cambia la semantica de PPR y de `"use cache"` sin aportar nada a una liga en vivo. |
| D5 | **Invalidacion de cache: solo `revalidatePath()`. Prohibido `revalidateTag`, `updateTag`, `cacheTag`, `cacheLife`, `"use cache"`** | Sin `cacheComponents` los tags no aportan, y `revalidateTag` de un solo argumento es error de TypeScript en 16. |
| D6 | **El draft de pronostico vive en un `useReducer` dentro de `PredictionForm` (Client Component), sembrado por props desde el Server Component, y se persiste solo al enviar con una Server Action + `useActionState`** | El draft es de una sola pantalla; contexto global, store o localStorage serian complejidad sin usuario. |
| D7 | **Todos los `page.tsx` y `layout.tsx` son Server Components async. Client Components SOLO: TabBar, ThemeToggle, Toast, Countdown, Segmented, Stepper, PredictionForm+hijos, CodeKeypad, LoginForm, OnboardingFlow, StandingsAccordion, AdminResultForm, AdminScoringForm, DebugStateChips, ErrorBoundaries** | Minimiza el JS enviado y mantiene `export const metadata`/`viewport` legales en los layouts. |
| D8 | **El shell no anida scrollers: scroll del documento, `TabBar` `fixed bottom-0`, cabeceras `sticky top-0`, barra de accion del predict `fixed bottom-0`** | El prototipo usaba un scroller interno por el marco de iPhone simulado; en PWA real el scroll del documento da el rebote y el ocultado de barras nativos. |
| D9 | **Las cabeceras de pantalla las renderiza cada `page.tsx` con `<ScreenHeader>`, NO el layout de grupo** | Los layouts no re-renderizan en navegacion y cada pantalla tiene titulo, subtitulo y accion distintos. |
| D10 | **Auth por magic link con `token_hash` + `verifyOtp` en `app/auth/confirm/route.ts`. NO `exchangeCodeForSession`** | Con PKCE el `code_verifier` vive en el navegador emisor; en movil el correo se abre en otro navegador y `exchangeCodeForSession` falla. |
| D11 | **El envio del magic link se hace desde el navegador (`createBrowserClient.signInWithOtp`), no desde una Server Action** | La cookie PKCE tiene que quedarse en el navegador que inicia el flujo. |
| D12 | **`src/proxy.ts` (funcion `proxy`), runtime nodejs. NO existe `middleware.ts` en este proyecto** | En Next 16 `middleware` esta deprecado y renombrado; el runtime edge no es configurable en `proxy`. |
| D13 | **El proxy solo refresca sesion y redirige a `/login`. La autorizacion real es RLS + un `requireMember()` al principio de cada page protegida** | Las Server Functions son POST a la ruta donde se usan y pueden quedar fuera del matcher en silencio. |
| D14 | **La clasificacion y los puntos se calculan con funcion SQL `IMMUTABLE` + VISTAS con `security_invoker = true`. NUNCA vista materializada** | Las matviews no soportan RLS y expondrian la clasificacion de todas las ligas. |
| D15 | **Sin service worker en v1** | La instalabilidad solo exige manifest valido + HTTPS; Serwist obliga a configuracion webpack y romperia el build por defecto de Turbopack. |
| D16 | **Iconos con `lucide-react` (ya instalado). Solo SVG inline cuando el trazo del prototipo no exista en lucide** | Evita 40 componentes SVG a mano y respeta `size`/`strokeWidth` del prototipo. |
| D17 | **Todo formateo de fecha/hora usa `Intl` con `locale: 'es-ES'` y `timeZone: 'Europe/Madrid'` fijados** | Sin timezone fija, servidor y cliente producen strings distintos y React lanza mismatch de hidratacion. |
| D18 | **Sin `scroll-behavior: smooth` y sin `data-scroll-behavior` en `<html>`** | Una PWA tipo app quiere salto instantaneo entre pantallas. |
| D19 | **Se corrigen 5 bugs del prototipo, no se portan: (a) `noGoals` es flag explicito y no se activa por `scorers.length===0`; (b) el total de partidos sale de `matches.length`, no del literal 10; (c) `chartMax = Math.max(...)` y `best` = indice del maximo, no `v===23`; (d) el deadline sale del `kickoff_at` del primer partido `open`; (e) `initials()` es una sola implementacion, la que hace `.replace(/\./g,'')`** | Son datos cableados del prototipo que con datos reales rompen la UI. |
| D20 | **`prefers-reduced-motion: reduce` desactiva `shim`, `pulse`, `pop` y `slidein`. Se anaden `:focus-visible` y `active:scale-[.97]`, ausentes en el prototipo** | El prototipo no tiene ninguna media query ni estado de foco; es deuda de accesibilidad que se paga ahora. |

---

## 1. Arbol de ficheros completo del proyecto final

```
la-caleta-league/
├─ .env.example                       Plantilla: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
├─ .env.local                         Valores reales (NO commitear; ya cubierto por .gitignore)
├─ next.config.ts                     Solo images.remotePatterns del bucket Supabase. Sin webpack, sin experimental, sin typedRoutes
├─ postcss.config.mjs                 SIN CAMBIOS: { plugins: { '@tailwindcss/postcss': {} } }
├─ eslint.config.mjs                  SIN CAMBIOS
├─ tsconfig.json                      SIN CAMBIOS (ya incluye .next/types y .next/dev/types)
├─ package.json                       Anadir deps @supabase/supabase-js y @supabase/ssr. Scripts intactos (sin --turbopack, sin next lint)
├─ AGENTS.md                          SIN CAMBIOS
├─ README.md                          Reescrito: como levantar, variables de entorno, como aplicar migraciones
├─ public/
│  ├─ icons/icon-192.png              Icono PWA 192x192 fondo #0B0F14
│  ├─ icons/icon-512.png              Icono PWA 512x512 fondo #0B0F14
│  └─ icons/maskable-512.png          Icono PWA 512x512 purpose=maskable (safe zone 80%)
│                                     BORRAR: file.svg, globe.svg, next.svg, vercel.svg, window.svg
├─ supabase/
│  ├─ migrations/0001_schema.sql      Tablas leagues, members, gameweeks, matches, predictions + indices + constraints
│  ├─ migrations/0002_private.sql     Esquema private + 7 funciones SECURITY DEFINER + grants
│  ├─ migrations/0003_rls.sql         enable RLS + todas las politicas de las 5 tablas
│  ├─ migrations/0004_scoring.sql     calc_points() IMMUTABLE + vistas prediction_points y standings (security_invoker)
│  ├─ migrations/0005_rpc.sql         join_league() + trigger BEFORE UPDATE que congela members.league_id y members.user_id
│  └─ seed.sql                        Liga La Caleta, 12 miembros, jornada 24 con los 10 partidos de src/lib/seed.ts
└─ src/
   ├─ proxy.ts                        export async function proxy(req) -> updateSession(req) + config.matcher que excluye estaticos, manifest e iconos
   ├─ app/
   │  ├─ layout.tsx                   UNICO root layout: <html data-theme="dark" suppressHydrationWarning>, fuentes, ThemeScript, metadata, viewport, ToastProvider
   │  ├─ globals.css                  @import "tailwindcss" + tokens :root/[data-theme=light] + @theme inline + keyframes + reduced-motion + utilidades base
   │  ├─ page.tsx                     Server Component: redirect('/jornada')
   │  ├─ not-found.tsx                404 global sin props (EmptyState + Link a /jornada)
   │  ├─ global-error.tsx             'use client', con <html>/<body> propios, props { error, unstable_retry }
   │  ├─ manifest.ts                  MetadataRoute.Manifest: standalone, portrait, #0B0F14, 3 iconos
   │  ├─ icon.tsx                     ImageResponse 512x512, monograma LC sobre #0B0F14
   │  ├─ apple-icon.tsx               ImageResponse 180x180, monograma LC sobre #0B0F14 (iOS ignora los iconos del manifest)
   │  ├─ favicon.ico                  EXISTENTE, se conserva
   │  ├─ auth/
   │  │  ├─ confirm/route.ts          GET: verifyOtp({type, token_hash}) + guarda anti open-redirect + redirect(next)
   │  │  ├─ signout/route.ts          POST: signOut() + redirect('/login')
   │  │  └─ error/page.tsx            Pantalla de enlace caducado o invalido, con boton volver a /login
   │  ├─ (auth)/                      Grupo fullscreen: sin tab bar, sin layout propio (cuelga del root)
   │  │  ├─ login/page.tsx            Server Component: shell, logo, copy; renderiza <LoginForm />
   │  │  ├─ login/login-form.tsx      'use client': input email, signInWithOtp, card "Revisa tu correo" con animacion pop
   │  │  ├─ onboarding/page.tsx       Server Component: requireSession(); si ya es miembro redirect('/jornada'); renderiza <OnboardingFlow />
   │  │  ├─ onboarding/onboarding-flow.tsx  'use client': barra de 2 pasos, paso 1 codigo, paso 2 nombre+color, llama a joinLeagueAction
   │  │  └─ onboarding/code-keypad.tsx      'use client': 6 casillas + teclado de 12 teclas, avanza a los 6 chars con retardo 260ms
   │  ├─ (tabs)/                      Grupo CON tab bar
   │  │  ├─ layout.tsx                Layout anidado: <main className="pb-[calc(env(safe-area-inset-bottom)+84px)]">{children}</main> + <TabBar />
   │  │  ├─ jornada/page.tsx          Pantalla 3: cabecera J24, countdown, progreso, banner secreto, lista de 10 partidos
   │  │  ├─ jornada/loading.tsx       Skeleton [46,92,92,92,92,92] con animacion shim
   │  │  ├─ jornada/error.tsx         'use client', props { error, unstable_retry }, ErrorState
   │  │  ├─ clasificacion/page.tsx    Pantalla 6: segmentado General/Por jornada, podio, filas 4..12
   │  │  ├─ clasificacion/loading.tsx Skeleton de clasificacion
   │  │  ├─ perfil/page.tsx           Pantalla 8: identidad, 4 stats, grafica J15-J24, racha
   │  │  ├─ perfil/loading.tsx        Skeleton de perfil
   │  │  └─ ajustes/page.tsx          Pantalla 9: identidad, grupos de ajustes, selector de tema, acceso admin, chips de estado
   │  └─ (stack)/                     Grupo de pila: SIN tab bar
   │     ├─ layout.tsx                Layout anidado: <div className="flex min-h-dvh flex-col">{children}</div>. NO renderiza cabecera (D9)
   │     ├─ jornada/resumen/page.tsx  Pantalla 5: dos cifras, aviso, 10 filas numeradas, boton confirmar
   │     ├─ jornada/[matchId]/page.tsx        Pantalla 4/4b: si status==='open' -> PredictionForm; si no -> SealedCard
   │     ├─ jornada/[matchId]/loading.tsx     Skeleton del editor de pronostico
   │     ├─ jornada/[matchId]/error.tsx       'use client', props { error, unstable_retry }
   │     ├─ jornada/[matchId]/not-found.tsx   Partido inexistente o de otra liga
   │     ├─ clasificacion/jornada/[n]/page.tsx     Pantalla 7: navegador de jornada + filas con acordeon de desglose
   │     ├─ clasificacion/jornada/[n]/loading.tsx  Skeleton
   │     ├─ partido/[matchId]/page.tsx        Pantalla "pique": resultado real, 3 destacados, que puso cada uno
   │     ├─ partido/[matchId]/loading.tsx     Skeleton
   │     ├─ partido/[matchId]/not-found.tsx   Partido inexistente o aun no revelado
   │     └─ ajustes/admin/page.tsx    Pantalla 10: segmentado Resultados/Puntuacion, formularios de admin
   ├─ components/
   │  ├─ theme-script.tsx             Server Component que devuelve el <script> inline anti-flash
   │  ├─ theme-toggle.tsx             'use client': segmentado Oscuro/Claro con lazy useState initializer sobre localStorage
   │  ├─ tab-bar.tsx                  'use client': usePathname + 4 Links, fixed bottom, safe-area
   │  └─ ui/
   │     ├─ index.ts                  Barrel: reexporta todas las primitivas
   │     ├─ cn.ts                     -> re-export de @/lib/cn (para que ui sea autocontenido en imports)
   │     ├─ card.tsx                  <Card>
   │     ├─ button.tsx                <Button>
   │     ├─ chip.tsx                  <Chip>
   │     ├─ avatar.tsx                <Avatar>
   │     ├─ team-badge.tsx            <TeamBadge>
   │     ├─ scoreline.tsx             <Scoreline>
   │     ├─ segmented.tsx             'use client' <Segmented>
   │     ├─ stepper.tsx               'use client' <Stepper>
   │     ├─ player-select.tsx         'use client' <PlayerSelect>: disparador + hoja inferior con buscador, grupos por club y texto libre
   │     ├─ progress-bar.tsx          <ProgressBar>
   │     ├─ pulse-dot.tsx             <PulseDot>
   │     ├─ stat-card.tsx             <StatCard>
   │     ├─ section-label.tsx         <SectionLabel>
   │     ├─ screen-header.tsx         <ScreenHeader>
   │     ├─ text-input.tsx            <TextInput>
   │     ├─ skeleton.tsx              <Skeleton> y <SkeletonList>
   │     ├─ empty-state.tsx           <EmptyState>
   │     ├─ error-state.tsx           <ErrorState>
   │     ├─ bottom-action-bar.tsx     <BottomActionBar>
   │     ├─ countdown.tsx             'use client' <Countdown>
   │     └─ toast.tsx                 'use client': <ToastProvider>, useToast()
   ├─ features/
   │  ├─ auth/actions.ts              'use server': joinLeagueAction(FormData) -> RPC join_league + redirect('/jornada')
   │  ├─ jornada/gameweek-header.tsx  Cabecera de /jornada: eyebrow, J24, countdown, progreso, banner secreto
   │  ├─ jornada/match-row.tsx        Fila de partido (Server): 5 variantes de tail segun status. Envuelta en <Link>
   │  ├─ jornada/summary-row.tsx      Fila numerada de /jornada/resumen
   │  ├─ predict/reducer.ts           DraftState + draftReducer puro (clamp 0..9, toggles). Testeable sin React
   │  ├─ predict/prediction-form.tsx  'use client': dueno del draft, useReducer + useActionState + BottomActionBar
   │  ├─ predict/score-picker.tsx     'use client': dos columnas con Stepper 52x52 y marcadores rapidos
   │  │                              (MVP, goleadores y asistentes se eligen con `ui/player-select.tsx`)
   │  ├─ predict/sealed-card.tsx      Server: vista 4b para status !== 'open'
   │  ├─ predict/actions.ts           'use server': savePredictionAction -> upsert + revalidatePath('/jornada')
   │  ├─ standings/podium.tsx         Podio 1-2-3 con orden de render [1,0,2]
   │  ├─ standings/standings-row.tsx  Fila 4..12 con tendencia y chip TU
   │  ├─ standings/gameweek-accordion.tsx  'use client': fila de jornada + desglose desplegable
   │  ├─ pique/result-header.tsx      Cabecera de resultado real del partido
   │  ├─ pique/highlights.tsx         Carrusel horizontal de 3 destacados
   │  ├─ pique/pique-row.tsx          Fila por miembro con pildora de marcador y chips de aciertos
   │  ├─ profile/points-chart.tsx     Grafica de barras J15-J24 (max dinamico)
   │  ├─ settings/settings-group.tsx  Tarjeta con filas de ajuste
   │  ├─ settings/debug-chips.tsx     'use client': chips de estados de prueba (solo dev)
   │  ├─ admin/admin-result-form.tsx  'use client': marcador, MVP y goleadores por partido
   │  ├─ admin/admin-scoring-form.tsx 'use client': 5 steppers clamp 0..20
   │  └─ admin/actions.ts             'use server': saveMatchResultAction, saveScoringAction
   └─ lib/
      ├─ cn.ts                        cn(...classes) sin dependencias externas
      ├─ types.ts                     EXISTENTE: se amplia con Scoring.pleno ya presente y se anade LeagueSettings
      ├─ view-models.ts               NUEVO: todos los VM que devuelve la capa de datos (contrato entre datos y pantallas)
      ├─ scoring.ts                   EXISTENTE: se conserva tal cual (espejo TS de calc_points en SQL)
      ├─ seed.ts                      EXISTENTE: se le QUITA la funcion initials() (pasa a format.ts). El resto intacto
      ├─ format.ts                    initials, formatCountdown, formatKickoff, scoreLabel, pad2, plural
      ├─ auth.ts                      requireSession(), requireMember(), getOptionalMember()
      ├─ data/
      │  ├─ index.ts                  Barrel de la capa de datos. UNICO import permitido desde las pantallas
      │  ├─ gameweek.ts               getActiveGameweek, getGameweekSummary, getMatchEditor, getMatchPique
      │  ├─ standings.ts              getSeasonStandings, getGameweekStandings
      │  ├─ profile.ts                getProfile
      │  ├─ league.ts                 getLeagueSettings, getAdminMatches
      │  └─ mock.ts                   Implementacion sobre src/lib/seed.ts (fase A). Se borra al cerrar la fase C
      └─ supabase/
         ├─ client.ts                 createClient() de navegador (createBrowserClient)
         ├─ server.ts                 async createClient() con await cookies() y setAll(cookiesToSet, _headers)
         └─ proxy.ts                  updateSession(request) con getClaims() y Object.entries(headers)
```

---

## 2. Orden de construccion en capas

```
F0 Cimientos  ──►  F1 Contratos de datos  ──►  F2 Primitivas UI  ──►  F3 Pantallas (5 lotes en paralelo)  ──►  F5 QA
                                    └──►  F2b Auth y Supabase  ──────────────►  F4 Backend real  ──────────┘
```

### F0 - Cimientos (1 agente, secuencial, bloquea todo)
Prerequisito de: absolutamente todo.
1. `npm install @supabase/supabase-js @supabase/ssr` (versiones objetivo: 2.111.0 y 0.12.4).
2. Borrar los 5 SVG de `public/`. Crear `public/icons/` con los 3 PNG.
3. Reescribir `src/app/globals.css` completo (tokens + `@theme inline` + keyframes + reduced-motion). **Borrar** el bloque `@media (prefers-color-scheme: dark)` y el `body { font-family: Arial... }` de create-next-app.
4. Reescribir `src/app/layout.tsx`: Figtree + Barlow_Condensed, `ThemeScript`, `metadata`, `viewport`, `ToastProvider`.
5. Crear `src/lib/cn.ts`, `src/components/theme-script.tsx`, `src/app/manifest.ts`, `src/app/icon.tsx`, `src/app/apple-icon.tsx`, `src/app/page.tsx` (redirect), `src/app/not-found.tsx`, `src/app/global-error.tsx`.
6. Crear `src/app/(tabs)/layout.tsx`, `src/app/(stack)/layout.tsx`, `src/components/tab-bar.tsx`.
7. `next.config.ts` con `images.remotePatterns`.
8. Verificacion de cierre: `npm run build` pasa y `/` redirige a `/jornada` (que aun da 404; correcto en esta fase).

### F1 - Contratos de datos (1 agente; puede empezar en cuanto F0 punto 5 este hecho)
Prerequisito de: F2 (solo de los tipos) y de F3 (bloqueante total).
1. `src/lib/format.ts` y eliminar `initials()` de `seed.ts`.
2. `src/lib/view-models.ts` con TODOS los VM (seccion 3.2).
3. `src/lib/data/*.ts` con las firmas finales, implementadas contra `seed.ts` en `mock.ts`.
4. `src/lib/auth.ts` con `requireSession()`, `requireMember()`, `getOptionalMember()` (en fase A devuelven el miembro `isMe` del seed).
5. Verificacion de cierre: `npx tsc --noEmit` limpio y cada funcion de `data/index.ts` devuelve un VM completo con los datos del seed.

### F2 - Primitivas UI (1 agente; requiere F0 completo y `view-models.ts` de F1)
Prerequisito de: los 5 lotes de F3. **Ningun lote de F3 arranca hasta que F2 este cerrada y `src/components/ui/index.ts` exporte las 21 primitivas.**
Verificacion de cierre: existe una pagina temporal de galeria (borrar despues) que renderiza cada primitiva en sus variantes y compila.

### F2b - Auth y Supabase plumbing (1 agente, en paralelo con F2, ficheros disjuntos)
Prerequisito de: lote A de F3 y de F4.
Ficheros: `src/lib/supabase/{client,server,proxy}.ts`, `src/proxy.ts`, `src/app/auth/confirm/route.ts`, `src/app/auth/signout/route.ts`, `src/app/auth/error/page.tsx`, `.env.example`.
Verificacion de cierre: con `.env.local` relleno, entrar a `/jornada` sin sesion redirige a `/login`; los estaticos de `_next` cargan.

### F3 - Pantallas (5 lotes en paralelo, ficheros disjuntos) - seccion 4

### F4 - Backend real (1 agente, en paralelo con F3, solo toca `supabase/` y `src/lib/data/*`)
Prerequisito: F1 (firmas) y F2b (clientes).
1. Escribir las 5 migraciones y el seed SQL.
2. Aplicarlas contra el proyecto Supabase.
3. Sustituir el cuerpo de `src/lib/data/*.ts` para que consulten Supabase en vez de `mock.ts`. **Las firmas y los VM no cambian**, por eso F3 no se entera.
4. Borrar `src/lib/data/mock.ts` y las constantes de `seed.ts` que ya no use nadie.
5. Editar la plantilla de email Magic Link en el dashboard a `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}`.

### F5 - QA de cierre (1 agente, al final)
`npm run build` limpio, `npx tsc --noEmit`, `npm run lint`, prueba de instalacion en iPhone via `next dev --experimental-https`, verificacion de safe areas, verificacion de que ninguna pantalla importa `seed.ts` directamente.

---

## 3. Contratos cerrados

### 3.1 Tokens de diseno (`src/app/globals.css`)

Nombres de token CERRADOS. Los valores hex son la referencia de partida; si aparece el fichero del prototipo, se sobreescriben los valores dentro de estos mismos bloques sin tocar ningun nombre ni ninguna clase.

```css
@import "tailwindcss";

/* ---- Tema OSCURO (por defecto) ---- */
:root {
  --bg:#0B0F14; --bg2:#0E141B; --card:#141A22; --card2:#1B2430; --sunk:#0F151C;
  --line:#232C38; --line2:#2E3A48;
  --txt:#F2F5F8; --txt2:#9AA7B6; --txt3:#6B7A8C;
  --accent:#7C5CFF; --accent2:#A48BFF; --accent-soft:rgba(124,92,255,.14); --accent-ink:#FFFFFF;
  --volt:#DFFF4F; --volt-ink:#10160A;
  --ok:#3ED27E; --ok-soft:rgba(62,210,126,.14);
  --warn:#F5A524; --warn-soft:rgba(245,165,36,.14);
  --bad:#F2455F; --bad-soft:rgba(242,69,95,.14);
  --shadow:0 8px 24px rgba(0,0,0,.35);
}

/* ---- Tema CLARO: OBLIGATORIO que vaya DESPUES de :root (misma especificidad) ---- */
[data-theme="light"] {
  --bg:#FFFFFF; --bg2:#F6F8FA; --card:#FFFFFF; --card2:#F1F4F8; --sunk:#F0F3F7;
  --line:#E3E8EE; --line2:#D3DAE3;
  --txt:#0B0F14; --txt2:#5B6773; --txt3:#8A97A5;
  --accent:#6A45F5; --accent2:#5733D6; --accent-soft:rgba(106,69,245,.10); --accent-ink:#FFFFFF;
  --volt:#7A9400; --volt-ink:#FFFFFF;
  --ok:#16A34A; --ok-soft:rgba(22,163,74,.10);
  --warn:#B45309; --warn-soft:rgba(180,83,9,.10);
  --bad:#DC2626; --bad-soft:rgba(220,38,38,.10);
  --shadow:0 6px 18px rgba(11,15,20,.08);
}

@theme inline {
  --color-bg:var(--bg); --color-bg2:var(--bg2); --color-card:var(--card); --color-card2:var(--card2);
  --color-sunk:var(--sunk); --color-line:var(--line); --color-line2:var(--line2);
  --color-txt:var(--txt); --color-txt2:var(--txt2); --color-txt3:var(--txt3);
  --color-accent:var(--accent); --color-accent2:var(--accent2);
  --color-accent-soft:var(--accent-soft); --color-accent-ink:var(--accent-ink);
  --color-volt:var(--volt); --color-volt-ink:var(--volt-ink);
  --color-ok:var(--ok); --color-ok-soft:var(--ok-soft);
  --color-warn:var(--warn); --color-warn-soft:var(--warn-soft);
  --color-bad:var(--bad); --color-bad-soft:var(--bad-soft);

  /* next/font emite --font-figtree y --font-barlow-condensed. NUNCA reusar esos nombres aqui */
  --font-ui:var(--font-figtree);
  --font-num:var(--font-barlow-condensed);
}

@keyframes shim{0%{background-position:-320px 0}100%{background-position:320px 0}}
@keyframes pop{0%{transform:scale(.86);opacity:0}100%{transform:scale(1);opacity:1}}
@keyframes slidein{0%{transform:translateY(10px);opacity:0}100%{transform:translateY(0);opacity:1}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration:.01ms !important; animation-iteration-count:1 !important; transition-duration:.01ms !important; }
}

::-webkit-scrollbar { width:0; height:0 }
html { scrollbar-width:none; background:var(--bg) }
body { background:var(--bg); color:var(--txt) }
:focus-visible { outline:2px solid var(--accent); outline-offset:2px }
```

Clases utiles resultantes: `bg-card`, `bg-accent-soft`, `text-txt2`, `border-line2`, `text-volt`, `font-ui`, `font-num`.

### 3.2 View models (`src/lib/view-models.ts`) - contrato datos <-> pantallas

```ts
import type { MatchStatus, Prediction, MatchResult, TeamCode, Scoring } from './types'

export type TeamVM = { code: TeamCode; name: string; color: string; ink: string }

export type MatchRowVM = {
  id: string
  home: TeamVM
  away: TeamVM
  kickoffAt: string          // ISO 8601 UTC
  kickoffLabel: string       // 'Sáb 18:30' ya formateado en Europe/Madrid
  status: MatchStatus        // 'open' | 'locked' | 'live' | 'played'
  myPrediction: Prediction | null
  result: MatchResult | null
  myPoints: number | null    // null si el partido no esta jugado
  exactHit: boolean          // marcador propio identico al real
}

export type GameweekVM = {
  number: number
  competitionLabel: string        // 'LaLiga EA Sports'
  deadlineAt: string | null       // ISO del kickoff del primer partido 'open'; null si no queda ninguno
  deadlineLabel: string | null    // 'Cierra Sevilla–Valencia'
  matches: MatchRowVM[]
  predictedCount: number
  totalCount: number              // matches.length, NUNCA 10 literal
}

export type SummaryVM = {
  gameweekNumber: number
  rows: Array<{ index: number; matchId: string; label: string; myScore: string | null; status: MatchStatus; points: number | null }>
  predictedCount: number
  missingCount: number
  firstMissingMatchId: string | null
}

export type PredictEditorVM = {
  match: MatchRowVM
  editable: boolean                       // status === 'open'
  squads: Array<{ code: TeamCode; name: string; color: string; ink: string; players: string[] }>
  initialDraft: { home: number; away: number; mvp: string | null; scorers: string[]; noGoals: boolean }
  scoring: Scoring
}

export type PiqueVM = {
  match: MatchRowVM                       // con result garantizado no nulo
  highlights: Array<{ value: string; text: string; tone: 'ok' | 'accent' | 'neutral' }>
  rows: Array<{
    memberId: string; displayName: string; avatarColor: string; isMe: boolean
    home: number; away: number; mvp: string | null; scorers: string[]
    points: number; exact: boolean; signHit: boolean
    chips: Array<{ label: string; hit: boolean }>
  }>
  memberCount: number
}

export type StandingsVM = {
  leagueName: string
  rows: Array<{ position: number; memberId: string; displayName: string; avatarColor: string; points: number; trend: number; isMe: boolean }>
}

export type GameweekStandingsVM = {
  number: number
  hasPrev: boolean
  hasNext: boolean
  statusLabel: string                     // 'En juego · 3 de 10 partidos'
  rows: Array<{
    position: number; memberId: string; displayName: string; avatarColor: string; points: number; isMe: boolean
    breakdown: Array<{ matchId: string; label: string; myScore: string; realScore: string; points: number }>
    pendingCount: number
  }>
}

export type ProfileVM = {
  displayName: string; avatarColor: string
  position: number; memberCount: number; leagueName: string
  totalPoints: number
  stats: { totalPoints: number; exactHits: number; signAccuracy: number; bestGameweekPoints: number; bestGameweekNumber: number }
  chart: Array<{ gameweek: number; points: number }>   // el maximo se calcula en el componente
  streak: { count: number; title: string; text: string } | null
}

export type LeagueSettingsVM = { leagueName: string; inviteCode: string; memberCount: number; isAdmin: boolean; scoring: Scoring; displayName: string; avatarColor: string }

export type AdminMatchVM = { id: string; label: string; status: MatchStatus; result: MatchResult | null; missingMvp: boolean; players: string[] }
```

### 3.3 Primitivas de UI compartidas (`src/components/ui/`) - CERRADAS antes de repartir pantallas

| Componente | Fichero | Server/Client | Props | Tokens que usa |
|---|---|---|---|---|
| `Card` | `card.tsx` | Server | `{ children: ReactNode; className?: string; as?: 'div'\|'section'\|'article'; radius?: 13\|14\|15\|16\|17\|18\|19\|20\|22; elevated?: boolean }` (default `radius=18`, `elevated=false`) | `--card`, `--line`, `--shadow` |
| `Button` | `button.tsx` | Server (usable en client) | `{ variant: 'primary'\|'secondary'\|'ghost'\|'dashed'\|'danger'; size?: 'sm'\|'md'\|'lg'; fullWidth?: boolean; loading?: boolean; leading?: ReactNode; trailing?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>` (default `size='md'`). Alturas: sm 44, md 52, lg 54. `primary` lleva `box-shadow 0 8px 22px var(--accent-soft)` | `--accent`, `--accent-ink`, `--accent-soft`, `--card`, `--card2`, `--line2`, `--txt`, `--txt2`, `--bad` |
| `Chip` | `chip.tsx` | Server | `{ tone: 'volt'\|'accent'\|'neutral'\|'ok'\|'warn'\|'bad'; size?: 'xs'\|'sm'; uppercase?: boolean; children: ReactNode }` (xs = 10.5px/800/.09em, sm = 11.5px/600) | pares `--X` / `--X-soft` segun `tone`, `--card2`, `--txt2`, `--txt3` |
| `Avatar` | `avatar.tsx` | Server | `{ name: string; color: string; size: 24\|30\|32\|34\|38\|46\|52\|62\|64\|96; ring?: string; className?: string }`. Iniciales via `initials()` de `format.ts` | color pasado por prop + `#fff` de tinta, `--font-num` |
| `TeamBadge` | `team-badge.tsx` | Server | `{ team: TeamVM; size: 18\|22\|26\|34\|44\|46 }`. Muestra `team.code` sobre `team.color` con `team.ink` | `--font-num` |
| `Scoreline` | `scoreline.tsx` | Server | `{ home: number\|null; away: number\|null; size: 'xs'\|'sm'\|'md'\|'lg'\|'xl'; tone?: 'txt'\|'txt3'\|'accent2'\|'ok'\|'warn'; separator?: '–'\|'-' }` (default `separator='–'` U+2013) | `--font-num`, `--txt`, `--txt3`, `--accent2`, `--ok`, `--warn` |
| `Segmented` | `segmented.tsx` | **Client** | `{ options: Array<{ value: string; label: string }>; value: string; onValueChange: (v: string) => void; size?: 'sm'\|'md' }` (sm h38 r9, md h40 r11) | `--sunk`, `--card`, `--txt`, `--txt3` |
| `Stepper` | `stepper.tsx` | **Client** | `{ value: number; min: number; max: number; step?: number; onValueChange: (v: number) => void; size: 44\|52; label: string }` (`label` va a `aria-label`) | `--accent`, `--accent-ink`, `--card2`, `--line2`, `--txt`, `--font-num` |
| `ProgressBar` | `progress-bar.tsx` | Server | `{ value: number; max: number; tone?: 'volt'\|'accent'\|'ok'; className?: string }`. Altura 6, pista r99 | `--sunk`, `--volt`, `--accent`, `--ok` |
| `PulseDot` | `pulse-dot.tsx` | Server | `{ tone: 'warn'\|'bad'\|'ok'\|'accent'; size?: 7\|8; speed?: 1.4\|1.6 }` | `--warn`, `--bad`, `--ok`, `--accent` |
| `StatCard` | `stat-card.tsx` | Server | `{ value: string\|number; label: string; tone?: 'txt'\|'volt'\|'ok'\|'bad'; className?: string }` | `--card`, `--line`, `--font-num`, tono |
| `SectionLabel` | `section-label.tsx` | Server | `{ children: ReactNode; className?: string }`. 11px/800/.11em uppercase | `--txt3` |
| `ScreenHeader` | `screen-header.tsx` | Server | `{ title: string; subtitle?: string; size?: 'sm'\|'md'\|'lg'; backHref?: string; action?: ReactNode; children?: ReactNode }`. sm 15/800, md 16/800, lg 24/800. `sticky top-0 z-20 bg-bg border-b border-line pt-[calc(env(safe-area-inset-top)+14px)]` | `--bg`, `--line`, `--txt`, `--txt3` |
| `TextInput` | `text-input.tsx` | Server (usable en client) | `{ label?: string; hint?: string; error?: string; inputSize?: 'md'\|'lg' } & InputHTMLAttributes<HTMLInputElement>`. md h44 r13 bg-sunk, lg h54 r16 bg-card | `--sunk`, `--card`, `--line2`, `--txt`, `--txt3`, `--bad` |
| `Skeleton` | `skeleton.tsx` | Server | `Skeleton: { height: number; radius?: number; className?: string }` y `SkeletonList: { heights: number[]; className?: string }`. Animacion `shim 1.25s linear infinite` | `--card`, `--card2` |
| `EmptyState` | `empty-state.tsx` | Server | `{ icon: ReactNode; title: string; description: string; action?: ReactNode }`. Caja de icono 78x78 r26 | `--card`, `--line`, `--txt`, `--txt2`, `--txt3` |
| `ErrorState` | `error-state.tsx` | Server | `{ title: string; description: string; action?: ReactNode }`. Caja de icono 78x78 r26 en `bad-soft` | `--bad`, `--bad-soft`, `--txt`, `--txt2` |
| `BottomActionBar` | `bottom-action-bar.tsx` | Server | `{ children: ReactNode; className?: string }`. `fixed inset-x-0 bottom-0 z-30 bg-bg2 border-t border-line px-[14px] pt-[12px] pb-[calc(env(safe-area-inset-bottom)+16px)]` | `--bg2`, `--line` |
| `Countdown` | `countdown.tsx` | **Client** | `{ deadlineAt: string; className?: string; onExpire?: () => void }`. `useState(() => Date.now())` + `setInterval` de 1s, `suppressHydrationWarning` en el `<time>` | `--warn`, `--font-num` |
| `ToastProvider` / `useToast` | `toast.tsx` | **Client** | `ToastProvider: { children: ReactNode }`; `useToast(): (msg: string, tone?: 'neutral'\|'bad') => void`. `fixed left-[14px] right-[14px] bottom-[96px] z-[60]`, auto-cierre 2600ms, uno a la vez | `--txt`, `--bg`, `--bad` |
| `TabBar` | `../tab-bar.tsx` | **Client** | Sin props. 4 tabs: `/jornada` CalendarDays, `/clasificacion` Trophy, `/perfil` User, `/ajustes` Settings. `aria-current="page"` con `usePathname()` (activo si `pathname === href` o empieza por `href + '/'` en el grupo tabs). Iconos 22px strokeWidth 1.9 (Settings 1.6) | `--bg2`, `--line`, `--accent`, `--txt3` |

Reglas transversales de las primitivas:
- Todo destino tactil usa `min-h-[Npx]` / `min-w-[Npx]`, nunca `h-[Npx]`, salvo avatares, steppers y contadores.
- Todos los botones llevan `active:scale-[.97] active:opacity-90 transition-transform duration-100`.
- Ninguna primitiva importa de `@/lib/data` ni de `@/lib/seed`. Solo de `@/lib/{cn,format,types,view-models}` y `lucide-react`.
- `src/components/ui/index.ts` es el unico punto de import para las pantallas: `import { Card, Button, Chip } from '@/components/ui'`.

### 3.4 Contrato de la capa de datos (`src/lib/data/index.ts`)

```ts
export async function getActiveGameweek(): Promise<GameweekVM>
export async function getGameweekSummary(): Promise<SummaryVM>
export async function getMatchEditor(matchId: string): Promise<PredictEditorVM | null>
export async function getMatchPique(matchId: string): Promise<PiqueVM | null>
export async function getSeasonStandings(): Promise<StandingsVM>
export async function getGameweekStandings(n: number): Promise<GameweekStandingsVM | null>
export async function getProfile(): Promise<ProfileVM>
export async function getLeagueSettings(): Promise<LeagueSettingsVM>
export async function getAdminMatches(): Promise<AdminMatchVM[]>
```
`null` significa "no existe o no es visible para este usuario" y la pagina responde con `notFound()`.

### 3.5 Contrato de Server Actions

```ts
// src/features/predict/actions.ts
'use server'
type SaveState = { ok: boolean; error: string | null }
export async function savePredictionAction(prev: SaveState, formData: FormData): Promise<SaveState>
// campos: matchId, home, away, mvp (''=null), scorers (JSON string[]), noGoals ('1'|'')

// src/features/auth/actions.ts
'use server'
export async function joinLeagueAction(prev: { error: string | null }, formData: FormData): Promise<{ error: string | null }>
// campos: inviteCode, displayName, avatarColor. En exito hace redirect('/jornada')

// src/features/admin/actions.ts
'use server'
export async function saveMatchResultAction(prev: SaveState, formData: FormData): Promise<SaveState>
export async function saveScoringAction(prev: SaveState, formData: FormData): Promise<SaveState>
```
Toda Server Action empieza por `const supabase = await createClient(); const { data } = await supabase.auth.getClaims(); if (!data?.claims) return { ok:false, error:'unauthorized' }` y termina con `revalidatePath(...)`.

---

## 4. Reparto de pantallas en lotes disjuntos

Regla comun a los 5 lotes: **solo lectura** sobre `src/components/ui/**`, `src/components/tab-bar.tsx`, `src/lib/**`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/(tabs)/layout.tsx`, `src/app/(stack)/layout.tsx`. Si un lote necesita una primitiva nueva o un campo de VM que no existe, **NO la crea**: la pide al coordinador, que la anade en F2/F1 y avisa. Ningun lote crea ficheros fuera de su lista.

### Lote A - Autenticacion y alta
Crea y edita, exclusivamente:
- `src/app/(auth)/login/page.tsx`
- `src/app/(auth)/login/login-form.tsx`
- `src/app/(auth)/onboarding/page.tsx`
- `src/app/(auth)/onboarding/onboarding-flow.tsx`
- `src/app/(auth)/onboarding/code-keypad.tsx`
- `src/features/auth/actions.ts`

Solo lectura adicional: `src/lib/supabase/client.ts`, `src/lib/auth.ts`, `src/lib/seed.ts` (para `AVATAR_COLORS` y `CODE_KEYS`).
Notas de implementacion: el teclado del onboarding usa `CODE_KEYS` de `seed.ts` (32 caracteres, sin I ni O), NO las 12 teclas literales del prototipo, que eran atrezzo. `router.replace()` en todas las transiciones de este grupo. El texto "Reenviar en 0:42" se implementa con un `Countdown` real de 45 s que habilita el boton al llegar a cero.

### Lote B - Jornada y resumen
Crea y edita, exclusivamente:
- `src/app/(tabs)/jornada/page.tsx`, `loading.tsx`, `error.tsx`
- `src/app/(stack)/jornada/resumen/page.tsx`
- `src/features/jornada/gameweek-header.tsx`
- `src/features/jornada/match-row.tsx`
- `src/features/jornada/summary-row.tsx`

Solo lectura adicional: `src/lib/data/index.ts` (`getActiveGameweek`, `getGameweekSummary`).
Notas: `MatchRow` es Server Component envuelto en `<Link href={'/jornada/' + id}>` para status `open`/`locked`/`live`, y en `<Link href={'/partido/' + id}>` para `played`. Cinco variantes de tail exactamente como el dossier. El progreso usa `predictedCount/totalCount`, nunca 10.

### Lote C - Editor de pronostico
Crea y edita, exclusivamente:
- `src/app/(stack)/jornada/[matchId]/page.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`
- `src/features/predict/reducer.ts`
- `src/features/predict/prediction-form.tsx`
- `src/features/predict/score-picker.tsx`
- `src/features/predict/sealed-card.tsx`
- `src/features/predict/actions.ts`

Solo lectura adicional: `src/lib/data/index.ts` (`getMatchEditor`), `src/lib/scoring.ts`.
Notas: `page.tsx` hace `const { matchId } = await params`, llama a `getMatchEditor`, y si es `null` -> `notFound()`. Si `editable` es false renderiza `<SealedCard>`; si es true renderiza `<PredictionForm>`. MVP, goleadores y asistentes se eligen con `<PlayerSelect>` (`src/components/ui/player-select.tsx`): una fila tocable que abre una hoja inferior con buscador, grupos por club y campo de texto libre al final. Marcadores rapidos fijos: `1-0, 2-0, 2-1, 1-1, 0-0`.

### Lote D - Clasificacion y pique
Crea y edita, exclusivamente:
- `src/app/(tabs)/clasificacion/page.tsx`, `loading.tsx`
- `src/app/(stack)/clasificacion/jornada/[n]/page.tsx`, `loading.tsx`
- `src/app/(stack)/partido/[matchId]/page.tsx`, `loading.tsx`, `not-found.tsx`
- `src/features/standings/podium.tsx`
- `src/features/standings/standings-row.tsx`
- `src/features/standings/gameweek-accordion.tsx`
- `src/features/pique/result-header.tsx`
- `src/features/pique/highlights.tsx`
- `src/features/pique/pique-row.tsx`

Solo lectura adicional: `src/lib/data/index.ts` (`getSeasonStandings`, `getGameweekStandings`, `getMatchPique`).
Notas: el segmentado General/Por jornada de `/clasificacion` navega con `router.push('/clasificacion/jornada/' + n)`, no cambia estado local. `[n]` se valida con `const jornada = Number(n); if (!Number.isInteger(jornada) || jornada < 1) notFound()`. Los botones prev/next llevan `disabled` y `aria-disabled` reales segun `hasPrev`/`hasNext`.

### Lote E - Perfil, ajustes y admin
Crea y edita, exclusivamente:
- `src/app/(tabs)/perfil/page.tsx`, `loading.tsx`
- `src/app/(tabs)/ajustes/page.tsx`
- `src/app/(stack)/ajustes/admin/page.tsx`
- `src/features/profile/points-chart.tsx`
- `src/features/settings/settings-group.tsx`
- `src/features/settings/debug-chips.tsx`
- `src/features/admin/admin-result-form.tsx`
- `src/features/admin/admin-scoring-form.tsx`
- `src/features/admin/actions.ts`

Solo lectura adicional: `src/lib/data/index.ts` (`getProfile`, `getLeagueSettings`, `getAdminMatches`), `src/components/theme-toggle.tsx`.
Notas: la tarjeta de acceso a admin en `/ajustes` solo se renderiza si `settings.isAdmin`. `/ajustes/admin` llama a `requireAdmin()` y hace `notFound()` si no lo es. La grafica usa `Math.max(...chart.map(c => c.points))` como maximo y marca como mejor el indice de ese maximo. Los chips de estados de prueba solo se renderizan si `process.env.NODE_ENV === 'development'`.

### Lote F (paralelo, backend) - Supabase SQL
Crea y edita, exclusivamente: `supabase/**`, y en la fase C sustituye los cuerpos de `src/lib/data/{gameweek,standings,profile,league}.ts`. No toca `src/app/**` ni `src/features/**` ni `src/lib/view-models.ts`.

---

## 5. Riesgos concretos de Next 16.2.12 y como se evitan

| Riesgo | Sintoma | Mitigacion obligatoria en este plan |
|---|---|---|
| `params`/`searchParams` sincronos | Error de tipos o de runtime; en 15 se toleraba, en 16 el acceso sincrono esta ELIMINADO | Toda page dinamica declara `params: Promise<{...}>` y hace `await params`. Ningun Client Component recibe params: si los necesita, usa `use(params)` o los recibe ya resueltos por props |
| `cookies()` sincrono | El cliente Supabase SSR rompe el flujo de auth de forma silenciosa hasta que peta | `src/lib/supabase/server.ts` exporta `export async function createClient()` con `const cookieStore = await cookies()`. **Todos** los call sites hacen `await createClient()` |
| `middleware.ts` | El fichero se ignora o queda deprecado; la sesion no se refresca | El fichero es `src/proxy.ts` y la funcion se llama `proxy`. No se crea `middleware.ts` en ningun momento. No se configura runtime edge (no es configurable en `proxy`) |
| `setAll` con un solo argumento | Un CDN cachea la respuesta con el `Set-Cookie` de auth y sirve la sesion de un usuario a otro | `setAll(cookiesToSet, headers)` en `lib/supabase/proxy.ts` con `Object.entries(headers).forEach(([k,v]) => supabaseResponse.headers.set(k,v))`. En `server.ts` la firma es `setAll(cookiesToSet, _headers)` dentro de try/catch |
| `getSession()` en servidor | Sesion falsificable por cookie; la doc lo marca con aviso de peligro | Solo `supabase.auth.getClaims()` en proxy, en `lib/auth.ts` y en cada Server Action. Cero llamadas a `getSession()` |
| Codigo entre `createServerClient` y `getClaims()` | Deslogueos aleatorios imposibles de depurar | Las dos llamadas son consecutivas en `lib/supabase/proxy.ts`, con el comentario de aviso encima |
| `revalidateTag('x')` con un argumento | Error de TypeScript en 16 | D5: prohibido `revalidateTag`. Solo `revalidatePath` |
| `unstable_cacheLife` / `unstable_cacheTag` | Import inexistente | D5: no se usan |
| `experimental.ppr` / `experimental_ppr` / `experimental.dynamicIO` / `experimental.useCache` | Eliminados en 16, el build falla o la opcion se ignora | D4: `next.config.ts` no contiene la clave `experimental` |
| `--turbopack` en los scripts o config webpack heredada | `next build` FALLA (Turbopack es el default) | Verificado: `package.json` ya esta limpio. Prohibido anadir la clave `webpack` a `next.config.ts` y prohibido instalar plugins que la inyecten |
| `next lint` / clave `eslint` en next.config | Comando y opcion eliminados | Verificado: el script ya es `"lint": "eslint"`. No se anade la clave `eslint` a `next.config.ts` |
| Parallel routes sin `default.tsx` | El build FALLA, no es un warning | No se usan parallel routes ni slots `@modal` en v1. La navegacion es siempre por ruta completa |
| `error.tsx` con `reset` o sin `'use client'` | El boundary no compila, o se usa la API vieja | Todos los `error.tsx` y `global-error.tsx` llevan `'use client'` y la firma `{ error: Error & { digest?: string }; unstable_retry: () => void }` |
| Rutas dinamicas sin `loading.tsx` | Next SALTA el prefetch y la navegacion parece congelada al tocar un partido | `loading.tsx` obligatorio en `/jornada/[matchId]`, `/clasificacion/jornada/[n]` y `/partido/[matchId]`. Es criterio de aceptacion de los lotes C y D |
| Convertir `(tabs)/layout.tsx` o `(stack)/layout.tsx` en root layout | FULL PAGE RELOAD al saltar de `/jornada` a `/jornada/[matchId]`; no da error de compilacion, solo se siente mal | Solo `src/app/layout.tsx` tiene `<html>` y `<body>`. Los layouts de grupo se tipan con `{ children: React.ReactNode }` inline, nunca con `LayoutProps` (ambos normalizan a `/`) |
| Duplicar una URL entre grupos | Error de build: "Routes in different groups should not resolve to the same URL path" | `/jornada/resumen` y `/jornada/[matchId]` viven ambos en `(stack)`. `/ajustes` en `(tabs)` y `/ajustes/admin` en `(stack)` son URLs distintas, permitido |
| `usePathname()` dentro de un layout server | El valor queda obsoleto porque los layouts no re-renderizan | `TabBar` es un Client Component aparte con `usePathname()`, importado por el layout |
| Proxy sin matcher o con matcher incompleto | La logica de auth bloquea CSS, JS, imagenes, el manifest y los iconos de la PWA | Matcher: `'/((?!_next/static\|_next/image\|favicon.ico\|manifest.webmanifest\|icon\|apple-icon\|.*\\.(?:svg\|png\|jpg\|jpeg\|gif\|webp)$).*)'`. Rutas publicas: solo `/login` y `/auth` |
| Confiar en el proxy como autorizacion | Las Server Functions son POST a la ruta donde se usan; un cambio de matcher las deja fuera en silencio | D13: `getClaims()` dentro de cada Server Action + RLS como frontera real |
| Metadata: `themeColor` o `viewport` dentro de `metadata` | Deprecado desde 14; el meta no sale o sale duplicado | `export const viewport: Viewport` con `themeColor: '#0B0F14'`, `colorScheme: 'dark'` y `viewportFit: 'cover'`. Cero `<meta name="viewport">` a mano |
| Falta `viewportFit: 'cover'` | `env(safe-area-inset-*)` devuelve 0px en iPhone y la tab bar se come el home indicator | Esta en el export `viewport`. Toda barra fija usa `calc(env(safe-area-inset-bottom) + Npx)` |
| Iconos: esperar que el manifest sirva para iOS | El icono del home screen sale en blanco o recortado | `app/apple-icon.tsx` de 180x180 ademas del manifest. `apple-icon` no admite `.svg` ni `.ico` |
| Declarar `metadata.icons` teniendo `app/icon.tsx` | Tags duplicados; la metadata de fichero gana | No se declara `icons` en el objeto `metadata` |
| Falta `suppressHydrationWarning` en `<html>` | React re-renderiza desde el boundary por el mismatch de `data-theme`, hay flash y se pierden las correcciones de otros scripts inline | Esta en el root layout, junto al script inline en `<head>` |
| Toggle de tema con `useState('dark')` en vez de lazy initializer | El primer render del cliente revierte visualmente el tema | `useState(() => localStorage.getItem('theme') ?? 'dark')`, la misma fuente que el script inline |
| `'use client'` en `app/layout.tsx` | Rompe los exports de `metadata` y `viewport` | El root layout es Server Component; `ThemeToggle` y `ToastProvider` son componentes hijos client |
| Fechas formateadas sin timezone fija | Mismatch de hidratacion aleatorio segun la zona del visitante | D17: `Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', ... })` en `format.ts`, usado tanto en servidor como en cliente |
| `Countdown` con `Date.now()` en render | Mismatch de hidratacion garantizado | `useState(() => Date.now())` + `suppressHydrationWarning` en el `<time>` |
| `Barlow_Condensed` sin `weight` | Falla de compilacion: `options` y `weight` son obligatorios (no es fuente variable) | `Barlow_Condensed({ weight: ['700','800'], subsets: ['latin'], display: 'swap', variable: '--font-barlow-condensed' })` |
| `Figtree` con array de `weight` | Desactiva la fuente variable y genera 6 @font-face estaticos | `Figtree({ subsets: ['latin'], display: 'swap', variable: '--font-figtree' })`, sin `weight` |
| Autorreferencia de variables de fuente | La fuente no resuelve y no da error | next/font emite `--font-figtree`/`--font-barlow-condensed`; `@theme inline` define `--font-ui`/`--font-num`. Nombres distintos siempre |
| `tailwind.config.ts` o `@tailwind base/components/utilities` | Se ignora la config (v3) o no compila (v4) | No se crea `tailwind.config.ts`. `globals.css` empieza por `@import "tailwindcss";`. `postcss.config.mjs` no se toca |
| RLS: politica de `members` que consulta `members` | `ERROR: infinite recursion detected in policy for relation "members"` | Todas las politicas usan las funciones `private.*` SECURITY DEFINER del esquema `private`, con `grant usage`/`grant execute` a `authenticated` |
| RLS: `auth.uid()` sin envolver, o `in (select f())` | 179ms -> el optimizador llama la funcion por fila; con SECURITY DEFINER llega a 178 s | Siempre `(select auth.uid())` y siempre `columna = any (array(select private.f()))` |
| Vista de clasificacion sin `security_invoker` | Fuga total: un usuario ve los miembros y puntos de todas las ligas | `create view ... with (security_invoker = true)` en las dos vistas. Prohibido `create materialized view` |
| Node 18 en CI o Docker | La build falla | Minimo Node 20.9.0; se fija en el README y en el `engines` de `package.json` |
| Herramientas apuntando a `.next` | En 16 `next dev` escribe en `.next/dev` | No se scriptea nada contra `.next`; `.gitignore` ya cubre el directorio entero |
| `process.argv.includes('dev')` en next.config | Devuelve false en 16 | No se usa; si hiciera falta, `process.env.NODE_ENV === 'development'` |

---

## 6. Criterio de aceptacion global

1. `npm run build` termina sin errores ni warnings de Next.
2. `npx tsc --noEmit` limpio.
3. `npm run lint` limpio.
4. `grep -r "from '@/lib/seed'" src/app src/features` no devuelve nada (las pantallas solo consumen `@/lib/data`).
5. `grep -rn "params: {" src/app` no devuelve ninguna firma sin `Promise`.
6. `grep -rn "cookies()" src` : toda ocurrencia va precedida de `await`.
7. No existe `middleware.ts` en el repositorio.
8. Las 11 rutas responden, las 3 rutas dinamicas tienen `loading.tsx`, y navegar entre `(tabs)` y `(stack)` no provoca recarga completa (comprobable porque la tab bar no parpadea).
9. En iPhone con `next dev --experimental-https`: la app se instala desde Compartir > Anadir a pantalla de inicio, arranca en standalone con la barra de estado fundida en #0B0F14, y ni la tab bar ni la barra de accion del predict quedan bajo el home indicator.
10. Con `prefers-reduced-motion: reduce` activo no hay ninguna animacion en bucle.