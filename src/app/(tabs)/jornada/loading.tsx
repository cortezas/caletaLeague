import { SkeletonList } from '@/components/ui'

/**
 * Skeletons, nunca spinners (README, "12. Estados transversales").
 * El primer bloque de 46 px es la cabecera; los cinco de 92 px, las filas de
 * partido que caben en la primera pantalla.
 */
export default function JornadaLoading() {
  return (
    <div className="px-[14px] pt-[calc(env(safe-area-inset-top)+14px)] pb-[30px] lg:px-[24px] lg:pt-[22px]">
      <SkeletonList heights={[46, 92, 92, 92, 92, 92]} />
    </div>
  )
}
