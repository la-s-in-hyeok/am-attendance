import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CalEvent, DayISO } from '../lib/types'
import { addDays, todayKST } from '../lib/dates'
import { Button, Card, Confirm, Icon, PageHeader } from '../components/ui'
import { useCalendar } from '../components/calendar/useCalendar'
import { MonthSwitcher } from '../components/calendar/MonthSwitcher'
import { MIN_CELL_H, MonthGrid } from '../components/calendar/MonthGrid'
import { DaySheet } from '../components/calendar/DayList'
import { EventSheet, type SheetTarget } from '../components/calendar/EventSheet'
import { EventNotePage } from '../components/calendar/EventNotePage'
import { diffDays, monthWeeks } from '../components/calendar/calDates'
import { afterHistorySettles, dropStaleNoteEntry } from '../components/calendar/noteHistory'
import { useStore } from '../store'

/** + 버튼 위와 달력 사이 여백 */
const FAB_GAP = 8

/** 청년회 캘린더 탭: 화면을 꽉 채운 달력 + 오른쪽 아래 + 버튼. 일정을 누르면 회의록 */
export function CalendarPage() {
  const events = useCalendar((s) => s.events)
  const month = useCalendar((s) => s.viewMonth)
  const selectedDay = useCalendar((s) => s.selectedDay)

  const [noteId, setNoteId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<SheetTarget | null>(null)
  const [askDelete, setAskDelete] = useState<CalEvent | null>(null)
  /** 회의록을 열기 전 달력 스크롤 위치 (닫으면 돌아가요) */
  const savedScroll = useRef<number | null>(null)
  /** 닫은 회의록의 일정 (달력이 다시 보이면 그 막대에 초점을 돌려줘요: 키보드·화면 읽기 사용자) */
  const focusBack = useRef<string | null>(null)
  const today = todayKST()

  // 화면이 보이는 동안: 불러오기 + 실시간 알림 + 30초 새로고침
  useEffect(() => {
    dropStaleNoteEntry()
    void useCalendar.getState().load()
    return useCalendar.getState().start()
  }, [])

  const openNote = useCallback((e: CalEvent) => {
    savedScroll.current = window.scrollY
    setNoteId(e.id)
    window.scrollTo(0, 0)
  }, [])
  const closeNote = useCallback(() => {
    setNoteId((id) => {
      if (id) focusBack.current = id
      return null
    })
  }, [])

  // 아래 탭(또는 PC 메뉴)의 '캘린더'를 한 번 더 누르면 회의록을 닫고 달력으로 (닫힐 때 마지막 글은 저장돼요)
  const retap = useStore((s) => s.tabRetap)
  const seenRetap = useRef(retap)
  useEffect(() => {
    if (retap === seenRetap.current) return
    seenRetap.current = retap
    closeNote()
  }, [retap, closeNote])

  // 회의록을 닫으면 보던 자리로, 초점은 그 일정 막대로
  useLayoutEffect(() => {
    if (noteId !== null) return
    if (savedScroll.current !== null) {
      const y = savedScroll.current
      savedScroll.current = null
      window.scrollTo(0, y)
    }
    const id = focusBack.current
    focusBack.current = null
    if (id) document.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true })
  }, [noteId])

  const onMove = useCallback((e: CalEvent, grabDay: DayISO, dropDay: DayISO) => {
    // 잡은 날 기준: 둘째 날을 잡고 놓으면 그 날이 놓은 칸이 되도록
    void useCalendar.getState().move(e.id, addDays(e.startDate, diffDays(grabDay, dropDay)))
  }, [])


  const sheets = (
    <>
      <EventSheet
        target={sheet}
        onClose={() => setSheet(null)}
        onDeleted={(id) => {
          if (id === noteId) closeNote()
        }}
      />
      <Confirm
        open={askDelete !== null}
        title="일정 지우기"
        message={askDelete ? `‘${askDelete.title}’ 일정과 회의록을 지울까요?` : undefined}
        confirmLabel="지우기"
        danger
        onClose={() => setAskDelete(null)}
        onConfirm={() => {
          if (!askDelete) return
          const id = askDelete.id
          void useCalendar.getState().remove(id)
          // 확인 창이 '뒤로 가기' 기록을 치운 다음에 회의록을 닫아요
          afterHistorySettles(() => {
            if (id === noteId) closeNote()
          })
        }}
      />
    </>
  )

  // 창들은 회의록을 열고 닫아도 같은 자리에 두어서 새로 만들어지지 않게 해요
  return (
    <>
      {noteId ? (
        <EventNotePage eventId={noteId} onClose={closeNote} onEdit={(e) => setSheet({ mode: 'edit', event: e })} onDelete={setAskDelete} />
      ) : (
        <CalendarView
          month={month}
          events={events}
          today={today}
          selectedDay={selectedDay}
          onAdd={(d) => setSheet({ mode: 'add', date: d })}
          onOpen={openNote}
          onMove={onMove}
        />
      )}
      {sheets}
    </>
  )
}

function CalendarView({
  month,
  events,
  today,
  selectedDay,
  onAdd,
  onOpen,
  onMove,
}: {
  month: string
  events: CalEvent[]
  today: DayISO
  selectedDay: DayISO
  onAdd: (d: DayISO) => void
  onOpen: (e: CalEvent) => void
  onMove: (e: CalEvent, grabDay: DayISO, dropDay: DayISO) => void
}) {
  const status = useCalendar((s) => s.status)
  const error = useCalendar((s) => s.error)
  const selectDay = useCalendar((s) => s.selectDay)
  /** 일정 목록 창을 연 날 (날짜를 한 번 더 누르거나 '+N' 칸을 눌렀을 때) */
  const [dayOpen, setDayOpen] = useState<DayISO | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const fabRef = useRef<HTMLButtonElement>(null)
  const weeks = monthWeeks(month).length
  const cellHeight = useFillHeight(rootRef, gridRef, fabRef, weeks)

  const onSelectDay = (d: DayISO, hidden: number) => {
    if (d === selectedDay || hidden > 0) setDayOpen(d)
    selectDay(d)
  }

  return (
    <div ref={rootRef}>
      <PageHeader title="캘린더" nav={<MonthSwitcher />} />

      {error?.setup && (
        <div className="mb-3 rounded-[var(--radius-card)] border border-accent bg-accent-soft p-4" role="alert">
          <p className="font-bold text-accent-soft-ink">캘린더를 쓰려면 서버 설정을 새로 해야 해요</p>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{error.message}</p>
        </div>
      )}
      {error && !error.setup && (
        <Card className="mb-3 flex items-center gap-3 p-4" role="alert">
          <p className="min-w-0 flex-1 text-[15px] font-semibold text-danger">{error.message}</p>
          <Button variant="secondary" size="sm" onClick={() => void useCalendar.getState().load()}>
            다시 시도
          </Button>
        </Card>
      )}

      <Card className="relative px-1 pt-2 pb-1 sm:px-3">
        <div ref={gridRef}>
          <MonthGrid
            month={month}
            events={events}
            today={today}
            selectedDay={selectedDay}
            onSelectDay={onSelectDay}
            onOpenEvent={onOpen}
            onMove={onMove}
            cellHeight={cellHeight}
          />
        </div>
        {status === 'loading' && (
          <p className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-[13px] text-ink-3" role="status">
            일정을 불러오는 중…
          </p>
        )}
      </Card>

      {/* 오른쪽 아래 둥근 + : 고른 날(처음엔 오늘)에 일정 추가. 달력은 이 버튼 위에서 끝나서 칸을 가리지 않아요 (useFillHeight) */}
      <button
        ref={fabRef}
        type="button"
        onClick={() => onAdd(selectedDay)}
        aria-label="일정 추가"
        className="kb-hide fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-[0_6px_18px_rgb(10_114_180/0.38)] transition hover:bg-brand-deep active:scale-95 md:right-8 md:bottom-8"
      >
        <Icon name="plus" size={28} strokeWidth={2.4} />
      </button>

      <DaySheet
        day={dayOpen}
        today={today}
        events={events}
        onClose={() => setDayOpen(null)}
        onOpen={(e) => {
          setDayOpen(null)
          // 창이 '뒤로 가기' 기록을 치운 다음에 회의록을 열어요
          afterHistorySettles(() => onOpen(e))
        }}
        onAdd={(d) => {
          setDayOpen(null)
          afterHistorySettles(() => onAdd(d))
        }}
      />
    </div>
  )
}

/**
 * 달력이 화면 아래까지 꽉 차도록 한 주의 높이를 정해요.
 * - 오른쪽 아래 + 버튼과 겹치면 그 버튼 위에서 끝나요 (토요일 칸의 일정이 버튼에 가려지지 않게).
 * - 페이지가 조금씩 스크롤되지 않도록 본문 아래 여백까지 셈에 넣어요.
 * - 너무 작으면 막대 3줄 높이(MIN_CELL_H), 너무 크면 140px 까지. 작아서 스크롤되더라도 맨 아래는 버튼 위에 와요.
 * 안내 띠가 생기거나 없어지면(ResizeObserver) 다시 맞춰요.
 */
function useFillHeight(
  rootRef: { current: HTMLElement | null },
  /** 달력을 감싼 칸 (그 부모가 카드) */
  gridRef: { current: HTMLElement | null },
  fabRef: { current: HTMLElement | null },
  weeks: number,
): number {
  const [h, setH] = useState(MIN_CELL_H)
  /** 지금 화면에 그려진 한 주 높이 (카드 높이에서 빼서 나머지 부분 높이를 알아내요) */
  const drawn = useRef(h)
  drawn.current = h
  useLayoutEffect(() => {
    const root = rootRef.current
    const card = gridRef.current?.parentElement
    if (!root || !card) return
    const calc = () => {
      const c = card.getBoundingClientRect()
      // 주 줄들을 뺀 카드 끝 자리 (문서 기준)
      const fixedBottom = c.bottom + window.scrollY - weeks * drawn.current
      const main = root.closest('main')
      const mainPad = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0
      // 화면 아래에서 비워 둘 높이: 본문 아래 여백, 그리고 + 버튼과 겹치면 버튼 위까지
      let reserve = mainPad
      const fab = fabRef.current?.getBoundingClientRect()
      if (fab && fab.width > 0 && fab.left < c.right && fab.right > c.left) {
        reserve = Math.max(reserve, window.innerHeight - fab.top + FAB_GAP)
      }
      // 본문 여백보다 더 비워야 하면 이 화면 아래에 덧대요 (스크롤해도 맨 아래 줄이 버튼 위에 오게)
      const extra = Math.max(0, Math.round(reserve - mainPad))
      if (root.style.paddingBottom !== `${extra}px`) root.style.paddingBottom = `${extra}px`
      const rest = window.innerHeight - reserve - fixedBottom
      const next = Math.max(MIN_CELL_H, Math.min(140, Math.floor(rest / weeks)))
      setH((prev) => (prev === next ? prev : next))
    }
    calc()
    let timer = 0
    const later = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(calc, 120)
    }
    // 위쪽 안내 띠가 생기거나 사라지면 화면 높이가 바뀌어요
    let lastH = root.offsetHeight
    let raf = 0
    const ro = new ResizeObserver(() => {
      const nh = root.offsetHeight
      if (nh === lastH) return
      lastH = nh
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(calc)
    })
    ro.observe(root)
    window.addEventListener('resize', later)
    window.addEventListener('orientationchange', later)
    return () => {
      window.clearTimeout(timer)
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', later)
      window.removeEventListener('orientationchange', later)
      root.style.paddingBottom = ''
    }
  }, [rootRef, gridRef, fabRef, weeks])
  return h
}
