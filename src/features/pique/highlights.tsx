import type { PiqueVM } from '@/lib/view-models'

type Highlight = PiqueVM['highlights'][number]

export interface HighlightsProps {
  items: Highlight[]
}

/** El borde es siempre `line`; lo que cambia por tono es el fondo y el numero. */
const TONE: Record<Highlight['tone'], { box: string; value: string }> = {
  ok: { box: 'bg-ok-soft', value: 'text-ok' },
  accent: { box: 'bg-accent-soft', value: 'text-accent2' },
  neutral: { box: 'bg-card', value: 'text-txt2' },
}

/** Tira horizontal de destacados. Vienen calculados en el VM, aqui solo se pintan. */
export function Highlights({ items }: HighlightsProps) {
  if (items.length === 0) return null

  return (
    <ul aria-label="Destacados del partido" className="flex gap-[8px] overflow-x-auto pb-[2px]">
      {items.map((item, index) => {
        const tone = TONE[item.tone]
        return (
          <li
            key={index}
            className={`w-[172px] flex-none rounded-[17px] border border-line px-[14px] py-[13px] ${tone.box}`}
          >
            <p className={`mb-[5px] font-num text-[26px] font-extrabold leading-none ${tone.value}`}>
              {item.value}
            </p>
            <p className="text-[12.5px] font-semibold leading-[1.35] text-txt2">{item.text}</p>
          </li>
        )
      })}
    </ul>
  )
}
