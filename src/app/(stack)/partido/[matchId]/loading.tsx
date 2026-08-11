import { Skeleton } from '@/components/ui'

export default function Loading() {
  return (
    <>
      <div className="sticky top-0 z-20 border-b border-line bg-bg px-[14px] pt-[calc(env(safe-area-inset-top)+14px)] pb-[12px]">
        <div className="flex items-center gap-[10px]">
          <Skeleton height={44} radius={13} className="w-[44px] flex-none" />
          <Skeleton height={34} radius={10} className="max-w-[220px] flex-1" />
        </div>
      </div>

      <div role="status" aria-busy="true" aria-label="Cargando el partido" className="flex flex-col gap-[12px] px-[14px] pt-[16px] pb-[30px]">
        {/* Tarjeta de resultado real. */}
        <Skeleton height={186} radius={22} />
        {/* Tira de destacados: se recorta a la derecha, como en la pantalla real. */}
        <div className="flex gap-[8px] overflow-hidden">
          <Skeleton height={92} radius={17} className="w-[172px] flex-none" />
          <Skeleton height={92} radius={17} className="w-[172px] flex-none" />
        </div>
        <div className="mt-[4px] flex flex-col gap-[6px]">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} height={70} radius={16} />
          ))}
        </div>
      </div>
    </>
  )
}
