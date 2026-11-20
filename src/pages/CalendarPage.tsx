import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CalEvent, DayISO } from '../lib/types'
import { addDays, todayKST } from '../lib/dates'
import { Button, Card, Confirm, Icon, PageHeader } from '../components/ui'
import { useCalendar } from '../components/calendar/useCalendar'
import { MonthSwitcher } from '../components/calendar/MonthSwitcher'
import { MIN_CELL_H, compactH } from '../components/calendar/MonthGrid'
import { MonthPager } from '../components/calendar/MonthPager'
import { DayPanel } from '../components/calendar/DayList'
import { EventSheet, type SheetTarget } from '../components/calendar/EventSheet'
import { EventNotePage } from '../components/calendar/EventNotePage'
import { diffDays, monthWeeks } from '../components/calendar/calDates'
import {
  afterHistorySettles,
  dropStaleDayEntry,
  dropStaleNoteEntry,
  isDayEntry,
  popDayEntry,
  pushDayEntry,
} from '../components/calendar/noteHistory'
import { useStore } from '../store'

/** + 버튼 위와 달력 사이 여백 */
const FAB_GAP = 8
/** 그날 보기를 열고 닫는 움직임 시간 (MonthGrid 의 MORPH 와 같게) */
const MORPH_MS = 480
/** 그날 보기 칸과 달력 사이 여백 (DayPanel 의 mt-3) */
const PANEL_GAP = 12

/** 청년회 캘린더 탭: 화면을 꽉 채운 달력 + 오른쪽 아래 + 버튼. 날짜(칸 안의 일정 막대 포함)를 누르면 그날 보기, 그날 보기의 일정을 누르면 회의록 */
export function CalendarPage() {
  const events = useCalendar((s) => s.events)
  const month = useCalendar((s) => s.viewMonth)
  const selectedDay = useCalendar((s) => s.selectedDay)

  const [noteId, setNoteId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<SheetTarget | null>(null)
  const [askDelete, setAskDelete] = useState<CalEvent | null>(null)
  /** 그날 보기(달력이 작아지고 아래에 그날 일정)가 열려 있는지. 회의록을 열었다 닫아도 그대로예요 */
  const [dayOpen, setDayOpen] = useState(false)
  /** 회의록을 열기 전 달력 스크롤 위치 (닫으면 돌아가요) */
  const savedScroll = useRef<number | null>(null)
  /** 닫은 회의록의 일정 (달력이 다시 보이면 그 막대에 초점을 돌려줘요: 키보드·화면 읽기 사용자) */
  const focusBack = useRef<string | null>(null)
  const today = todayKST()

  // 화면이 보이는 동안: 불러오기 + 실시간 알림 + 30초 새로고침
  useEffect(() => {
    dropStaleNoteEntry()
    dropStaleDayEntry()
    void useCalendar.getState().load()
    return useCalendar.getState().start()
  }, [])

  // 그날 보기: 휴대폰 '뒤로 가기'가 그날 보기만 닫도록 기록을 하나 쌓아요 (회의록·창 기록은 그 위에 쌓여요)
  useEffect(() => {
    if (!dayOpen) return
    const token = pushDayEntry()
    let closedByBack = false
    const onPop = () => {
      if (isDayEntry(token)) return
      closedByBack = true
      setDayOpen(false)
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (!closedByBack) popDayEntry(token)
    }
  }, [dayOpen])

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

  // 아래 탭(또는 PC 메뉴)의 '캘린더'를 한 번 더 누르면: 회의록이 열려 있으면 닫고, 아니면 그날 보기를 닫아요
  const retap = useStore((s) => s.tabRetap)
  const seenRetap = useRef(retap)
  const noteOpen = useRef(false)
  noteOpen.current = noteId !== null
  useEffect(() => {
    if (retap === seenRetap.current) return
    seenRetap.current = retap
    if (noteOpen.current) closeNote()
    else setDayOpen(false)
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
    if (id) document.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(id)}"]:not([aria-hidden])`)?.focus({ preventScroll: true })
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
          dayOpen={dayOpen}
          onOpenDay={() => setDayOpen(true)}
          onCloseDay={() => setDayOpen(false)}
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
  dayOpen,
  onOpenDay,
  onCloseDay,
  onAdd,
  onOpen,
  onMove,
}: {
  month: string
  events: CalEvent[]
  today: DayISO
  selectedDay: DayISO
  dayOpen: boolean
  onOpenDay: () => void
  onCloseDay: () => void
  onAdd: (d: DayISO) => void
  onOpen: (e: CalEvent) => void
  onMove: (e: CalEvent, grabDay: DayISO, dropDay: DayISO) => void
}) {
  const status = useCalendar((s) => s.status)
  const error = useCalendar((s) => s.error)
  const setMonth = useCalendar((s) => s.setMonth)
  const rootRef = useRef<HTMLDivElement>(null)
  const pagerRef = useRef<HTMLDivElement>(null)
  const fabRef = useRef<HTMLButtonElement>(null)
  const fill = useFillHeight(rootRef, pagerRef, fabRef, dayOpen)

  // 그날 보기를 닫는 동안에도 아래 칸을 잠깐 남겨 두고(사라지는 움직임), 줄 높이는 그동안만 부드럽게 바꿔요
  const [panelShown, setPanelShown] = useState(dayOpen)
  const [morph, setMorph] = useState(false)
  const [seenOpen, setSeenOpen] = useState(dayOpen)
  /** 그날 보기를 열 때마다 1씩 (닫히는 중에 다시 열면 아래 칸을 새로 만들어서, 끌어서 닫던 모양이 남지 않게) */
  const [openSeq, setOpenSeq] = useState(0)
  if (seenOpen !== dayOpen) {
    setSeenOpen(dayOpen)
    setMorph(true)
    if (dayOpen) {
      setPanelShown(true)
      setOpenSeq((n) => n + 1)
    }
  }
  useEffect(() => {
    if (!morph) return
    const t = window.setTimeout(() => {
      setMorph(false)
      if (!dayOpen) setPanelShown(false)
    }, MORPH_MS)
    return () => window.clearTimeout(t)
  }, [morph, dayOpen])

  const compact = dayOpen
  const onTapDay = useCallback(
    (d: DayISO) => {
      const s = useCalendar.getState()
      // 그날 보기에서 고른 날짜를 한 번 더 누르면 달력을 다시 크게
      if (dayOpen && d === s.selectedDay) {
        onCloseDay()
        return
      }
      // 지난달·다음 달 칸의 날짜면 그 달로 넘어가요
      if (d.slice(0, 7) !== s.viewMonth) s.showDay(d)
      else s.selectDay(d)
      if (!dayOpen) onOpenDay()
    },
    [dayOpen, onOpenDay, onCloseDay],
  )

  const compactRows = monthWeeks(month).length * compactH()
  const panelMin = Math.max(180, Math.round(fill.below - compactRows - PANEL_GAP))

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
        <div ref={pagerRef}>
          <MonthPager
            month={month}
            events={events}
            today={today}
            selectedDay={selectedDay}
            compact={compact}
            morph={morph}
            rowsHeight={fill.rows}
            onTapDay={onTapDay}
            onOpenEvent={onOpen}
            onMove={onMove}
            onChangeMonth={setMonth}
          />
        </div>
        {status === 'loading' && (
          <p className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-[13px] text-ink-3" role="status">
            일정을 불러오는 중…
          </p>
        )}
      </Card>

      {panelShown && (
        <DayPanel
          key={openSeq}
          day={selectedDay}
          today={today}
          events={events}
          closing={!dayOpen}
          minHeight={panelMin}
          onOpen={onOpen}
          onClose={onCloseDay}
        />
      )}

      {/* 오른쪽 아래 둥근 + : 고른 날(처음엔 오늘)에 일정 추가. 달력은 이 버튼 위에서 끝나서 칸을 가리지 않아요 (useFillHeight).
          body 에 띄워요: 일정 창이 열려 뒤 화면(main)이 작아질 때 그 안에 있으면, 스크롤해 둔 화면에서 버튼이 튀어 다녀요 */}
      {createPortal(
        <button
          ref={fabRef}
          type="button"
          onClick={() => onAdd(selectedDay)}
          aria-label="일정 추가"
          className="kb-hide fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-[0_6px_18px_rgb(10_114_180/0.38)] transition hover:bg-brand-deep active:scale-95 md:right-8 md:bottom-8"
        >
          <Icon name="plus" size={28} strokeWidth={2.4} />
        </button>,
        document.body,
      )}
    </div>
  )
}

/**
 * 달력이 화면 아래까지 꽉 차도록 주 줄들이 쓸 높이를 정해요 (rows). 한 주 높이는 MonthPager 가 주 수로 나눠요.
 * - 오른쪽 아래 + 버튼과 겹치면 그 버튼 위에서 끝나요 (토요일 칸의 일정이 버튼에 가려지지 않게).
 * - 페이지가 조금씩 스크롤되지 않도록 본문 아래 여백까지 셈에 넣어요.
 * - below: 카드 아래 본문 끝(아래 탭 위)까지의 높이 (그날 보기의 아래 칸이 채울 자리). 그날 보기에서는 + 버튼 자리를 덧대지 않아요.
 * 안내 띠가 생기거나 없어지면(ResizeObserver) 다시 맞춰요.
 * 일정 창(페이지 시트)이 열려 뒤 화면이 작아져 있는 동안에는 재지 않고 기다려요 (작아진 크기로 재면 틀려요).
 */
function useFillHeight(
  rootRef: { current: HTMLElement | null },
  /** 달력 칸들(요일 줄 포함)을 감싼 칸 (그 부모가 카드) */
  pagerRef: { current: HTMLElement | null },
  fabRef: { current: HTMLElement | null },
  dayOpen: boolean,
): { rows: number; below: number } {
  const [m, setM] = useState({ rows: MIN_CELL_H * 5, below: 0 })
  useLayoutEffect(() => {
    const root = rootRef.current
    const wrap = pagerRef.current
    const card = wrap?.parentElement
    if (!root || !wrap || !card) return
    let retry = 0
    const calc = () => {
      window.clearTimeout(retry)
      if (document.documentElement.dataset.pageSheet) {
        retry = window.setTimeout(calc, 300)
        return
      }
      // 주 줄들이 시작하는 자리 (요일 줄 아래) 와 카드 아래 여백
      const vp = wrap.querySelector<HTMLElement>('[data-month-pager]')
      if (!vp) return
      const v = vp.getBoundingClientRect()
      const c = card.getBoundingClientRect()
      const cardPad = c.bottom - wrap.getBoundingClientRect().bottom
      const fixedBottom = v.top + window.scrollY + cardPad
      const main = root.closest('main')
      const mainPad = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0
      // 화면 아래에서 비워 둘 높이: 본문 아래 여백, 그리고 + 버튼과 겹치면 버튼 위까지
      let reserve = mainPad
      const fab = fabRef.current?.getBoundingClientRect()
      if (fab && fab.width > 0 && fab.left < c.right && fab.right > c.left) {
        reserve = Math.max(reserve, window.innerHeight - fab.top + FAB_GAP)
      }
      // 본문 여백보다 더 비워야 하면 이 화면 아래에 덧대요 (스크롤해도 맨 아래 줄이 버튼 위에 오게)
      const extra = dayOpen ? 0 : Math.max(0, Math.round(reserve - mainPad))
      if (root.style.paddingBottom !== `${extra}px`) root.style.paddingBottom = `${extra}px`
      const rows = Math.max(MIN_CELL_H * 4, Math.floor(window.innerHeight - reserve - fixedBottom))
      const below = Math.floor(window.innerHeight - mainPad - fixedBottom)
      setM((prev) => (prev.rows === rows && prev.below === below ? prev : { rows, below }))
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
      window.clearTimeout(retry)
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', later)
      window.removeEventListener('orientationchange', later)
      root.style.paddingBottom = ''
    }
  }, [rootRef, pagerRef, fabRef, dayOpen])
  return m
}
