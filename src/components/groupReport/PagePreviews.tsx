import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../ui'

/** 쪽 그림(Blob)들을 화면에 쓸 주소로. 창이 닫히거나 그림이 바뀌면 주소를 치워요 */
export function usePreviewUrls(blobs: Blob[] | null): string[] {
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    if (!blobs || blobs.length === 0) {
      setUrls([])
      return
    }
    const list = blobs.map((b) => URL.createObjectURL(b))
    setUrls(list)
    return () => list.forEach((u) => URL.revokeObjectURL(u))
  }, [blobs])
  return urls
}

/** 바뀐 PDF 의 쪽들을 옆으로 넘겨 보는 작은 그림 줄. 누르면 크게 */
export function PreviewStrip({ urls, onOpen }: { urls: string[]; onOpen: (index: number) => void }) {
  return (
    <ul className="-mx-5 flex snap-x gap-2.5 overflow-x-auto overscroll-x-contain px-5 pt-1 pb-3" aria-label={`미리 보기 ${urls.length}쪽`}>
      {urls.map((u, i) => (
        <li key={u} className="shrink-0 snap-start">
          <button
            type="button"
            onClick={() => onOpen(i)}
            aria-label={`${i + 1}쪽 크게 보기`}
            className="block w-[104px] overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-card)] transition active:scale-[0.98]"
          >
            <img src={u} alt="" className="block aspect-[210/297] w-full bg-white object-contain" draggable={false} />
            <span className="tabular block border-t border-line py-1 text-center text-[12px] font-semibold text-ink-2">{i + 1}쪽</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

let viewerSeq = 0
/** 닫혔지만 '뒤로 가기' 기록을 아직 치우지 않은 크게 보기 */
let pendingViewer: number | null = null

/**
 * 쪽 그림 크게 보기 (화면 전체). 옆으로 밀거나 ‹ › 로 넘겨요.
 * 휴대폰 '뒤로 가기'·Esc 는 이 화면만 닫아요 (아래 창은 그대로)
 */
export function PreviewViewer({ urls, start, onClose }: { urls: string[]; start: number; onClose: () => void }) {
  const [index, setIndex] = useState(start)
  const track = useRef<HTMLDivElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // 처음 연 쪽으로 바로 이동
  useLayoutEffect(() => {
    const el = track.current
    if (el) el.scrollLeft = start * el.clientWidth
  }, [start])

  useEffect(() => {
    // 닫으면 누른 쪽 그림으로 초점을 돌려줘요
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeBtn.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // 아래 창(Sheet)이 같이 닫히지 않게 여기서 멈춰요
      e.stopImmediatePropagation()
      onCloseRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    // '뒤로 가기'가 이 화면만 닫도록 기록 하나 (창의 기록 값은 그대로 이어 받아요)
    const mark = ++viewerSeq
    const st = (history.state ?? {}) as Record<string, unknown>
    if (st.amViewer !== undefined && st.amViewer === pendingViewer) {
      // 방금 닫힌 크게 보기 기록이 아직 남아 있으면 그 자리를 이어 써요 (React 개발 모드의 두 번 실행도 여기로)
      history.replaceState({ ...st, amViewer: mark }, '')
    } else {
      history.pushState({ ...st, amViewer: mark }, '')
    }
    pendingViewer = null
    let closedByBack = false
    const onPop = () => {
      if (history.state?.amViewer === mark) return
      closedByBack = true
      onCloseRef.current()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('popstate', onPop)
      if (prev?.isConnected) prev.focus({ preventScroll: true })
      if (closedByBack) return
      pendingViewer = mark
      setTimeout(() => {
        if (pendingViewer !== mark) return
        pendingViewer = null
        if (history.state?.amViewer === mark) history.back()
      }, 0)
    }
  }, [])

  const go = (i: number) => {
    const el = track.current
    if (!el) return
    const next = Math.max(0, Math.min(urls.length - 1, i))
    el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' })
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/90 text-white" role="dialog" aria-modal="true" aria-label="미리 보기">
      <div className="flex shrink-0 items-center justify-between gap-2 pt-[max(env(safe-area-inset-top),0.5rem)] pr-[max(0.5rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))]">
        <span className="tabular text-[15px] font-semibold" aria-live="polite">
          {index + 1} / {urls.length}쪽
        </span>
        <button
          ref={closeBtn}
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10 active:bg-white/15"
        >
          <Icon name="x" size={22} />
        </button>
      </div>
      <div
        ref={track}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-contain"
        onScroll={(e) => {
          const el = e.currentTarget
          if (el.clientWidth > 0) setIndex(Math.round(el.scrollLeft / el.clientWidth))
        }}
      >
        {urls.map((u, i) => (
          <div key={u} className="flex h-full w-full shrink-0 snap-center items-start justify-center overflow-y-auto p-3">
            <img src={u} alt={`${i + 1}쪽`} className="h-auto max-w-full bg-white shadow-lg" draggable={false} />
          </div>
        ))}
      </div>
      {urls.length > 1 && (
        <div className="flex shrink-0 items-center justify-center gap-6 pt-2 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          <button
            type="button"
            onClick={() => go(index - 1)}
            disabled={index === 0}
            aria-label="앞 쪽"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30"
          >
            <Icon name="chevronLeft" size={22} />
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            disabled={index >= urls.length - 1}
            aria-label="다음 쪽"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30"
          >
            <Icon name="chevronRight" size={22} />
          </button>
        </div>
      )}
    </div>,
    document.body,
  )
}
