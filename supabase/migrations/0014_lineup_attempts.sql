-- =============================================================================
-- 0014 - Freno para pedir alineaciones bajo demanda
-- =============================================================================
-- QUE RESUELVE
-- Las alineaciones las pide el cron de GitHub Actions cada 15 minutos... sobre el
-- papel. Medido de verdad sobre 58 pasadas del 11 al 13 de agosto de 2026: una
-- cada 42 minutos de media, mediana 35, MAXIMO 156. En la ventana de 90 minutos
-- previa al partido eso da 2 o 3 intentos, y un hueco malo se la salta entera.
--
-- Consecuencia: la pena abre el partido a las 19:00, la alineacion salio a las
-- 18:40, y no se ve porque el cron no ha vuelto a pasar. Justo el rato en que
-- todavia se puede cambiar el pronostico.
--
-- LA SOLUCION
-- Que la propia app pida la alineacion cuando alguien abre un partido que esta a
-- punto de empezar. Pero doce personas abriendo el mismo partido no pueden ser
-- doce peticiones: el plan gratuito de Highlightly son 100 AL DIA.
--
-- Esta tabla es el freno. Guarda cuando se intento por ultima vez cada partido,
-- y el intento bajo demanda solo sale a la red si han pasado los minutos de
-- gracia. Doce personas en el mismo minuto = UNA peticion.
--
-- POR QUE UNA TABLA Y NO UNA COLUMNA EN match_lineups
-- Ahi solo hay fila cuando la alineacion se ha conseguido; el freno tiene que
-- registrar tambien los intentos FALLIDOS, que son la mayoria (mientras no se
-- publica). Meterlos en match_lineups obligaria a admitir filas a medias y a
-- distinguirlas, que es justo la ambiguedad que se quiere evitar.
-- =============================================================================

create table if not exists public.lineup_fetch_attempts (
  match_id     uuid primary key references public.matches (id) on delete cascade,
  attempted_at timestamptz not null default now(),
  -- Cuantas veces se ha intentado sin exito. Sirve para dejar de insistir en un
  -- partido cuya alineacion no va a llegar nunca.
  attempts     int not null default 1
);

comment on table public.lineup_fetch_attempts is
  'Freno de peticiones bajo demanda a Highlightly. Una fila por partido con el '
  'ultimo intento. No guarda datos de la alineacion: solo cuando se probo.';

alter table public.lineup_fetch_attempts enable row level security;

-- Nadie la lee ni la escribe desde el cliente: es fontaneria del servidor y
-- solo la toca `service_role`, que salta RLS por definicion. Sin politicas y
-- sin grants, cualquier intento desde el navegador se queda fuera.
revoke all on public.lineup_fetch_attempts from anon, authenticated;
grant select, insert, update, delete on public.lineup_fetch_attempts to service_role;
