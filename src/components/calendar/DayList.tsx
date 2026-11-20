import { useRef, useState } from 'react'
import type { CalEvent, DayISO } from '../../lib/types'
import { dayOfWeek } from '../../lib/dates'
import { EASE_IOS, Icon, IconButton } from '../ui'
import { WEEKDAYS, compareEvents, covers, labelDayLong, labelRange } from './calDates'
import { paletteOf } from './colors'

/** 일정 한 줄 (색 막대 · 제목 · 기간 · 회의록 있으면 📝). 누르면 회의록 */
export function EventRow({ event, onOpen }: { event: CalEvent; onOpen: (e: CalEvent) => void }) {
  const p = paletteOf(event.color)
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(event)}
        className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors hover:bg-hover active:bg-muted"
      >
        <span className="w-1 shrink-0 self-stretch rounded-full" style={{ background: p.dot }} aria-hidden="true" />
        <span className="min-w-0 flex-1 py-0.5">
          <span className="block text-[16px] leading-snug font-semibold [overflow-wrap:anywhere]">
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

const WEEKDAY_TONE = ['text-danger', 'text-ink', 'text-ink', 'text-ink', 'text-ink', 'text-ink', 'text-brand-ink']

/**
 * 그날 보기의 아래 칸: 날짜를 누르면 달력이 작아지고 그 아래에 올라와요 (창이 아니라 화면의 일부).
 * '24. 화' 제목 + 그날 일정. 손잡이를 아래로 끌거나, 같은 날짜를 한 번 더 누르거나, 뒤로 가기면 닫혀요.
 */
export function DayPanel({
  day,
  today,
  events,
  closing,
  minHeight,
  onOpen,
  onClose,
}: {
  day: DayISO
  today: DayISO
  events: CalEvent[]
  /** 닫히는 중 (달력이 다시 커지는 동안 살며시 사라져요) */
  closing: boolean
  /** 화면 아래(아래 탭 위)까지 채울 높이 */
  minHeight: number
  onOpen: (e: CalEvent) => void
  onClose: () => void
}) {
  const list = events.filter((e) => covers(e, day)).sort(compareEvents)
  const wd = dayOfWeek(day)
  const panelRef = useRef<HTMLElement>(null)
  const drag = useRef<{ id: number; y0: number; active: boolean; samples: { y: number; t: number }[] } | null>(null)
  /** 끌어서 닫았는지 (그러면 끌던 자리에서 이어서 사라져요) */
  const [draggedOut, setDraggedOut] = useState(false)

  /* 손잡이를 아래로 끌어서 닫기 */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || closing) return
    drag.current = { id: e.pointerId, y0: e.clientY, active: false, samples: [{ y: e.clientY, t: e.timeStamp }] }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    const el = panelRef.current
    if (!d || d.id !== e.pointerId || !el) return
    const dy = e.clientY - d.y0
    if (!d.active) {
      if (Math.abs(dy) < 6) return
      d.active = true
      e.currentTarget.setPointerCapture(e.pointerId)
      el.style.animation = 'none'
    }
    // 위로는 고무줄처럼 조금만
    const y = dy >= 0 ? dy : -((-dy * 20) / (-dy + 60))
    el.style.transition = 'none'
    el.style.transform = `translate3d(0, ${y}px, 0)`
    d.samples.push({ y: e.clientY, t: e.timeStamp })
    if (d.samples.length > 6) d.samples.shift()
  }
  const onPointerEnd = (e: React.PointerEvent) => {
    const d = drag.current
    const el = panelRef.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    if (!d.active || !el) return
    const dy = e.clientY - d.y0
    const a = d.samples[0]
    const b = d.samples[d.samples.length - 1]
    const v = b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0
    if (e.type === 'pointerup' && dy > 0 && (dy > 70 || (v > 0.45 && dy > 16))) {
      // 끌던 자리에서 아래로 빠지며 사라져요 (달력은 그동안 다시 커져요)
      el.style.transition = `transform 0.42s ${EASE_IOS}, opacity 0.3s ease-out`
      el.style.transform = `translate3d(0, ${dy + 120}px, 0)`
      el.style.opacity = '0'
      setDraggedOut(true)
      onClose()
      return
    }
    el.style.transition = `transform 0.45s ${EASE_IOS}`
    el.style.transform = 'translate3d(0, 0, 0)'
  }

  return (
    <section
      ref={panelRef}
      aria-label={`${labelDayLong(day)} 일정`}
      className={`relative mt-3 rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] ${closing ? '' : 'anim-rise'}`}
      style={{
        minHeight,
        ...(closing && !draggedOut ? { opacity: 0, transform: 'translate3d(0, 24px, 0)', transition: `opacity 0.26s ease-out, transform 0.46s ${EASE_IOS}` } : null),
      }}
    >
      {/* 손잡이 + 날짜 제목 (여기를 아래로 끌면 닫혀요) */}
      <div className="touch-none select-none" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}>
        <div className="flex justify-center pt-2" aria-hidden="true">
          <span className="h-[5px] w-9 rounded-full bg-line" />
        </div>
        <div className="flex items-center gap-2 pt-1 pr-2 pb-2 pl-5">
          <h2 className="flex min-w-0 flex-1 items-baseline gap-1.5">
            <span className="sr-only">{labelDayLong(day)}</span>
            <span aria-hidden="true" className="tabular text-[26px] leading-none font-bold tracking-tight text-ink">
              {Number(day.slice(8))}.
            </span>
            <span aria-hidden="true" className={`text-[20px] leading-none font-semibold ${WEEKDAY_TONE[wd]}`}>
              {WEEKDAYS[wd]}
            </span>
            {day === today && (
              <span className="ml-1 inline-flex h-[22px] items-center self-center rounded-full bg-brand-soft px-2 text-[12px] font-bold text-brand-ink">오늘</span>
            )}
          </h2>
          <IconButton icon="chevronDown" label="달력 크게 보기" onClick={onClose} className="text-ink-3" />
        </div>
      </div>

      {/* 날짜를 바꾸면 목록이 살며시 바뀌어요 */}
      <div key={day} className="anim-fade px-2 pb-24">
        {list.length > 0 ? (
          // 오른쪽은 + 버튼(56px)만큼 비워 둬요: 작은 화면에서도 일정 줄의 › 가 버튼에 가리지 않게
          <ul className="pr-[4.25rem]">
            {list.map((e) => (
              <EventRow key={e.id} event={e} onOpen={onOpen} />
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-3 px-3 py-3 text-[15px] text-ink-3">
            <span className="h-6 w-1 shrink-0 rounded-full bg-line" aria-hidden="true" />
            일정이 없어요
          </p>
        )}
      </div>
    </section>
  )
}
