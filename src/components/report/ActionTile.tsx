import { Icon, type IconName } from '../ui'

/** 받기·인쇄 버튼: 흰 바탕 + 테두리, 아이콘과 글을 한 줄로 (아주 좁은 화면에서는 아이콘 위·글 아래) */
export function ActionTile({
  icon,
  label,
  title,
  loading,
  disabled,
  onClick,
}: {
  icon: IconName
  /** 버튼에 보이는 짧은 글 (예: 엑셀) */
  label: string
  /** 화면 읽기·마우스 올렸을 때 보이는 긴 이름 (예: 엑셀로 받기) */
  title?: string
  loading?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  const name = title ?? label
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={loading ? `${name}, 만드는 중` : name}
      aria-busy={loading || undefined}
      title={name}
      className="flex h-[52px] min-w-0 items-center justify-center gap-1.5 rounded-2xl border border-line bg-surface px-1.5 text-[14px] font-semibold whitespace-nowrap text-ink transition hover:bg-hover active:scale-[0.98] active:bg-muted disabled:opacity-60 max-[359px]:flex-col max-[359px]:gap-0.5 max-[359px]:text-[13px] md:gap-2 md:text-[15px]"
    >
      {loading ? (
        <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-line border-t-brand" aria-hidden="true" />
      ) : (
        <Icon name={icon} size={20} strokeWidth={2} className="shrink-0 text-brand" />
      )}
      {loading ? '만드는 중' : label}
    </button>
  )
}
