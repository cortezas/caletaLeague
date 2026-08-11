'use client'

import { Card, Stepper, TeamBadge } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { TeamVM } from '@/lib/view-models'

import { MAX_GOALS, MIN_GOALS } from './reducer'

/** Los cinco del dossier, en este orden. No salen de los datos: son fijos. */
const QUICK_SCORES: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [2, 0],
  [2, 1],
  [1, 1],
  [0, 0],
]

export interface ScorePickerProps {
  home: TeamVM
  away: TeamVM
  homeGoals: number
  awayGoals: number
  onGoals: (side: 'home' | 'away', value: number) => void
  onQuickScore: (home: number, away: number) => void
}

export function ScorePicker({
  home,
  away,
  homeGoals,
  awayGoals,
  onGoals,
  onQuickScore,
}: ScorePickerProps) {
  function column(team: TeamVM, goals: number, side: 'home' | 'away') {
    return (
      <div className="flex flex-1 flex-col items-center gap-[11px]">
        <TeamBadge team={team} size={44} />
        {/* min-h fija la linea base de las dos columnas aunque un nombre ocupe dos lineas. */}
        <p className="min-h-[30px] text-center text-[12.5px] font-bold leading-[1.2] text-txt2">
          {team.name}
        </p>
        <Stepper
          value={goals}
          min={MIN_GOALS}
          max={MAX_GOALS}
          size={52}
          label={`Goles del ${team.name}`}
          onValueChange={(value) => onGoals(side, value)}
        />
      </div>
    )
  }

  return (
    <Card radius={22} elevated className="px-[12px] pt-[16px] pb-[14px]">
      <div className="flex items-start gap-[6px]">
        {column(home, homeGoals, 'home')}
        {/* Filete vertical entre las dos columnas simetricas. */}
        <div aria-hidden className="mt-[18px] w-px self-stretch bg-line" />
        {column(away, awayGoals, 'away')}
      </div>

      <div
        role="group"
        aria-label="Marcadores rápidos"
        className="mt-[14px] flex gap-[6px] border-t border-line pt-[13px]"
      >
        {QUICK_SCORES.map(([quickHome, quickAway]) => {
          const active = homeGoals === quickHome && awayGoals === quickAway
          return (
            <button
              key={`${quickHome}-${quickAway}`}
              type="button"
              aria-pressed={active}
              onClick={() => onQuickScore(quickHome, quickAway)}
              className={cn(
                'min-h-[44px] flex-1 rounded-[12px] border font-num text-[15px] font-bold tracking-[.04em]',
                'transition-transform duration-100 active:scale-[.97] active:opacity-90',
                active
                  ? 'border-accent bg-accent-soft text-accent2'
                  : 'border-line bg-transparent text-txt2',
              )}
            >
              {quickHome}-{quickAway}
            </button>
          )
        })}
      </div>
    </Card>
  )
}
