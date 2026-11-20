import { Component, Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react'
import type { CalEvent } from '../../lib/types'
import { Button, Icon, IconButton } from '../ui'
import { labelRange } from './calDates'
import { paletteOf } from './colors'
import { useCalendar } from './useCalendar'
import { isNoteEntry, popNoteEntry, pushNoteEntry } from './noteHistory'
import type { NoteEditorHandle, NoteStatus } from './NoteEditor'

/* 편집기(Tiptap)는 회의록을 열 때만 따로 내려받아요 */
const NoteEditor = lazy(() => import('./NoteEditor'))

const STATUS_TEXT: Record<NoteStatus, string> = {
  loading: '불러오는 중…',
  saved: '저장됨',
  dirty: '저장 중…',
  saving: '저장 중…',
  error: '저장 못 함',
  conflict: '저장 안 됨',
  paused: '저장 멈춤',
  tooBig: '저장 못 함',
}

/**
 * 일정 회의록 (노션처럼 흰 종이 한 장). 캘린더 화면 안에서 달력 대신 보여요 (아래 탭·PC 메뉴는 그대로).
 * 열 때 '뒤로 가기' 기록을 하나 쌓아서 휴대폰 뒤로 가기가 회의록만 닫아요.
 */
export function EventNotePage({
  eventId,
  onClose,
  onEdit,
  onDelete,
}: {
  eventId: string
  onClose: () => void
  onEdit: (e: CalEvent) => void
  onDelete: (e: CalEvent) => void
}) {
  const live = useCalendar((s) => s.events.find((e) => e.id === eventId) ?? null)
  const status = useCalendar((s) => s.status)
  const removedHere = useCalendar((s) => s.removedHere === eventId)
  // 다른 기기에서 지워져도 제목·날짜는 마지막으로 본 것으로 보여 줘요
  const lastRef = useRef<CalEvent | null>(live)
  if (live) lastRef.current = live
  const event = live ?? lastRef.current
  const deleted = !live && status === 'ready' && lastRef.current !== null && !removedHere

  const [saveStatus, setSaveStatus] = useState<NoteStatus>('loading')
  const [menu, setMenu] = useState(false)
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null)
  const handleRef = useRef<NoteEditorHandle | null>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // 열리면 초점을 회의록으로 (누른 일정 막대가 사라져서 초점이 화면 맨 위로 가지 않게: 키보드·화면 읽기 사용자)
  useEffect(() => {
    sectionRef.current?.focus({ preventScroll: true })
  }, [eventId])

  // 휴대폰 뒤로 가기 = 닫기
  useEffect(() => {
    pushNoteEntry(eventId)
    let closedByBack = false
    const onPop = () => {
      if (history.state?.amNote !== undefined) return
      closedByBack = true
      onCloseRef.current()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      // ‹ 캘린더·다른 탭으로 닫혔으면 쌓아 둔 기록을 치워요
      if (!closedByBack && isNoteEntry(eventId)) popNoteEntry(eventId)
    }
  }, [eventId])

  // 아이폰: 키보드가 올라와 화면이 위로 밀리면 위쪽 띠(뒤로·도구 막대)를 보이는 곳까지 내려요
  useEffect(() => {
    const vv = window.visualViewport
    const el = headerRef.current
    if (!vv || !el || !window.matchMedia('(pointer: coarse)').matches) return
    let raf = 0
    const update = () => {
      raf = 0
      const top = el.parentElement?.getBoundingClientRect().top ?? 0
      const shift = vv.offsetTop > 1 && top < vv.offsetTop ? vv.offsetTop : 0
      el.style.transform = shift ? `translateY(${Math.round(shift)}px)` : ''
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule)
    window.addEventListener('scroll', schedule, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      window.removeEventListener('scroll', schedule)
      el.style.transform = ''
    }
  }, [])

  // ··· 메뉴: 바깥을 누르거나 Esc 면 닫기
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false)
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const close = () => {
    handleRef.current?.flush()
    onClose()
  }

  const p = paletteOf(event?.color ?? 'sky')
  const statusTone = saveStatus === 'error' || saveStatus === 'tooBig' ? 'text-danger font-semibold' : saveStatus === 'conflict' || saveStatus === 'paused' ? 'text-accent-soft-ink font-semibold' : 'text-ink-3'

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-label={event ? `${event.title} 회의록` : '회의록'}
      className="outline-none -mt-3 mr-[calc(-1*max(1rem,env(safe-area-inset-right)))] ml-[calc(-1*max(1rem,env(safe-area-inset-left)))] min-h-[calc(100dvh-5rem)] bg-surface md:mx-0 md:mt-0 md:min-h-[70vh] md:rounded-3xl md:shadow-[var(--shadow-card)]"
    >
      <div
        ref={headerRef}
        className="no-print sticky top-0 z-30 border-b border-line/70 bg-surface/95 pt-[env(safe-area-inset-top)] backdrop-blur-xl md:rounded-t-3xl"
      >
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-1 pr-[max(0.5rem,env(safe-area-inset-right))] pl-[max(0.25rem,env(safe-area-inset-left))] md:px-3">
          <button
            type="button"
            onClick={close}
            className="flex h-11 shrink-0 items-center gap-0.5 rounded-xl pr-3 pl-1.5 text-[16px] font-semibold text-brand-ink hover:bg-brand-soft"
          >
            <Icon name="chevronLeft" size={22} />
            캘린더
          </button>
          <span className="min-w-0 flex-1" />
          <span className={`truncate text-[13px] whitespace-nowrap ${statusTone}`} role="status" aria-live="polite">
            {STATUS_TEXT[saveStatus]}
          </span>
          <div className="relative shrink-0" ref={menuRef}>
            <IconButton icon="more" label="메뉴" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)} disabled={!live} className="disabled:opacity-40" />
            {menu && live && (
              <div role="menu" className="anim-pop absolute top-12 right-0 z-40 w-44 rounded-2xl bg-surface p-1.5 shadow-[var(--shadow-pop)]">
                <button
                  type="button"
                  role="menuitem"
                  className="flex h-11 w-full items-center gap-2.5 rounded-xl px-3 text-[15px] font-semibold hover:bg-hover"
                  onClick={() => {
                    setMenu(false)
                    onEdit(live)
                  }}
                >
                  <Icon name="edit" size={18} /> 일정 수정
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex h-11 w-full items-center gap-2.5 rounded-xl px-3 text-[15px] font-semibold text-danger hover:bg-danger-soft"
                  onClick={() => {
                    setMenu(false)
                    onDelete(live)
                  }}
                >
                  <Icon name="trash" size={18} /> 삭제
                </button>
              </div>
            )}
          </div>
        </div>
        {/* 편집기 도구 막대가 여기에 붙어요 */}
        <div ref={setToolbarSlot} />
      </div>

      <div className="mx-auto max-w-2xl px-[max(1.25rem,env(safe-area-inset-left))] pt-6 md:px-10 md:pt-8">
        {deleted && (
          <div className="mb-5 rounded-2xl bg-danger-soft px-4 py-3" role="alert">
            <p className="font-semibold text-danger">다른 기기에서 이 일정을 지웠어요</p>
            <p className="mt-0.5 text-[13px] text-ink-2">되살리면 회의록도 함께 돌아와요. 그동안 고친 내용은 이 기기에 남아 있어요.</p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => lastRef.current && void useCalendar.getState().restore(lastRef.current)}>
                되살리기
              </Button>
              <Button size="sm" variant="secondary" onClick={close}>
                닫기
              </Button>
            </div>
          </div>
        )}

        {event ? (
          <>
            <div className="flex items-start gap-3">
              <span className="mt-[9px] h-[18px] w-[18px] shrink-0 rounded-md" style={{ background: p.dot }} aria-hidden="true" />
              <h1 className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => live && onEdit(live)}
                  disabled={!live}
                  className="w-full rounded-lg text-left text-[27px] leading-tight font-bold tracking-tight [overflow-wrap:anywhere]"
                >
                  {event.title}
                </button>
              </h1>
            </div>
            <div className="mt-3 mb-6 flex flex-wrap gap-2 pl-[30px]">
              <button
                type="button"
                onClick={() => live && onEdit(live)}
                disabled={!live}
                className="tabular relative inline-flex min-h-9 items-center gap-1.5 rounded-full bg-muted px-3 text-[13px] font-semibold text-ink-2 after:absolute after:inset-x-0 after:-inset-y-1 hover:bg-track"
              >
                <Icon name="calendar" size={15} />
                {labelRange(event.startDate, event.endDate, true)}
              </button>
              <button
                type="button"
                onClick={() => live && onEdit(live)}
                disabled={!live}
                className="relative inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold after:absolute after:inset-x-0 after:-inset-y-1"
                style={{ background: p.bg, color: p.ink }}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.dot }} aria-hidden="true" />
                {p.label}
              </button>
            </div>

            <EditorBoundary>
              <Suspense fallback={<p className="py-2 text-[15px] text-ink-3">편집기를 불러오는 중…</p>}>
                <NoteEditor eventId={eventId} toolbarSlot={toolbarSlot} onStatus={setSaveStatus} handleRef={handleRef} paused={deleted || removedHere} />
              </Suspense>
            </EditorBoundary>
          </>
        ) : (
          <p className="py-10 text-center text-ink-3">{status === 'ready' ? '일정을 찾을 수 없어요' : '불러오는 중…'}</p>
        )}
      </div>
    </section>
  )
}

/** 편집기 파일을 못 받았을 때(오프라인에서 처음 열기, 새 버전 배포 뒤 예전 파일) 흰 화면 대신 안내 */
class EditorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.error(error)
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="rounded-2xl bg-danger-soft px-4 py-4" role="alert">
        <p className="font-semibold text-danger">회의록 편집기를 불러오지 못했어요</p>
        <p className="mt-0.5 text-[13px] text-ink-2">인터넷 연결을 확인하고 새로고침해 주세요. 앱이 새 버전으로 바뀌었을 때도 이렇게 보일 수 있어요.</p>
        <Button size="sm" className="mt-3" icon="undo" onClick={() => location.reload()}>
          새로고침
        </Button>
      </div>
    )
  }
}
