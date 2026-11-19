import { useStore } from '../../store'
import { addDays, currentSunday, labelMD } from '../../lib/dates'
import { Icon } from '../ui'

/** ‹ 11월 15일 › — 목장 화면 위쪽에 들어가는 작은 주일 이동 */
export function CompactWeekSwitcher() {
  const date = useStore((s) => s.date)
  const setDate = useStore((s) => s.setDate)
  const thisSunday = currentSunday()
  const canNext = date < addDays(thisSunday, 7)
  const btn = 'flex h-11 w-11 items-center justify-center rounded-full text-ink-2 transition hover:bg-black/5 active:bg-black/10 disabled:opacity-30'
  return (
    <div className="flex shrink-0 items-center rounded-full bg-surface shadow-[var(--shadow-card)]">
      <button type="button" aria-label="지난 주일" className={btn} onClick={() => setDate(addDays(date, -7))}>
        <Icon name="chevronLeft" size={18} />
      </button>
      <span className="tabular px-0.5 text-sm font-bold whitespace-nowrap">{labelMD(date)}</span>
      <button
        type="button"
        aria-label="다음 주일"
        className={btn}
        disabled={!canNext}
        onClick={() => canNext && setDate(addDays(date, 7))}
      >
        <Icon name="chevronRight" size={18} />
      </button>
    </div>
  )
}
