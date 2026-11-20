import { labelMonth, monthKey, todayKST } from '../../lib/dates'
import { IconButton } from '../ui'
import { addMonths } from './calDates'
import { useCalendar } from './useCalendar'

/**
 * 파란 띠 안의 ‹ 2026년 11월 › (지난달 / 다음 달).
 * 화살표는 늘 양 끝 같은 자리, 달 이름은 가운데. 이번 달이 아니면 › 바로 왼쪽에 '오늘'이 살며시 나타나요
 * (오늘 버튼 때문에 화살표가 밀리지 않게 자리를 따로 둬요)
 */
export function MonthSwitcher() {
  const month = useCalendar((s) => s.viewMonth)
  const setMonth = useCalendar((s) => s.setMonth)
  const goToday = useCalendar((s) => s.goToday)
  const thisMonth = monthKey(todayKST())
  const isThis = month === thisMonth
  const arrow = 'text-white hover:bg-white/10 active:bg-white/15'
  return (
    <div className="relative flex min-h-12 w-full items-center rounded-full bg-brand-deep p-0.5 text-white">
      <IconButton icon="chevronLeft" label="지난달" className={`h-11 w-11 ${arrow}`} onClick={() => setMonth(addMonths(month, -1))} />
      <div className="flex min-w-0 flex-1 items-center justify-center gap-x-2" aria-live="polite">
        <span className="tabular truncate text-[16px] font-bold max-[359px]:text-[15px]">{labelMonth(month)}</span>
        {isThis && (
          <span className="anim-fade inline-flex h-[22px] shrink-0 items-center rounded-full bg-accent px-2 text-[12px] font-bold text-accent-ink">
            이번 달
          </span>
        )}
      </div>
      {/* 오늘: › 화살표 왼쪽 (화살표는 움직이지 않아요). 이번 달이면 숨어요 */}
      <button
        type="button"
        onClick={goToday}
        inert={isThis}
        aria-hidden={isThis}
        className={`absolute right-12 h-8 shrink-0 rounded-full bg-white px-2.5 text-[13px] font-semibold whitespace-nowrap text-brand transition-[opacity,scale] duration-300 ease-[var(--ease-ios)] after:absolute after:inset-x-0 after:-inset-y-1.5 active:scale-95 ${
          isThis ? 'pointer-events-none scale-90 opacity-0' : 'scale-100 opacity-100'
        }`}
      >
        오늘
      </button>
      <IconButton icon="chevronRight" label="다음 달" className={`h-11 w-11 ${arrow}`} onClick={() => setMonth(addMonths(month, 1))} />
    </div>
  )
}
