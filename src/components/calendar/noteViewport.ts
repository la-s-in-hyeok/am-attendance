import { Selection, TextSelection, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/*
 * 회의록을 휴대폰에서 누를 때 화면이 튀지 않게 하는 도우미.
 *
 * 왜 필요해요?
 * - 아이폰 Safari(WebKit)는 글 칸(contenteditable)에 손가락으로 초점이 가면 '초점 간 칸 전체'를 키보드 위 가운데로
 *   끌어와요. 회의록 칸은 길어서(아래 빈 공간까지 포함) 화면이 아래쪽 빈 곳으로 휙 내려가고, 누른 줄은 위로 사라져요.
 *   (WebKit _zoomToFocusRect: 아이폰에서 ^ ∨ ✓ 막대가 붙는 칸은 이미 보이고 있어도 늘 움직여요.)
 * - 크롬(안드로이드·삼성 인터넷)도 키보드가 올라오면 초점 간 칸을 가운데로 맞추려고 움직여요.
 * - 두 브라우저 모두 focus({ preventScroll: true })로 초점을 주면 이 자동 이동을 하지 않아요.
 *   그래서 아직 초점이 없을 때의 '톡 누르기'만 우리가 받아서, 누른 자리에 커서를 놓고 preventScroll 로 초점을 줘요.
 * - 휴대폰에서는 회의록 화면 전체를 '보이는 화면(키보드 위)'에 딱 맞춘 고정 층으로 띄우고(noteLayer.ts),
 *   글은 그 안의 스크롤 칸에서만 움직여요. 그래서 브라우저가 페이지를 끌어와도 위쪽 띠·글이 같이 밀리지 않아요.
 * - 아이폰은 초점을 받은 뒤 한 박자 늦게 커서를 문서 맨 앞에 두기도 해요. 톡 누른 직후 그런 일이 생기면 누른 자리로 되돌려요.
 */

/** 이 이상 움직이거나 오래 누르면 톡 누르기가 아니에요 (스크롤·길게 눌러 고르기는 브라우저에 맡겨요) */
const TAP_SLOP = 10
const TAP_MAX_MS = 500
/** 스크롤이 이만큼 안에 있었으면 그 손가락은 '굴러가던 화면을 멈추는' 손짓이에요 */
const FLING_STOP_MS = 120
/** 톡 누른 뒤 이 시간 안에 브라우저가 커서를 엉뚱한 곳(맨 앞)으로 옮기면 누른 자리로 되돌려요 */
const GUARD_MS = 1200
const GUARD_META = 'amTapGuard'

/** 커서 줄 위·아래로 남길 여유 */
const GAP_TOP = 12
const GAP_BOTTOM = 24

export interface NoteViewportParts {
  /** 위쪽 띠(뒤로·도구 막대) */
  band: () => HTMLElement | null
  /** 휴대폰 고정 층 안의 스크롤 칸 (PC 처럼 창 전체가 스크롤되면 null) */
  scroller: () => HTMLElement | null
}

/**
 * 지금 눈에 보이는 영역(키보드 위)을 getBoundingClientRect 와 같은 좌표로.
 * 크롬은 좌표가 '레이아웃 화면' 기준이라 보이는 곳이 offsetTop 만큼 아래에 있고,
 * 아이폰 Safari(26)는 키보드가 올라와 있으면 좌표가 '보이는 화면' 기준이에요.
 * 그래서 화면에 고정된(position: fixed) 0 높이 표시를 잠깐 놓아 레이아웃 화면의 위치를 직접 재요.
 */
function visibleArea(): { top: number; bottom: number } {
  const vv = window.visualViewport
  if (!vv) return { top: 0, bottom: window.innerHeight }
  const probe = document.createElement('div')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none'
  document.body.appendChild(probe)
  const layoutTop = probe.getBoundingClientRect().top
  probe.remove()
  const top = layoutTop + vv.offsetTop
  return { top, bottom: top + vv.height }
}

/** 화면 아래에 붙어 글을 가리는 막대(휴대폰 아래 탭 등, 키보드가 올라오면 숨는 .kb-hide)의 윗선 */
function bottomBarTop(top: number, bottom: number): number {
  let edge = bottom
  for (const el of document.querySelectorAll<HTMLElement>('.kb-hide')) {
    const r = el.getBoundingClientRect()
    if (r.height === 0 || r.top <= top + 80 || r.bottom < bottom - 2) continue
    if (getComputedStyle(el).visibility === 'hidden') continue
    edge = Math.min(edge, r.top)
  }
  return edge
}

/**
 * 커서가 지금 보이는 곳(위쪽 띠 아래 ~ 키보드·아래 탭 위)에 있게, 필요한 만큼만 굴려요.
 * ProseMirror 기본 동작은 키보드·위쪽 띠를 모르고 너무 많이 움직여서 이걸 써요.
 */
export function revealCaret(view: EditorView, parts: NoteViewportParts, smooth: boolean): void {
  let rect: { top: number; bottom: number }
  try {
    rect = view.coordsAtPos(view.state.selection.head)
  } catch {
    return
  }
  let { top, bottom } = visibleArea()
  const band = parts.band()
  if (band) top = Math.max(top, band.getBoundingClientRect().bottom)
  const sc = parts.scroller()
  if (sc) {
    const r = sc.getBoundingClientRect()
    top = Math.max(top, r.top)
    bottom = Math.min(bottom, r.bottom)
  }
  bottom = bottomBarTop(top, bottom)
  const minY = top + GAP_TOP
  const maxY = bottom - GAP_BOTTOM
  // 화면이 너무 좁으면(키보드가 움직이는 중 등) 건드리지 않아요
  if (maxY - minY < 24) return
  let dy = 0
  if (rect.top < minY) dy = rect.top - minY
  else if (rect.bottom > maxY) dy = Math.min(rect.bottom - maxY, rect.top - minY)
  if (Math.abs(dy) < 1) return
  if (smooth) (sc ?? window).scrollBy({ top: dy, behavior: 'smooth' })
  else if (sc) sc.scrollTop += dy
  else window.scrollTo(window.scrollX, window.scrollY + dy)
}

/** 편집기마다 잠깐 뒤 다시 볼 예약 (새로 부르면 앞의 것은 취소) */
const rechecks = new WeakMap<EditorView, () => void>()

/**
 * revealCaret + 잠깐 뒤 두 번 더 확인.
 * 아이폰은 키(줄 바꿈 등)를 누른 직후 글 칸(스크롤 칸)을 우리가 굴린 위치에서 한 박자 늦게 예전 위치로 되돌릴 때가 있어요
 * (화면 그리기 쪽과 위치를 주고받는 사이의 엇갈림). 그러면 커서가 키보드 밑에 숨으니, 가려졌을 때만 다시 굴려요.
 */
export function revealCaretSettled(view: EditorView, parts: NoteViewportParts): void {
  rechecks.get(view)?.()
  revealCaret(view, parts, false)
  const again = () => {
    if (!view.isDestroyed && view.hasFocus()) revealCaret(view, parts, false)
  }
  const timers = [window.setTimeout(again, 120), window.setTimeout(again, 400)]
  // 그 사이 손가락으로 직접 굴리기 시작했으면 끌어오지 않아요
  const cancel = () => {
    for (const id of timers) window.clearTimeout(id)
    window.clearTimeout(done)
    document.removeEventListener('touchstart', cancel, true)
    document.removeEventListener('wheel', cancel, true)
    if (rechecks.get(view) === cancel) rechecks.delete(view)
  }
  const done = window.setTimeout(cancel, 450)
  document.addEventListener('touchstart', cancel, { capture: true, passive: true })
  document.addEventListener('wheel', cancel, { capture: true, passive: true })
  rechecks.set(view, cancel)
}

/** 누른 곳이 체크 칸·토글 단추 같은 것이면 브라우저 기본 동작에 맡겨요 (링크는 눌러도 열리지 않으니 글처럼 다뤄요) */
const NATIVE_TARGET = 'input, button, label, select, textarea'

export interface TapToCaret {
  /** 편집기 거래(transaction)마다 불러 주세요: 톡 누른 직후 브라우저가 커서를 옮기면 되돌려요 */
  afterTransaction(tr: Transaction): void
  destroy(): void
}

/**
 * 초점이 없는 회의록을 손가락으로 톡 누르면: 누른 자리에 커서 + 화면은 그대로.
 * area: 누름을 받을 칸 (글 양옆 여백·글 아래 빈 곳까지 포함). 글 칸(view.dom) 바깥 여백을 누르면 가장 가까운 줄로 가요.
 */
export function attachTapToCaret(view: EditorView, area: HTMLElement): TapToCaret {
  const dom = view.dom
  let start: { x: number; y: number; t: number; id: number } | null = null
  let lastScroll = -Infinity
  // 톡 누른 자리. 잠깐 동안 브라우저가 커서를 다른 곳(대개 문서 맨 앞)으로 옮기면 여기로 되돌려요
  let guard: {
    anchor: number
    head: number
    until: number
    restores: number
  } | null = null

  const inArea = (target: EventTarget | null): target is Element =>
    target instanceof Element && area.contains(target) && (dom.contains(target) || target.contains(dom))

  const onScroll = (e: Event) => {
    lastScroll = e.timeStamp
  }
  const cancelGuard = () => {
    guard = null
  }
  const onStart = (e: TouchEvent) => {
    start = null
    if (e.touches.length !== 1 || view.hasFocus() || !view.editable || !inArea(e.target)) return
    // 굴러가던 글을 멈추려고 누른 것이면 커서를 놓지 않아요 (아이폰·안드로이드 기본 동작과 같게)
    if (e.timeStamp - lastScroll < FLING_STOP_MS) return
    const t = e.touches[0]
    start = { x: t.clientX, y: t.clientY, t: e.timeStamp, id: t.identifier }
  }
  const onMove = (e: TouchEvent) => {
    if (!start) return
    const t = Array.from(e.touches).find((x) => x.identifier === start?.id)
    if (!t || Math.hypot(t.clientX - start.x, t.clientY - start.y) > TAP_SLOP) start = null
  }
  const onCancel = () => {
    start = null
  }
  const onEnd = (e: TouchEvent) => {
    const s = start
    start = null
    if (!s || e.touches.length > 0 || view.hasFocus() || !view.editable) return
    const t = Array.from(e.changedTouches).find((x) => x.identifier === s.id)
    if (!t || e.timeStamp - s.t > TAP_MAX_MS || Math.hypot(t.clientX - s.x, t.clientY - s.y) > TAP_SLOP) return
    if (e.target instanceof Element && e.target.closest(NATIVE_TARGET)) return
    if (!e.cancelable) return
    const box = dom.getBoundingClientRect()
    // 글 칸보다 위(제목·날짜와 글 사이 틈)는 브라우저에 맡겨요
    if (t.clientY < box.top) return

    // 브라우저가 스스로 초점을 주면(그리고 칸 전체를 보이게 끌어오면) 안 되니 여기서 막고 직접 해요
    e.preventDefault()
    // 글 아래 빈 곳(마지막 줄보다 아래)을 누르면 맨 끝으로. 그 자리는 브라우저가 엉뚱하게 맨 앞을 돌려줄 때가 있어요
    const last = dom.lastElementChild
    const belowText = last !== null && t.clientY > last.getBoundingClientRect().bottom
    // 글 양옆 여백을 눌렀으면 그 줄의 가장 가까운 자리로
    const x = Math.min(Math.max(t.clientX, box.left + 1), box.right - 1)
    const hit = belowText ? null : view.posAtCoords({ left: x, top: t.clientY })
    // 손가락이 닿은 그 순간에 초점을 줘야 휴대폰 키보드가 올라와요 (requestAnimationFrame 등으로 미루면 안 올라와요)
    dom.focus({ preventScroll: true })
    const { doc } = view.state
    let sel: Selection
    try {
      sel = hit ? TextSelection.near(doc.resolve(hit.pos)) : Selection.atEnd(doc)
    } catch {
      sel = Selection.atEnd(doc)
    }
    view.dispatch(view.state.tr.setSelection(sel).setMeta('pointer', true).setMeta(GUARD_META, true))
    guard = {
      anchor: sel.anchor,
      head: sel.head,
      until: performance.now() + GUARD_MS,
      restores: 0,
    }
  }

  const afterTransaction = (tr: Transaction) => {
    const g = guard
    if (!g || tr.getMeta(GUARD_META)) return
    if (performance.now() > g.until || tr.docChanged || g.restores >= 3) {
      guard = null
      return
    }
    if (!tr.selectionSet) return
    const sel = view.state.selection
    if (sel.anchor === g.anchor && sel.head === g.head) return
    // 아이폰이 초점을 받은 뒤 한 박자 늦게 커서를 문서 맨 앞에 두는 일이 있어요. 손가락이 다시 닿지 않았는데
    // 커서가 옮겨졌으면 브라우저가 한 일이니, 누른 자리로 되돌려요 (거래 처리 중이라 끝난 뒤에)
    queueMicrotask(() => {
      if (guard !== g || view.isDestroyed || view.composing || !view.hasFocus()) return
      const { doc } = view.state
      if (g.anchor > doc.content.size || g.head > doc.content.size) return
      g.restores += 1
      try {
        view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, g.anchor, g.head)).setMeta(GUARD_META, true))
      } catch {
        guard = null
      }
    })
  }

  const scrollTarget: HTMLElement | Window = area.scrollHeight > area.clientHeight + 1 || getComputedStyle(area).overflowY !== 'visible' ? area : window
  scrollTarget.addEventListener('scroll', onScroll, { passive: true })
  area.addEventListener('touchstart', onStart, { passive: true })
  area.addEventListener('touchmove', onMove, { passive: true })
  area.addEventListener('touchcancel', onCancel, { passive: true })
  area.addEventListener('touchend', onEnd, { passive: false })
  // 손가락이 다시 닿거나 글자를 치면 그건 사용자가 한 일이에요: 되돌리기를 그만둬요
  document.addEventListener('touchstart', cancelGuard, {
    capture: true,
    passive: true,
  })
  document.addEventListener('mousedown', cancelGuard, true)
  document.addEventListener('keydown', cancelGuard, true)
  dom.addEventListener('compositionstart', cancelGuard)
  dom.addEventListener('blur', cancelGuard)
  return {
    afterTransaction,
    destroy() {
      scrollTarget.removeEventListener('scroll', onScroll)
      area.removeEventListener('touchstart', onStart)
      area.removeEventListener('touchmove', onMove)
      area.removeEventListener('touchcancel', onCancel)
      area.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchstart', cancelGuard, true)
      document.removeEventListener('mousedown', cancelGuard, true)
      document.removeEventListener('keydown', cancelGuard, true)
      dom.removeEventListener('compositionstart', cancelGuard)
      dom.removeEventListener('blur', cancelGuard)
    },
  }
}
