import { WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'

export interface ErrorStateProps {
  title: string
  description: string
  action?: ReactNode
}

/**
 * Sin prop `icon`: el estado de error siempre es el mismo (wifi tachado sobre
 * `bad-soft`), asi los error.tsx de los cuatro grupos salen identicos.
 */
export function ErrorState({ title, description, action }: ErrorStateProps) {
  return (
    <div role="alert" className="flex flex-col items-center gap-[14px] px-[34px] py-[70px] text-center">
      <div
        aria-hidden
        className="flex h-[78px] w-[78px] items-center justify-center rounded-[26px] bg-bad-soft text-bad"
      >
        <WifiOff size={34} strokeWidth={1.7} />
      </div>
      <p className="text-[19px] font-extrabold tracking-[-.02em]">{title}</p>
      <p className="max-w-[255px] text-[14px] leading-[1.5] text-txt2">{description}</p>
      {action && <div className="mt-[6px]">{action}</div>}
    </div>
  )
}
