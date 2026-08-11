import { LoaderCircle } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'dashed' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export type ButtonProps = {
  variant: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  loading?: boolean
  leading?: ReactNode
  trailing?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>

const VARIANT: Record<ButtonVariant, string> = {
  // La sombra del primario es el unico realce de la accion principal (README, tokens).
  primary: 'bg-accent text-accent-ink shadow-[0_8px_24px_var(--accent-soft)]',
  secondary: 'border border-line2 bg-card text-txt',
  ghost: 'bg-transparent text-accent',
  dashed: 'border border-dashed border-line2 bg-transparent text-txt2',
  danger: 'bg-bad text-white',
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-[44px] rounded-[13px] px-[14px] text-[14px] font-bold',
  md: 'min-h-[52px] rounded-[16px] px-[22px] text-[15.5px] font-extrabold',
  lg: 'min-h-[54px] rounded-[16px] px-[24px] text-[16px] font-extrabold',
}

const SPINNER: Record<ButtonSize, number> = { sm: 16, md: 18, lg: 18 }

/**
 * Sin `'use client'` y sin hooks a proposito: asi el mismo componente vale
 * dentro de un Server Component y dentro de un Client Component.
 * `type` por defecto a 'button': un submit accidental es un bug silencioso.
 * Los formularios tienen que pasar `type="submit"` explicitamente.
 */
export function Button({
  variant,
  size = 'md',
  fullWidth = false,
  loading = false,
  leading,
  trailing,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-[8px] leading-none',
        'transition-transform duration-100 active:scale-[.97] active:opacity-90',
        'disabled:pointer-events-none disabled:opacity-50',
        SIZE[size],
        VARIANT[variant],
        fullWidth && 'w-full',
        className,
      )}
    >
      {loading ? (
        <LoaderCircle size={SPINNER[size]} strokeWidth={2.4} className="animate-spin" aria-hidden />
      ) : (
        leading
      )}
      {children}
      {trailing}
    </button>
  )
}
