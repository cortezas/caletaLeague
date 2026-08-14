import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, unstable_rethrow } from 'next/navigation'

import { ScreenHeader } from '@/components/ui'
import { AdminKickoffForm } from '@/features/admin/admin-kickoff-form'
import { AdminResultForm } from '@/features/admin/admin-result-form'
import { AdminScoringForm } from '@/features/admin/admin-scoring-form'
import { AdminSquadForm } from '@/features/admin/admin-squad-form'
import { requireAdmin } from '@/lib/auth'
import { cn } from '@/lib/cn'
import { getAdminMatches, getAdminSquads, getLeagueSettings } from '@/lib/data'
import { TEAM_CODES, TEAMS } from '@/lib/laliga'
import type { TeamVM } from '@/lib/view-models'

export const metadata: Metadata = { title: 'Administrador · La Caleta League' }

/**
 * La pestana activa es un parametro de URL y no estado de cliente: asi la page
 * sigue siendo Server Component, cada pestana es enlazable, y volver desde el
 * navegador cae donde tocaba. La contrapartida es que el segmentado son dos
 * <Link>, no la primitiva <Segmented> (que necesita onValueChange).
 */
const TABS = [
  { key: 'resultados', label: 'Resultados' },
  { key: 'horarios', label: 'Horarios' },
  { key: 'puntuacion', label: 'Puntuación' },
  { key: 'plantillas', label: 'Plantillas' },
] as const

type TabKey = (typeof TABS)[number]['key']

/** Mismo boton de 44x44 que /jornada y /clasificacion/jornada/[n]. */
const NAV_BUTTON =
  'flex min-h-[44px] min-w-[44px] flex-none items-center justify-center rounded-[13px] border border-line bg-card'

const NAV_BUTTON_ON = 'text-txt transition-transform duration-100 active:scale-[.97] active:opacity-90'

const NAV_BUTTON_OFF = 'text-txt3 opacity-50'

/**
 * Los 20 de la temporada, del servidor al formulario de plantillas. `TEAMS` trae
 * ademas `fullName` y `city`, que el VM de pantalla no usa.
 */
const TEAM_LIST: TeamVM[] = TEAM_CODES.map((code) => ({
  code,
  name: TEAMS[code].name,
  color: TEAMS[code].color,
  ink: TEAMS[code].ink,
}))

/**
 * La jornada viaja con la pestana: irse a Puntuación y volver tiene que caer en
 * la jornada que se estaba mirando, no en la de por defecto.
 */
function hrefFor(tab: TabKey, jornada?: number): string {
  const params = new URLSearchParams()
  if (tab !== 'resultados') params.set('tab', tab)
  if (jornada !== undefined) params.set('j', String(jornada))
  const query = params.toString()
  return query === '' ? '/ajustes/admin' : `/ajustes/admin?${query}`
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; j?: string | string[] }>
}) {
  // Riesgo Next 16: searchParams es una promesa, igual que params.
  const { tab, j } = await searchParams

  try {
    await requireAdmin()
  } catch (error) {
    // `requireAdmin()` redirige a /login o /onboarding cuando no hay sesion, y
    // `redirect()` señaliza LANZANDO. Sin este rethrow el catch se tragaria la
    // redireccion y a quien no ha entrado se le pintaria un 404 en vez de
    // mandarlo al login.
    unstable_rethrow(error)
    // Para quien si ha entrado pero no organiza, esta pantalla no existe.
    notFound()
  }

  // Mismo contrato que /jornada: `?j=<numero>` fija la jornada, y un numero que
  // no es numero (o que no existe en la liga) es un 404, no un silencio.
  const requested = Array.isArray(j) ? j[0] : j
  let jornada: number | undefined
  if (requested !== undefined && requested !== '') {
    const parsed = Number(requested)
    if (!Number.isInteger(parsed) || parsed < 1) notFound()
    jornada = parsed
  }

  const active: TabKey =
    tab === 'puntuacion'
      ? 'puntuacion'
      : tab === 'plantillas'
        ? 'plantillas'
        : tab === 'horarios'
          ? 'horarios'
          : 'resultados'
  const [settings, gameweek, squads] = await Promise.all([
    getLeagueSettings(),
    getAdminMatches(jornada),
    getAdminSquads(),
  ])
  if (!gameweek) notFound()

  // En Horarios lo pendiente no son los resultados: es cuantos partidos siguen
  // sin empezar, que son los unicos cuya hora se puede mover.
  const movableCount = gameweek.matches.filter((match) => match.status === 'open').length

  const pendingLabel =
    gameweek.matches.length === 0
      ? 'Sin partidos'
      : active === 'horarios'
        ? movableCount === 0
          ? 'Ninguno por empezar'
          : movableCount === 1
            ? '1 partido por empezar'
            : `${movableCount} partidos por empezar`
        : gameweek.pendingCount === 0
          ? 'Nada pendiente'
          : gameweek.pendingCount === 1
            ? '1 partido por rellenar'
            : `${gameweek.pendingCount} partidos por rellenar`

  return (
    <>
      <ScreenHeader title="Administrador" subtitle="Solo tú ves esta pantalla" backHref="/ajustes">
        <div className="flex gap-[3px] rounded-[13px] bg-sunk p-[3px]">
          {TABS.map((item) => (
            <Link
              key={item.key}
              href={hrefFor(item.key, jornada)}
              aria-current={item.key === active ? 'page' : undefined}
              className={cn(
                'flex min-h-[40px] flex-1 items-center justify-center rounded-[11px] text-[13.5px] font-bold',
                'transition-transform duration-100 active:scale-[.97] active:opacity-90',
                item.key === active ? 'bg-card text-txt' : 'text-txt3',
              )}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </ScreenHeader>

      {/* La navegacion de jornadas la comparten Resultados y Horarios: las dos
          trabajan sobre una jornada concreta. Puntuación y Plantillas no. */}
      {(active === 'resultados' || active === 'horarios') && (
        <>
          <div className="px-[14px] pt-[14px]">
            <nav aria-label="Cambiar de jornada" className="flex items-center gap-[10px]">
              {gameweek.hasPrev && gameweek.prevNumber !== null ? (
                <Link
                  href={hrefFor(active, gameweek.prevNumber)}
                  aria-label={`Ir a la jornada ${gameweek.prevNumber}`}
                  className={cn(NAV_BUTTON, NAV_BUTTON_ON)}
                >
                  <ChevronLeft size={17} strokeWidth={2.3} aria-hidden />
                </Link>
              ) : (
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  aria-label="No hay jornada anterior"
                  className={cn(NAV_BUTTON, NAV_BUTTON_OFF)}
                >
                  <ChevronLeft size={17} strokeWidth={2.3} aria-hidden />
                </button>
              )}

              <div className="min-w-0 flex-1 text-center">
                <p className="font-num text-[24px] font-extrabold leading-[1.05]">
                  JORNADA {gameweek.number}
                </p>
                <p className="text-[11.5px] font-semibold text-txt3">{pendingLabel}</p>
              </div>

              {gameweek.hasNext && gameweek.nextNumber !== null ? (
                <Link
                  href={hrefFor(active, gameweek.nextNumber)}
                  aria-label={`Ir a la jornada ${gameweek.nextNumber}`}
                  className={cn(NAV_BUTTON, NAV_BUTTON_ON)}
                >
                  <ChevronRight size={17} strokeWidth={2.3} aria-hidden />
                </Link>
              ) : (
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  aria-label="No hay jornada siguiente"
                  className={cn(NAV_BUTTON, NAV_BUTTON_OFF)}
                >
                  <ChevronRight size={17} strokeWidth={2.3} aria-hidden />
                </button>
              )}
            </nav>

            {/* La jornada del panel es la que le falta por rellenar, no la que se
                cierra antes: si se ha ido a otra hay que decirlo y dar la vuelta. */}
            {!gameweek.isDefault && (
              <Link
                href={hrefFor(active)}
                className="mt-[9px] flex min-h-[44px] items-center justify-between gap-[10px] rounded-[13px] border border-line bg-sunk px-[13px] py-[9px] transition-transform duration-100 active:scale-[.97] active:opacity-90"
              >
                <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-txt3">
                  No es la jornada que te falta por rellenar
                </span>
                <span className="flex-none text-[11.5px] font-extrabold text-accent2">
                  Ir a la que toca
                </span>
              </Link>
            )}
          </div>

          {/* `key`: al cambiar de jornada el formulario tiene que empezar de cero.
              Sin esto React reutiliza el estado y los marcadores (o el partido
              elegido) de la jornada anterior. */}
          {active === 'resultados' ? (
            <AdminResultForm
              key={gameweek.number}
              matches={gameweek.matches}
              memberCount={settings.memberCount}
            />
          ) : (
            <AdminKickoffForm key={gameweek.number} matches={gameweek.matches} />
          )}
        </>
      )}
      {active === 'puntuacion' && (
        <AdminScoringForm scoring={settings.scoring} memberCount={settings.memberCount} />
      )}
      {active === 'plantillas' && <AdminSquadForm teams={TEAM_LIST} squads={squads} />}
    </>
  )
}
