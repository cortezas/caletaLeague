import type { InputHTMLAttributes } from 'react'

import { cn } from '@/lib/cn'

export type TextInputSize = 'md' | 'lg'

export type TextInputProps = {
  label?: string
  hint?: string
  error?: string
  inputSize?: TextInputSize
} & InputHTMLAttributes<HTMLInputElement>

const SIZE: Record<TextInputSize, string> = {
  md: 'min-h-[44px] rounded-[13px] border border-line2 bg-sunk px-[13px] text-[14.5px] font-medium',
  lg: 'min-h-[54px] rounded-[16px] border-[1.5px] border-line2 bg-card px-[16px] text-[16px] font-medium',
}

/**
 * El input va DENTRO del <label>: asocia etiqueta y campo sin necesitar un id,
 * y `useId()` no existe en Server Components.
 */
export function TextInput({ label, hint, error, inputSize = 'md', className, ...rest }: TextInputProps) {
  const message = error ?? hint

  return (
    <label className="block">
      {label && (
        <span className="mb-[7px] block text-[11px] font-extrabold uppercase tracking-[.11em] text-txt3">
          {label}
        </span>
      )}
      <input
        {...rest}
        aria-invalid={error ? true : undefined}
        className={cn(
          'block w-full text-txt outline-none placeholder:text-txt3',
          SIZE[inputSize],
          error && 'border-bad',
          className,
        )}
      />
      {message && (
        <span className={cn('mt-[6px] block text-[12px] font-semibold', error ? 'text-bad' : 'text-txt3')}>
          {message}
        </span>
      )}
    </label>
  )
}
