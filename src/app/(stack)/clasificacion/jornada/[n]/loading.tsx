import { Skeleton } from '@/components/ui'

export default function Loading() {
  return (
    <>
      <div className="sticky top-0 z-20 border-b border-line bg-bg px-[14px] pt-[calc(env(safe-area-inset-top)+14px)] pb-[12px]">
        <div className="flex items-center gap-[10px]">
          <Skeleton height={44} radius={13} className="w-[44px] flex-none" />
          <p className="text-[24px] font-extrabold tracking-[-.03em]">Clasificación</p>
        </div>
        <div className="mt-[11px]">
          <Skeleton height={46} radius={13} />
        </div>
      </div>

      <div role="status" aria-busy="true" aria-label="Cargando la jornada" className="px-[14px] pt-[14px] pb-[30px]">
        <div className="mb-[14px] flex items-center gap-[10px]">
          <Skeleton height={44} radius={13} className="w-[44px] flex-none" />
          <Skeleton height={44} radius={13} className="flex-1" />
          <Skeleton height={44} radius={13} className="w-[44px] flex-none" />
        </div>
        <div className="flex flex-col gap-[6px]">
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} height={56} radius={15} />
          ))}
        </div>
      </div>
    </>
  )
}
