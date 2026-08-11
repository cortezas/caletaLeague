import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getOptionalMember, requireSession } from '@/lib/auth'
import { isSupabaseConfigured } from '@/lib/supabase/server'

import { OnboardingFlow } from './onboarding-flow'

export const metadata: Metadata = {
  title: 'Únete a la peña · La Caleta League',
}

export default async function OnboardingPage() {
  await requireSession()

  // Fase A: `getOptionalMember()` devuelve SIEMPRE el miembro del seed, asi que
  // sin esta condicion la pantalla seria inalcanzable en desarrollo. En cuanto
  // haya proyecto Supabase, quien ya es miembro se va derecho a la jornada.
  if (isSupabaseConfigured) {
    const member = await getOptionalMember()
    if (member) redirect('/jornada')
  }

  return (
    <main className="flex min-h-dvh flex-col px-[22px] pt-[max(74px,env(safe-area-inset-top))] pb-[max(40px,env(safe-area-inset-bottom))]">
      <OnboardingFlow />
    </main>
  )
}
