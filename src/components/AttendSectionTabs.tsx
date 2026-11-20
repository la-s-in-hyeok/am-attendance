import { useEffect, useRef, type KeyboardEvent } from 'react'
import { useStore, type AttendTab } from '../store'

const ITEMS: { id: AttendTab; label: string }[] = [
  { id: 'attend', label: '출석' },
  { id: 'report', label: '출석보고' },
  { id: 'stats', label: '통계' },
]

/**
 * 키보드(← →)로 탭을 바꾸면 화면이 통째로 바뀌어서 초점이 사라진다.
 * 새 화면의 탭 줄이 그려질 때 이 탭에 초점을 다시 놓는다
 */
let focusOnMount: AttendTab | null = null

/**
 * 출석부 안쪽 탭 (출석 · 출석보고 · 통계). 파란 띠(PageHeader 의 nav) 안에 제목처럼 그린다.
 * 고른 것은 흰색 굵게, 나머지는 흐린 흰색. 누르면 아래 탭과 같은 길(goTab)로 옮겨 간다
 */
export function AttendSectionTabs() {
  const tab = useStore((s) => s.tab)
  const goTab = useStore((s) => s.goTab)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!focusOnMount) return
    const want = focusOnMount
    focusOnMount = null
    if (want === tab) listRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus({ preventScroll: true })
    // 처음 그릴 때만 본다 (그 뒤로 tab 이 바뀌면 이 화면은 사라지고 새 화면이 그려져요)
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = Math.max(0, ITEMS.findIndex((t) => t.id === tab))
    const n = ITEMS.length
    const next = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1
    if (next < 0 || ITEMS[next].id === tab) return
    e.preventDefault()
    focusOnMount = ITEMS[next].id
    goTab(ITEMS[next].id)
  }

  return (
    // 폭이 모자라는 아주 좁은 화면에서도 오른쪽 버튼과 겹치지 않게, 넘치면 이 줄 안에서만 옆으로 밀린다
    <div
      ref={listRef}
      role="tablist"
      aria-label="출석부"
      onKeyDown={onKeyDown}
      className="-ml-1 flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] max-[359px]:gap-1 md:-ml-1.5 md:gap-2 [&::-webkit-scrollbar]:hidden"
    >
      {ITEMS.map((t) => {
        const on = t.id === tab
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => goTab(t.id)}
            className={`h-11 shrink-0 rounded-xl px-1 text-[20px] leading-none tracking-tight whitespace-nowrap transition-colors focus-visible:outline-white focus-visible:-outline-offset-2 max-[359px]:text-[18px] md:px-1.5 md:text-[22px] ${
              on ? 'font-bold text-white' : 'font-semibold text-white/65 hover:text-white/90 active:text-white'
            }`}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
