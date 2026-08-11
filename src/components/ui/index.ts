/**
 * Barrel de las primitivas. Es el UNICO punto de import de las pantallas:
 *   import { Card, Button, Chip } from '@/components/ui'
 */

// --- Estructura (F2a) ---
export { Card } from './card'
export type { CardProps, CardRadius } from './card'

export { Button } from './button'
export type { ButtonProps, ButtonSize, ButtonVariant } from './button'

export { Chip } from './chip'
export type { ChipProps, ChipSize, ChipTone } from './chip'

export { ScreenHeader } from './screen-header'
export type { ScreenHeaderProps, ScreenHeaderSize } from './screen-header'

export { SectionLabel } from './section-label'
export type { SectionLabelProps } from './section-label'

export { BottomActionBar } from './bottom-action-bar'
export type { BottomActionBarProps } from './bottom-action-bar'

export { EmptyState } from './empty-state'
export type { EmptyStateProps } from './empty-state'

export { ErrorState } from './error-state'
export type { ErrorStateProps } from './error-state'

export { Skeleton, SkeletonList } from './skeleton'
export type { SkeletonListProps, SkeletonProps } from './skeleton'

export { TextInput } from './text-input'
export type { TextInputProps, TextInputSize } from './text-input'

// --- Contenido y controles (F2b) ---
export { Avatar } from './avatar'
export type { AvatarProps, AvatarSize } from './avatar'

export { TeamBadge } from './team-badge'
export type { TeamBadgeProps, TeamBadgeSize } from './team-badge'

export { Scoreline } from './scoreline'
export type { ScorelineProps, ScorelineSize, ScorelineTone } from './scoreline'

export { Segmented } from './segmented'
export type { SegmentedProps } from './segmented'

export { Stepper } from './stepper'
export type { StepperProps } from './stepper'

export { ProgressBar } from './progress-bar'
export type { ProgressBarProps } from './progress-bar'

export { PulseDot } from './pulse-dot'
export type { PulseDotProps } from './pulse-dot'

export { StatCard } from './stat-card'
export type { StatCardProps } from './stat-card'

export { Countdown } from './countdown'
export type { CountdownProps } from './countdown'

export { PlayerSelect } from './player-select'
export type { PlayerSelectProps, PlayerSelectSquad } from './player-select'

// --- Toast (F0, ya existente) ---
export { ToastProvider, useToast } from './toast'
export type { ToastTone } from './toast'
