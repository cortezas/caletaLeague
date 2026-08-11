import type { ReactNode } from 'react'

export interface EmptyStateProps {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-[14px] px-[34px] py-[70px] text-center">
      <div
        aria-hidden
        className="flex h-[78px] w-[78px] items-center justify-center rounded-[26px] border border-line bg-card text-txt3"
      >
        {icon}
      </div>
      <p className="text-[19px] font-extrabold tracking-[-.02em]">{title}</p>
      <p className="max-w-[250px] text-[14px] leading-[1.5] text-txt2">{description}</p>
      {action && <div className="mt-[6px]">{action}</div>}
    </div>
  )
}
