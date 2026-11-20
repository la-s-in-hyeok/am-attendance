import { useMemo, useRef } from 'react'
import type { CalEvent, DayISO } from '../../lib/types'
import { MAX_LANES, WEEKDAYS, labelDayLong, labelRange, monthWeeks, weekLayout } from './calDates'
import { paletteOf } from './colors'
import { BAR_NO_CALLOUT, useEventDrag } from './useEventDrag'

/* 칸 크기. 칸 높이는 화면 높이에 맞춰 밖(CalendarPage)에서 정하고, 그 높이에 들어가는 만큼 막대 줄을 보여요 */
export const NUM_H = 21 // 날짜 숫자 자리
export const BAR_H = 18
export const BAR_GAP = 1
/** 가장 작은 칸 높이 (막대 3줄) */
export const MIN_CELL_H = NUM_H + MAX_LANES * (BAR_H + BAR_GAP) + 2

/** 칸 높이에 들어가는 막대 줄 수 (최소 3줄) */
export function lanesFor(cellHeight: number): number {
  return Math.max(MAX_LANES, Math.floor((cellHeight - NUM_H - 2) / (BAR_H + BAR_GAP)))
}

const DAY_TONE = ['text-danger', 'text-ink-2', 'text-ink-2', 'text-ink-2', 'text-ink-2', 'text-ink-2', 'text-brand-ink']

export function MonthGrid({
  month,
  events,
  today,
  selectedDay,
  onSelectDay,
  onOpenEvent,
  onMove,
  cellHeight = MIN_CELL_H,
}: {
  /** YYYY-MM */
  month: string
  /** 한 주(줄)의 높이 px */
  cellHeight?: number
  events: CalEvent[]
  today: DayISO
  selectedDay: DayISO
  /** 날짜 칸을 눌렀을 때 (hidden = 그 칸에서 '+N' 으로 가려진 일정 수) */
  onSelectDay: (d: DayISO, hidden: number) => void
  onOpenEvent: (e: CalEvent) => void
  /** 막대를 다른 칸에 놓았을 때 (잡은 날 기준으로 며칠 옮길지) */
  onMove: (e: CalEvent, grabDay: DayISO, dropDay: DayISO) => void
}) {
  const gridRef = useRef<HTMLDivElement>(null)
  const { view, barHandlers } = useEventDrag(gridRef, onMove)
  const weeks = useMemo(() => monthWeeks(month), [month])
  const maxLanes = lanesFor(cellHeight)
  const layouts = useMemo(() => weeks.map((w) => weekLayout(w, events, maxLanes)), [weeks, events, maxLanes])

  return (
    <div ref={gridRef} className="touch-manipulation select-none" style={{ touchAction: 'manipulation' }}>
      <div className="grid grid-cols-7 pb-1" aria-hidden="true">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={`text-center text-[12px] font-bold ${i === 0 ? 'text-danger' : i === 6 ? 'text-brand-ink' : 'text-ink-3'}`}>
            {w}
          </div>
        ))}
      </div>
      {weeks.map((week, wi) => {
        const { segments, hidden } = layouts[wi]
        return (
          <div key={week[0]} className="relative border-t border-line/80" style={{ height: cellHeight }}>
            <div className="absolute inset-0 grid grid-cols-7">
              {week.map((d, i) => {
                const inMonth = d.startsWith(month)
                const isToday = d === today
                const selected = d === selectedDay
                const hover = view?.hoverDay === d
                const count = segments.filter((s) => s.col <= i && i < s.col + s.span).length
                return (
                  <button
                    key={d}
                    type="button"
                    data-day={d}
                    onClick={() => onSelectDay(d, hidden[i])}
                    aria-pressed={selected}
                    aria-label={`${labelDayLong(d)}${isToday ? ', 오늘' : ''}${count ? `, 일정 ${count}개` : ''}`}
                    // 버튼은 내용을 세로 가운데에 두므로, 날짜 숫자를 칸 맨 위에 붙이려고 flex-col + justify-start.
                    // 초점 테두리는 칸 안쪽에 그려요 (칸을 위로 올리면 그 칸의 일정 막대를 덮어서 눌리지 않아요)
                    className={`relative flex h-full min-w-0 flex-col justify-start text-left transition-colors focus-visible:-outline-offset-2 ${
                      hover ? 'bg-brand-soft ring-2 ring-brand ring-inset' : selected ? 'bg-brand-soft' : 'hover:bg-hover'
                    }`}
                  >
                    <span className="flex justify-center pt-0.5">
                      <span
                        className={`tabular inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-full px-1 text-[12px] leading-none ${
                          isToday ? 'bg-brand font-bold text-white' : `${DAY_TONE[i]} ${selected ? 'font-bold' : 'font-semibold'}`
                        } ${inMonth || isToday ? '' : 'opacity-40'}`}
                      >
                        {Number(d.slice(8))}
                      </span>
                    </span>
                    {hidden[i] > 0 && (
                      <span
                        className="absolute inset-x-0.5 truncate rounded px-1 text-[11px] leading-[18px] font-bold text-ink-3"
                        style={{ top: NUM_H + (maxLanes - 1) * (BAR_H + BAR_GAP), height: BAR_H }}
                      >
                        +{hidden[i]}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            {segments
              .filter((s) => s.visible)
              .map((s) => {
                const p = paletteOf(s.event.color)
                const padL = s.contLeft ? 0 : 2
                const padR = s.contRight ? 0 : 2
                const dragging = view?.id === s.event.id
                return (
                  <button
                    key={`${s.event.id}|${week[0]}`}
                    type="button"
                    data-event-id={s.event.id}
                    {...barHandlers(s.event)}
                    onClick={() => onOpenEvent(s.event)}
                    aria-label={`${s.event.title}, ${labelRange(s.event.startDate, s.event.endDate)}. 회의록 열기`}
                    className={`absolute flex items-center overflow-hidden px-[3px] text-left text-[11px] leading-none font-semibold tracking-[-0.03em] transition-opacity focus-visible:z-10 ${
                      s.contLeft ? 'rounded-l-none' : 'rounded-l-[5px]'
                    } ${s.contRight ? 'rounded-r-none' : 'rounded-r-[5px]'} ${dragging ? 'opacity-40' : ''}`}
                    style={{
                      ...BAR_NO_CALLOUT,
                      top: NUM_H + s.lane * (BAR_H + BAR_GAP),
                      height: BAR_H,
                      left: `calc(${s.col} * 100% / 7 + ${padL}px)`,
                      width: `calc(${s.span} * 100% / 7 - ${padL + padR}px)`,
                      background: p.bg,
                      color: p.ink,
                    }}
                  >
                    {/* 휴대폰 칸은 좁아서 '…' 대신 잘라서 한 글자라도 더 보여요 */}
                    <span className="min-w-0 overflow-hidden whitespace-nowrap">{s.event.title}</span>
                  </button>
                )
              })}
          </div>
        )
      })}
    </div>
  )
}
