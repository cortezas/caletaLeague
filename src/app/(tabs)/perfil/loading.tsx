import { ScreenHeader, Skeleton } from '@/components/ui'

/**
 * La cabecera es estatica y no depende de datos: se pinta ya, asi la pantalla
 * no salta de sitio cuando llega el perfil. Skeletons, nunca spinners.
 */
export default function Loading() {
  return (
    <>
      <ScreenHeader title="Perfil" size="lg" />

      <div
        role="status"
        aria-busy="true"
        aria-label="Cargando el perfil"
        className="flex flex-col gap-[12px] px-[14px] pt-[18px] pb-[30px]"
      >
        <Skeleton height={64} radius={22} />

        <div className="grid grid-cols-2 gap-[8px]">
          <Skeleton height={78} radius={17} />
          <Skeleton height={78} radius={17} />
          <Skeleton height={78} radius={17} />
          <Skeleton height={78} radius={17} />
        </div>

        <Skeleton height={186} radius={20} />
        <Skeleton height={78} radius={20} />
      </div>
    </>
  )
}
