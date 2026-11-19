import { Icon, type IconName } from '../ui'

/** 받기·인쇄 버튼 (휴대폰: 아이콘 위·글 아래, PC: 한 줄) */
export function ActionTile({
  icon,
  label,
  loading,
  disabled,
  onClick,
}: {
  icon: IconName
  label: string
  loading?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-[76px] flex-col items-center justify-center gap-1.5 rounded-[var(--radius-card)] bg-surface text-[13px] font-semibold text-ink shadow-[var(--shadow-card)] transition hover:bg-[#fafaf7] active:scale-[0.98] disabled:opacity-60 sm:h-14 sm:flex-row sm:gap-2 sm:text-[14px]"
    >
      {loading ? (
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-ink" aria-hidden="true" />
      ) : (
        <Icon name={icon} size={21} />
      )}
      {loading ? '만드는 중…' : label}
    </button>
  )
}
