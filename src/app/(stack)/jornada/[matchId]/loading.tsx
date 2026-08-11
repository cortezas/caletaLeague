import { Skeleton } from '@/components/ui'

/**
 * OBLIGATORIO: sin `loading.tsx` Next se salta el prefetch de la ruta dinamica y
 * tocar un partido se siente congelado durante toda la carga.
 *
 * Las alturas imitan la cabecera, la tarjeta de marcador y las dos de jugadores.
 */
export default function Loading() {
  return (
    <div className="px-[14px] pt-[calc(env(safe-area-inset-top)+14px)] pb-[132px]">
      <div className="flex items-center gap-[10px] border-b border-line pb-[12px]">
        <Skeleton height={44} radius={13} className="w-[44px] flex-none" />
        <div className="flex flex-1 flex-col gap-[6px]">
          <Skeleton height={15} radius={6} className="w-[64%]" />
          <Skeleton height={11} radius={6} className="w-[42%]" />
        </div>
      </div>
      <div role="status" aria-busy="true" aria-label="Cargando el pronóstico" className="mt-[16px] flex flex-col gap-[14px]">
        <Skeleton height={292} radius={22} />
        <Skeleton height={236} radius={22} />
        <Skeleton height={252} radius={22} />
      </div>
    </div>
  )
}
