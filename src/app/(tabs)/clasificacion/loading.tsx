import { Skeleton } from '@/components/ui'

/**
 * La cabecera es identica a la de la pantalla cargada: se pinta igual para que al
 * llegar los datos solo aparezca el cuerpo, sin salto.
 */
export default function Loading() {
  return (
    <>
      <div className="sticky top-0 z-20 border-b border-line bg-bg px-[14px] pt-[calc(env(safe-area-inset-top)+14px)] pb-[12px]">
        <p className="text-[24px] font-extrabold tracking-[-.03em]">Clasificación</p>
        <div className="mt-[11px]">
          <Skeleton height={46} radius={13} />
        </div>
      </div>

      <div role="status" aria-busy="true" aria-label="Cargando la clasificación" className="px-[14px] pt-[18px] pb-[30px]">
        {/* Podio: 84 - 104 - 70 de pedestal mas avatar y nombre. */}
        <div className="mb-[20px] flex items-end gap-[8px]">
          <Skeleton height={146} radius={14} className="flex-1" />
          <Skeleton height={172} radius={14} className="flex-1" />
          <Skeleton height={132} radius={14} className="flex-1" />
        </div>
        <div className="flex flex-col gap-[6px]">
          {Array.from({ length: 9 }, (_, i) => (
            <Skeleton key={i} height={58} radius={15} />
          ))}
        </div>
      </div>
    </>
  )
}
