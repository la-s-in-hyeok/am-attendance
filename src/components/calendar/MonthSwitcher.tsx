import { labelMonth, monthKey, todayKST } from '../../lib/dates'
import { IconButton } from '../ui'
import { addMonths } from './calDates'
import { useCalendar } from './useCalendar'

/** 파란 띠 안의 ‹ 2026년 11월 › (지난달 / 다음 달). 이번 달이 아니면 '오늘' 버튼 */
export function MonthSwitcher() {
  const month = useCalendar((s) => s.viewMonth)
  const setMonth = useCalendar((s) => s.setMonth)
  const goToday = useCalendar((s) => s.goToday)
  const thisMonth = monthKey(todayKST())
  const isThis = month === thisMonth
  const arrow = 'text-white hover:bg-white/10 active:bg-white/15'
  return (
    <div className="flex min-h-12 w-full items-center gap-1 rounded-full bg-brand-deep p-0.5 text-white">
      <IconButton icon="chevronLeft" label="지난달" className={`h-11 w-11 ${arrow}`} onClick={() => setMonth(addMonths(month, -1))} />
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-x-2" aria-live="polite">
        <span className="tabular truncate text-[16px] font-bold">{labelMonth(month)}</span>
        {isThis && (
          <span className="inline-flex h-[22px] shrink-0 items-center rounded-full bg-accent px-2 text-[12px] font-bold text-accent-ink">이번 달</span>
        )}
      </div>
      <IconButton icon="chevronRight" label="다음 달" className={`h-11 w-11 ${arrow}`} onClick={() => setMonth(addMonths(month, 1))} />
      {!isThis && (
        <button
          type="button"
          onClick={goToday}
          className="relative mr-1 ml-1 h-9 shrink-0 rounded-full bg-white px-3 text-[13px] font-semibold whitespace-nowrap text-brand after:absolute after:inset-x-0 after:-inset-y-1"
        >
          오늘
        </button>
      )}
    </div>
  )
}
