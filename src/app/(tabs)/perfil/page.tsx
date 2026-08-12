import type { Metadata } from 'next'

import { Card, ScreenHeader, StatCard } from '@/components/ui'
import { EditProfile } from '@/features/profile/edit-profile'
import { PointsChart } from '@/features/profile/points-chart'
import { requireMember } from '@/lib/auth'
import { getProfile } from '@/lib/data'

export const metadata: Metadata = { title: 'Perfil · La Caleta League' }

export default async function PerfilPage() {
  // D13: la guarda de pertenencia va al principio de cada pantalla protegida.
  await requireMember()
  const profile = await getProfile()
  const { stats, streak } = profile

  return (
    <>
      <ScreenHeader title="Perfil" size="lg" />

      <div className="flex flex-col gap-[12px] px-[14px] pt-[18px] pb-[30px]">
        {/* El bloque de identidad es cliente: se edita en el sitio, sin salir del perfil. */}
        <EditProfile
          displayName={profile.displayName}
          avatarColor={profile.avatarColor}
          position={profile.position}
          memberCount={profile.memberCount}
          leagueName={profile.leagueName}
          totalPoints={profile.totalPoints}
        />

        <section className="grid grid-cols-2 gap-[8px]">
          <StatCard value={stats.totalPoints} label="Puntos totales" />
          <StatCard value={stats.exactHits} label="Resultados exactos" tone="ok" />
          <StatCard value={`${stats.signAccuracy}%`} label="Acierto en el 1X2" />
          <StatCard
            value={stats.bestGameweekPoints}
            label={`Mejor jornada (J${stats.bestGameweekNumber})`}
            tone="volt"
          />
        </section>

        <PointsChart chart={profile.chart} />

        {streak && (
          <Card radius={20} className="flex items-center gap-[13px] px-[16px] py-[15px]">
            <div className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-[16px] bg-volt font-num text-[19px] font-extrabold text-volt-ink">
              {streak.count}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px] font-extrabold tracking-[-.01em]">{streak.title}</div>
              <p className="text-[12.5px] font-semibold leading-[1.35] text-txt2">{streak.text}</p>
            </div>
          </Card>
        )}
      </div>
    </>
  )
}
