import { useStore } from '../../store'
import { addDays, currentSunday, labelMD } from '../../lib/dates'
import { Icon } from '../ui'

/** ‹ 11월 15일 › — 목장 화면 위쪽에 들어가는 작은 주일 이동 */
export function CompactWeekSwitcher() {
  const date = useStore((s) => s.date)
  const setDate = useStore((s) => s.setDate)
  const thisSunday = currentSunday()
  const canNext = date < addDays(thisSunday, 7)
  const btn = 'flex h-11 w-11 items-center justify-center rounded-full text-brand transition hover:bg-brand-soft active:bg-brand-soft disabled:text-ink-3 disabled:opacity-40 disabled:hover:bg-transparent'
  return (
    <div className="flex shrink-0 items-center rounded-full bg-surface shadow-[var(--shadow-card)] ring-1 ring-line">
      <button type="button" aria-label="지난 주일" className={btn} onClick={() => setDate(addDays(date, -7))}>
        <Icon name="chevronLeft" size={18} strokeWidth={2.2} />
      </button>
      <span className="tabular inline-flex items-center gap-1 px-0.5 text-sm font-bold whitespace-nowrap">
        {labelMD(date)}
        {/* 이번 주일이면 띠의 '이번 주' 표시처럼 주황 점 */}
        {date === thisSunday && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="이번 주" role="img" />}
      </span>
      <button
        type="button"
        aria-label="다음 주일"
        className={btn}
        disabled={!canNext}
        onClick={() => canNext && setDate(addDays(date, 7))}
      >
        <Icon name="chevronRight" size={18} strokeWidth={2.2} />
      </button>
    </div>
  )
}
