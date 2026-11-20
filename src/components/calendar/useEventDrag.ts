import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import type { CalEvent, DayISO } from '../../lib/types'
import { paletteOf } from './colors'
import { useCalendar } from './useCalendar'

/*
 * 일정 막대 끌어서 옮기기.
 * - PC(마우스): 누른 채 4px 넘게 움직이면 끌기 시작.
 * - 휴대폰(터치): 400ms 길게 누르면 끌기 시작 (진동). 그 전에 8px 넘게 움직이면 그냥 스크롤.
 *   삼성 인터넷은 pointercancel 이 다르게 와서 터치는 touch 이벤트로만 처리해요.
 *   iOS 사파리는 touchmove 를 막으려면 non-passive 리스너가 미리 붙어 있어야 해서 document 에 처음부터 달아 둬요.
 * - 놓은 칸은 손가락 아래의 [data-day] 칸. 잡은 날 기준으로 옮겨요 (여러 날 일정의 둘째 날을 잡으면 그 날이 놓은 칸으로).
 * - 같은 칸이나 달력 밖에 놓으면 취소. 끈 다음에 따라오는 click 은 무시해요 (그날 보기가 열리지 않게).
 *   달력 밖(토스트의 '되돌리기' 등)의 click 이나, 새로 누른 뒤의 click 은 막지 않아요.
 */

const LONG_PRESS_MS = 400
const TOUCH_SLOP = 8
const MOUSE_SLOP = 4

interface Grab {
  kind: 'mouse' | 'touch'
  event: CalEvent
  grabDay: DayISO
  x0: number
  y0: number
  touchId: number
  active: boolean
  timer: ReturnType<typeof setTimeout> | null
  ghost: HTMLElement | null
  hover: DayISO | null
}

export interface DragView {
  /** 끌고 있는 일정 id */
  id: string
  /** 놓으려는 칸 */
  hoverDay: DayISO | null
}

/** 막대에 붙이는 스타일: 길게 누를 때 말풍선 메뉴·글자 선택이 안 뜨게 */
export const BAR_NO_CALLOUT: CSSProperties = { WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }

export function useEventDrag(gridRef: RefObject<HTMLElement | null>, onDrop: (event: CalEvent, grabDay: DayISO, dropDay: DayISO) => void) {
  const [view, setView] = useState<DragView | null>(null)
  const grab = useRef<Grab | null>(null)
  const suppressClickUntil = useRef(0)
  const onDropRef = useRef(onDrop)
  onDropRef.current = onDrop

  /** 화면의 (x, y) 아래에 있는 달력 칸 */
  const dayAt = (x: number, y: number): DayISO | null => {
    const grid = gridRef.current
    if (!grid) return null
    for (const el of document.elementsFromPoint(x, y)) {
      const cell = el instanceof HTMLElement ? el.closest<HTMLElement>('[data-day]') : null
      if (cell && grid.contains(cell)) return cell.dataset.day ?? null
    }
    return null
  }

  const removeGhost = (g: Grab) => {
    g.ghost?.remove()
    g.ghost = null
  }

  /**
   * drop = 놓은 자리 (취소면 null).
   * clickFollows = 손을 뗀 뒤 브라우저가 click 을 보낼 수 있는지 (마우스, 또는 touchend 를 막지 못한 터치)
   */
  const end = (drop: { x: number; y: number } | null, clickFollows = true) => {
    const g = grab.current
    if (!g) return
    grab.current = null
    if (g.timer) clearTimeout(g.timer)
    removeGhost(g)
    if (!g.active) return
    document.documentElement.style.removeProperty('user-select')
    document.documentElement.style.removeProperty('-webkit-user-select')
    // 끈 다음 손을 떼면 click 이 따라오는데, 그날 보기가 열리지 않게 잠깐 막아요.
    // 터치는 touchend 를 막아서 click 이 안 와요: 그때는 막지 않아야 바로 다음 탭이 먹혀요
    suppressClickUntil.current = clickFollows ? performance.now() + 600 : 0
    setView(null)
    const day = drop ? dayAt(drop.x, drop.y) : null
    if (day && day !== g.grabDay) onDropRef.current(g.event, g.grabDay, day)
    // 끄는 동안 미뤄 둔 새로고침은 옮기기(낙관적 반영)를 시작한 뒤에
    useCalendar.getState().setDragging(false)
  }

  const moveTo = (g: Grab, x: number, y: number) => {
    if (g.ghost) g.ghost.style.transform = `translate(${Math.round(x - 24)}px, ${Math.round(y - 34)}px)`
    const day = dayAt(x, y)
    if (day !== g.hover) {
      g.hover = day
      setView({ id: g.event.id, hoverDay: day })
    }
  }

  const activate = (g: Grab, x: number, y: number) => {
    if (g.active) return
    g.active = true
    g.timer = null
    if (g.kind === 'touch') navigator.vibrate?.(10)
    document.getSelection()?.removeAllRanges()
    document.documentElement.style.setProperty('user-select', 'none')
    document.documentElement.style.setProperty('-webkit-user-select', 'none')
    const p = paletteOf(g.event.color)
    const ghost = document.createElement('div')
    ghost.setAttribute('aria-hidden', 'true')
    ghost.textContent = g.event.title
    Object.assign(ghost.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      zIndex: '70',
      pointerEvents: 'none',
      maxWidth: '180px',
      padding: '4px 10px',
      borderRadius: '8px',
      background: p.bg,
      color: p.ink,
      font: '700 13px/18px var(--font-sans)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      boxShadow: '0 8px 24px rgb(16 42 67 / 0.25)',
      outline: `2px solid ${p.dot}`,
      opacity: '0.95',
    } satisfies Partial<CSSStyleDeclaration>)
    document.body.appendChild(ghost)
    g.ghost = ghost
    useCalendar.getState().setDragging(true)
    g.hover = null
    moveTo(g, x, y)
    setView({ id: g.event.id, hoverDay: g.hover })
  }

  useEffect(() => {
    const touchOf = (e: TouchEvent, id: number) => {
      for (const t of Array.from(e.changedTouches)) if (t.identifier === id) return t
      return null
    }
    const onTouchMove = (e: TouchEvent) => {
      const g = grab.current
      if (!g || g.kind !== 'touch') return
      const t = touchOf(e, g.touchId)
      if (!t) return
      if (!g.active) {
        // 길게 누르기 전에 움직이면 스크롤로 보고 끌기를 그만둬요
        if (Math.hypot(t.clientX - g.x0, t.clientY - g.y0) > TOUCH_SLOP) end(null)
        return
      }
      // 끄는 동안은 페이지가 움직이지 않게 (당겨서 새로고침도 막혀요)
      if (e.cancelable) e.preventDefault()
      moveTo(g, t.clientX, t.clientY)
    }
    const onTouchEnd = (e: TouchEvent) => {
      const g = grab.current
      if (!g || g.kind !== 'touch') return
      const t = touchOf(e, g.touchId)
      if (!t) return
      if (g.active) {
        // 끈 뒤에 따라오는 가짜 마우스 이벤트·click 을 막아요
        const blocked = e.cancelable
        if (blocked) e.preventDefault()
        end({ x: t.clientX, y: t.clientY }, !blocked)
      } else {
        // 짧게 누른 것은 그냥 click (그날 보기 열기)
        end(null)
      }
    }
    const onTouchCancel = () => {
      if (grab.current?.kind === 'touch') end(null)
    }
    const onPointerMove = (e: PointerEvent) => {
      const g = grab.current
      if (!g || g.kind !== 'mouse' || e.pointerType !== 'mouse') return
      if (!g.active) {
        if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > MOUSE_SLOP) activate(g, e.clientX, e.clientY)
        return
      }
      e.preventDefault()
      moveTo(g, e.clientX, e.clientY)
    }
    const onPointerUp = (e: PointerEvent) => {
      const g = grab.current
      if (!g || g.kind !== 'mouse' || e.pointerType !== 'mouse') return
      end(g.active ? { x: e.clientX, y: e.clientY } : null)
    }
    const onPointerCancel = (e: PointerEvent) => {
      if (grab.current?.kind === 'mouse' && e.pointerType === 'mouse') end(null)
    }
    const onClickCapture = (e: MouseEvent) => {
      if (!suppressClickUntil.current) return
      const grid = gridRef.current
      // 달력 밖(토스트 버튼 등)의 click 은 그대로 둬요
      if (!grid || !(e.target instanceof Node) || !grid.contains(e.target)) {
        suppressClickUntil.current = 0
        return
      }
      if (performance.now() < suppressClickUntil.current) {
        suppressClickUntil.current = 0
        e.preventDefault()
        e.stopPropagation()
      }
    }
    // 새로 누르면 그다음 click 은 진짜 누른 것이에요
    const onPressStart = () => {
      if (!grab.current?.active) suppressClickUntil.current = 0
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && grab.current?.active) end(null)
    }
    const onHide = () => end(null)
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', onTouchEnd, { passive: false })
    document.addEventListener('touchcancel', onTouchCancel)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    document.addEventListener('click', onClickCapture, true)
    document.addEventListener('pointerdown', onPressStart, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onHide)
    return () => {
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('touchcancel', onTouchCancel)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      document.removeEventListener('click', onClickCapture, true)
      document.removeEventListener('pointerdown', onPressStart, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onHide)
      end(null)
    }
    // 처음 한 번만 붙여요 (안의 함수들은 ref 만 봐요)
  }, [])

  /** 막대에 붙일 이벤트 */
  const barHandlers = (event: CalEvent) => ({
    onTouchStart: (e: React.TouchEvent) => {
      if (e.touches.length !== 1) {
        end(null)
        return
      }
      const t = e.touches[0]
      const day = dayAt(t.clientX, t.clientY)
      if (!day) return
      end(null)
      const g: Grab = {
        kind: 'touch',
        event,
        grabDay: day,
        x0: t.clientX,
        y0: t.clientY,
        touchId: t.identifier,
        active: false,
        timer: null,
        ghost: null,
        hover: null,
      }
      g.timer = setTimeout(() => {
        if (grab.current === g) activate(g, g.x0, g.y0)
      }, LONG_PRESS_MS)
      grab.current = g
    },
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      const day = dayAt(e.clientX, e.clientY)
      if (!day) return
      end(null)
      grab.current = {
        kind: 'mouse',
        event,
        grabDay: day,
        x0: e.clientX,
        y0: e.clientY,
        touchId: -1,
        active: false,
        timer: null,
        ghost: null,
        hover: null,
      }
    },
    // 길게 누를 때 뜨는 메뉴(안드로이드)·말풍선(iOS) 막기
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    // 마우스로 끌 때 글자가 선택되거나 링크처럼 끌리지 않게
    onDragStart: (e: React.DragEvent) => e.preventDefault(),
  })

  return { view, barHandlers }
}
