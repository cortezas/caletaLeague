import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, unstable_rethrow } from 'next/navigation'

import { ScreenHeader } from '@/components/ui'
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
  { key: 'resultados', label: 'Resultados', href: '/ajustes/admin' },
  { key: 'puntuacion', label: 'Puntuación', href: '/ajustes/admin?tab=puntuacion' },
  { key: 'plantillas', label: 'Plantillas', href: '/ajustes/admin?tab=plantillas' },
] as const

type TabKey = (typeof TABS)[number]['key']

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

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  // Riesgo Next 16: searchParams es una promesa, igual que params.
  const { tab } = await searchParams

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

  const active: TabKey =
    tab === 'puntuacion' ? 'puntuacion' : tab === 'plantillas' ? 'plantillas' : 'resultados'
  const [settings, matches, squads] = await Promise.all([
    getLeagueSettings(),
    getAdminMatches(),
    getAdminSquads(),
  ])

  return (
    <>
      <ScreenHeader title="Administrador" subtitle="Solo tú ves esta pantalla" backHref="/ajustes">
        <div className="flex gap-[3px] rounded-[13px] bg-sunk p-[3px]">
          {TABS.map((item) => (
            <Link
              key={item.key}
              href={item.href}
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

      {active === 'resultados' && (
        <AdminResultForm matches={matches} memberCount={settings.memberCount} />
      )}
      {active === 'puntuacion' && (
        <AdminScoringForm scoring={settings.scoring} memberCount={settings.memberCount} />
      )}
      {active === 'plantillas' && <AdminSquadForm teams={TEAM_LIST} squads={squads} />}
    </>
  )
}
