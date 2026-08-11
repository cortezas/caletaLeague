import { ShieldCheck } from 'lucide-react'
import type { Metadata } from 'next'

import { ThemeToggle } from '@/components/theme-toggle'
import { ScreenHeader } from '@/components/ui'
import { DebugChips } from '@/features/settings/debug-chips'
import { NotificationsToggle } from '@/features/settings/notifications-toggle'
import { SettingsGroup, SettingsRow } from '@/features/settings/settings-group'
import { requireMember } from '@/lib/auth'
import { getLeagueSettings } from '@/lib/data'

export const metadata: Metadata = { title: 'Ajustes · La Caleta League' }

export default async function AjustesPage() {
  // D13: la guarda de pertenencia va al principio de cada pantalla protegida.
  await requireMember()
  const settings = await getLeagueSettings()
  const { scoring } = settings

  // Resumen compacto de la puntuacion: 3 · 1 · 2 · 2 · 1 · 5.
  // Mismo orden que las filas del panel de organizador (`RULES`).
  const scoringSummary = [
    scoring.exact,
    scoring.x2,
    scoring.mvp,
    scoring.scorer,
    scoring.assist,
    scoring.pleno,
  ].join(' · ')

  return (
    <>
      <ScreenHeader title="Ajustes" size="lg" />

      <div className="flex flex-col gap-[16px] px-[14px] pt-[16px] pb-[30px]">
        <SettingsGroup title="Tu peña">
          <SettingsRow
            label={settings.leagueName}
            hint={`${settings.memberCount} participantes · código ${settings.inviteCode}`}
            leading={
              <span
                aria-hidden
                className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[13px] bg-accent font-num text-[15px] font-extrabold text-accent-ink"
              >
                LCL
              </span>
            }
          />
          <SettingsRow label="Cómo se puntúa" value={scoringSummary} />
          <NotificationsToggle />
        </SettingsGroup>

        <SettingsGroup title="Apariencia">
          <SettingsRow label="Tema" control={<ThemeToggle />} />
        </SettingsGroup>

        {settings.isAdmin && (
          <SettingsGroup title="Organizador" tone="accent">
            <SettingsRow
              label="Panel de administrador"
              hint="Resultados y puntuación"
              href="/ajustes/admin"
              leading={
                <span
                  aria-hidden
                  className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[13px] bg-accent-soft text-accent2"
                >
                  <ShieldCheck size={18} strokeWidth={2} />
                </span>
              }
            />
          </SettingsGroup>
        )}

        {process.env.NODE_ENV === 'development' && <DebugChips />}
      </div>
    </>
  )
}
