import type { CalEvent, DayISO } from '../../lib/types'
import { useState } from 'react'
import { Button, Icon, Sheet } from '../ui'
import { covers, compareEvents, labelDayLong, labelRange } from './calDates'
import { paletteOf } from './colors'

/** 일정 한 줄 (색 점 · 제목 · 기간 · 회의록 있으면 📝). 누르면 회의록 */
export function EventRow({ event, onOpen }: { event: CalEvent; onOpen: (e: CalEvent) => void }) {
  const p = paletteOf(event.color)
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(event)}
        className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition hover:bg-hover active:bg-muted"
      >
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: p.dot }} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold leading-snug [overflow-wrap:anywhere]">
            {event.title}
            {event.hasNote && (
              <span className="ml-1.5 text-[13px]" role="img" aria-label="회의록 있음">
                📝
              </span>
            )}
          </span>
          <span className="tabular mt-0.5 block text-[13px] text-ink-3">{labelRange(event.startDate, event.endDate)}</span>
        </span>
        <Icon name="chevronRight" size={18} className="shrink-0 text-ink-3" />
      </button>
    </li>
  )
}

/** 한 날의 일정 창: 날짜를 한 번 더 누르거나 '+N' 칸을 누르면 열려요 */
export function DaySheet({
  day,
  today,
  events,
  onClose,
  onOpen,
  onAdd,
}: {
  /** null 이면 닫힘 */
  day: DayISO | null
  today: DayISO
  events: CalEvent[]
  onClose: () => void
  onOpen: (e: CalEvent) => void
  onAdd: (day: DayISO) => void
}) {
  // 닫히는 동안에도 내용이 남아 있게 마지막 날짜를 기억해요
  const [shown, setShown] = useState<DayISO | null>(day)
  if (day && day !== shown) setShown(day)
  const d = day ?? shown
  const list = d ? events.filter((e) => covers(e, d)).sort(compareEvents) : []
  return (
    <Sheet
      open={day !== null}
      onClose={onClose}
      title={
        d && (
          <span className="inline-flex items-center gap-2">
            {labelDayLong(d)}
            {d === today && (
              <span className="inline-flex h-[22px] items-center rounded-full bg-brand-soft px-2 text-[12px] font-bold text-brand-ink">오늘</span>
            )}
          </span>
        )
      }
    >
      {list.length > 0 ? (
        <ul className="-mx-2">
          {list.map((e) => (
            <EventRow key={e.id} event={e} onOpen={onOpen} />
          ))}
        </ul>
      ) : (
        <p className="py-2 text-[15px] text-ink-3">이 날에는 일정이 없어요</p>
      )}
      <Button variant="secondary" icon="plus" className="mt-3 w-full" onClick={() => d && onAdd(d)}>
        이 날에 일정 추가
      </Button>
    </Sheet>
  )
}
