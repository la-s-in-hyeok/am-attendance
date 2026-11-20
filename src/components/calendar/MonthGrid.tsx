import { memo, useMemo, type CSSProperties } from 'react'
import type { CalEvent, DayISO } from '../../lib/types'
import { MAX_LANES, labelDayLong, labelRange, monthWeeks, weekLayout } from './calDates'
import { paletteOf } from './colors'
import { BAR_NO_CALLOUT, type DragView } from './useEventDrag'

/* 칸 크기. 칸 높이는 화면 높이에 맞춰 밖(CalendarPage)에서 정하고, 그 높이에 들어가는 만큼 막대 줄을 보여요 */
export const NUM_H = 21 // 날짜 숫자 자리
export const BAR_H = 18
export const BAR_GAP = 1
/** 가장 작은 칸 높이 (막대 3줄) */
export const MIN_CELL_H = NUM_H + MAX_LANES * (BAR_H + BAR_GAP) + 2
/** 그날 보기(달력이 작아졌을 때)의 한 주 높이 */
export const COMPACT_H = 52
/** 작은 화면(아이폰 SE 등 높이 740px 미만)에서는 그날 보기 달력을 조금 더 낮게 (아래 일정 목록이 + 버튼에 덜 가리게) */
const COMPACT_H_SMALL = 44
export function compactH(): number {
  return typeof window !== 'undefined' && window.innerHeight < 740 ? COMPACT_H_SMALL : COMPACT_H
}
/** 그날 보기에서 날짜 아래 색 점 수 */
const MAX_DOTS = 3

/** 칸 높이에 들어가는 막대 줄 수 (최소 3줄) */
export function lanesFor(cellHeight: number): number {
  return Math.max(MAX_LANES, Math.floor((cellHeight - NUM_H - 2) / (BAR_H + BAR_GAP)))
}

const DAY_TONE = ['text-danger', 'text-ink-2', 'text-ink-2', 'text-ink-2', 'text-ink-2', 'text-ink-2', 'text-brand-ink']

/** 그날 보기를 열고 닫을 때 칸 높이·숫자 크기가 바뀌는 움직임 */
const MORPH = '0.46s var(--ease-ios)'

export interface MonthGridProps {
  /** YYYY-MM */
  month: string
  events: CalEvent[]
  today: DayISO
  selectedDay: DayISO
  /** 한 주(줄)의 높이 px (달력 전체 보기일 때) */
  cellHeight: number
  /** 그날 보기: 줄이 낮아지고 막대 대신 색 점 */
  compact: boolean
  /** 줄 높이가 바뀔 때 부드럽게 (그날 보기를 열고 닫는 동안만) */
  animate: boolean
  /** 지금 보는 달(가운데)인지. 옆 달은 넘기는 동안 보이기만 하고 누를 수 없어요 */
  active: boolean
  /** 날짜 칸을 눌렀을 때 */
  onTapDay?: (d: DayISO) => void
  onOpenEvent?: (e: CalEvent) => void
  /** 막대 끌어서 옮기기 (가운데 달만) */
  dragView?: DragView | null
  barHandlers?: (e: CalEvent) => Record<string, unknown>
}

/** 한 달 칸들 (요일 줄은 밖에서 그려요: 달을 넘겨도 그대로 있게) */
export const MonthGrid = memo(function MonthGrid({
  month,
  events,
  today,
  selectedDay,
  cellHeight,
  compact,
  animate,
  active,
  onTapDay,
  onOpenEvent,
  dragView = null,
  barHandlers,
}: MonthGridProps) {
  const weeks = useMemo(() => monthWeeks(month), [month])
  const maxLanes = lanesFor(cellHeight)
  const layouts = useMemo(() => weeks.map((w) => weekLayout(w, events, maxLanes)), [weeks, events, maxLanes])
  const rowH = compact ? compactH() : cellHeight
  // 막대 ↔ 색 점: 사라지는 쪽은 빨리, 나타나는 쪽은 조금 뒤에 (둘이 겹쳐 지저분해 보이지 않게)
  const fade = (on: boolean): CSSProperties => ({ opacity: on ? 1 : 0, transition: on ? 'opacity 0.3s ease-out 0.12s' : 'opacity 0.12s ease-out' })

  return (
    <div className="select-none" inert={!active} aria-hidden={!active || undefined}>
      {weeks.map((week, wi) => {
        const { segments, hidden } = layouts[wi]
        // 날마다 색 점 (막대와 같은 순서로 위에서부터 3개)
        const dots = week.map((_, i) =>
          segments
            .filter((s) => s.col <= i && i < s.col + s.span)
            .sort((a, b) => a.lane - b.lane)
            .slice(0, MAX_DOTS),
        )
        return (
          <div
            key={week[0]}
            className={`relative border-t border-line/80 ${compact || animate ? 'overflow-hidden' : ''}`}
            style={{ height: rowH, transition: animate ? `height ${MORPH}` : undefined }}
          >
            <div className="absolute inset-0 grid grid-cols-7">
              {week.map((d, i) => {
                const inMonth = d.startsWith(month)
                const isToday = d === today
                const selected = d === selectedDay
                const hover = dragView?.hoverDay === d
                const total = segments.filter((s) => s.col <= i && i < s.col + s.span).length
                return (
                  <button
                    key={d}
                    type="button"
                    data-day={d}
                    onClick={() => onTapDay?.(d)}
                    aria-pressed={selected}
                    aria-label={`${labelDayLong(d)}${isToday ? ', 오늘' : ''}${total ? `, 일정 ${total}개` : ''}`}
                    // 버튼은 내용을 세로 가운데에 두므로, 날짜 숫자를 칸 맨 위에 붙이려고 flex-col + justify-start.
                    // 초점 테두리는 칸 안쪽에 그려요 (칸을 위로 올리면 그 칸의 일정 막대를 덮어서 눌리지 않아요)
                    className={`relative flex h-full min-w-0 flex-col justify-start text-left transition-colors duration-300 focus-visible:-outline-offset-2 ${
                      hover ? 'bg-brand-soft ring-2 ring-brand ring-inset' : selected && !compact ? 'bg-brand-soft' : compact ? '' : 'hover:bg-hover'
                    }`}
                  >
                    <span className="flex justify-center pt-0.5">
                      <span
                        className={`tabular inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-full px-1 text-[12px] leading-none ${
                          isToday
                            ? 'bg-brand font-bold text-white'
                            : `${DAY_TONE[i]} ${selected ? 'font-bold' : 'font-semibold'} ${selected && compact ? 'bg-ink/10' : 'bg-transparent'}`
                        } ${inMonth || isToday ? '' : 'opacity-40'}`}
                        style={{
                          // 그날 보기에서는 숫자를 조금 크게 (transform 만 바꿔서 부드럽게)
                          transform: compact ? 'translate3d(0, 5px, 0) scale(1.32)' : 'translate3d(0, 0, 0) scale(1)',
                          transformOrigin: '50% 0',
                          transition: `transform ${MORPH}, background-color 0.25s ease-out`,
                        }}
                      >
                        {Number(d.slice(8))}
                      </span>
                    </span>
                    {hidden[i] > 0 && (
                      <span
                        className="absolute inset-x-0.5 truncate rounded px-1 text-[11px] leading-[18px] font-bold text-ink-3"
                        style={{ top: NUM_H + (maxLanes - 1) * (BAR_H + BAR_GAP), height: BAR_H, ...fade(!compact) }}
                      >
                        +{hidden[i]}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* 그날 보기: 날짜 아래 색 점 */}
            <div className="pointer-events-none absolute inset-x-0 top-[34px] grid grid-cols-7" aria-hidden="true" style={fade(compact)}>
              {week.map((d, i) => (
                <span key={d} className={`flex justify-center gap-[3px] ${d.startsWith(month) ? '' : 'opacity-45'}`}>
                  {dots[i].map((s) => (
                    <span key={s.event.id} className="h-[5px] w-[5px] rounded-full" style={{ background: paletteOf(s.event.color).dot }} />
                  ))}
                </span>
              ))}
            </div>

            {/* 달력 전체 보기: 일정 막대 (그날 보기에서는 숨어요) */}
            {segments
              .filter((s) => s.visible)
              .map((s) => {
                const p = paletteOf(s.event.color)
                const padL = s.contLeft ? 0 : 2
                const padR = s.contRight ? 0 : 2
                const dragging = dragView?.id === s.event.id
                return (
                  <button
                    key={`${s.event.id}|${week[0]}`}
                    type="button"
                    data-event-id={s.event.id}
                    {...(active && !compact ? barHandlers?.(s.event) : undefined)}
                    // 막대를 눌러도 날짜를 누른 것처럼 그날 보기가 열려요 (칸 어디를 눌러도 같게). 회의록은 그날 보기 목록에서 열어요.
                    // 여러 날에 걸친 막대는 손가락이 닿은 날로 (키보드로 누르면 이 주에 보이는 첫날)
                    onClick={(e) => {
                      if (!onTapDay) return onOpenEvent?.(s.event)
                      const r = e.currentTarget.getBoundingClientRect()
                      const off = e.detail > 0 && r.width > 0 ? Math.floor(((e.clientX - r.left) / r.width) * s.span) : 0
                      onTapDay(week[Math.min(6, s.col + Math.max(0, Math.min(s.span - 1, off)))])
                    }}
                    tabIndex={compact ? -1 : undefined}
                    aria-hidden={compact || undefined}
                    aria-label={`${s.event.title}, ${labelRange(s.event.startDate, s.event.endDate)}. ${onTapDay ? '그날 보기' : '회의록 열기'}`}
                    className={`absolute flex items-center overflow-hidden px-[3px] text-left text-[11px] leading-none font-semibold tracking-[-0.03em] focus-visible:z-10 ${
                      s.contLeft ? 'rounded-l-none' : 'rounded-l-[5px]'
                    } ${s.contRight ? 'rounded-r-none' : 'rounded-r-[5px]'} ${compact ? 'pointer-events-none' : ''}`}
                    style={{
                      ...BAR_NO_CALLOUT,
                      top: NUM_H + s.lane * (BAR_H + BAR_GAP),
                      height: BAR_H,
                      left: `calc(${s.col} * 100% / 7 + ${padL}px)`,
                      width: `calc(${s.span} * 100% / 7 - ${padL + padR}px)`,
                      background: p.bg,
                      color: p.ink,
                      ...fade(!compact),
                      ...(dragging && !compact ? { opacity: 0.4 } : null),
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
})
