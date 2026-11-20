import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import type { CalEvent, DayISO } from '../../lib/types'
import { EASE_IOS, prefersReducedMotion } from '../ui'
import { WEEKDAYS, addMonths, monthWeeks } from './calDates'
import { MIN_CELL_H, MonthGrid, compactH } from './MonthGrid'
import { useCalendar } from './useCalendar'
import { useEventDrag } from './useEventDrag'

/*
 * 손가락으로 넘기는 달력.
 * 지난달 · 이번 달 · 다음 달 세 장을 가로로 이어 두고, 가운데 장을 보여 줘요.
 * - 옆으로 밀면 달력이 손가락을 그대로 따라오고 옆 달이 보여요. 폭의 22% 넘게 밀거나 휙 넘기면 그 달로, 아니면 제자리로.
 *   (오른쪽에서 왼쪽으로 밀면 다음 달, 왼쪽에서 오른쪽이면 지난달)
 * - 처음 8px 을 움직인 방향으로 정해요: 세로면 그냥 페이지 스크롤, 가로면 달 넘기기.
 * - 막대를 길게 눌러 끄는 중(useEventDrag)에는 넘기지 않아요. 넘긴 뒤 따라오는 click 은 무시해요.
 * - 마우스는 화살표로. 노트북 트랙패드로 옆으로 쓸어도 넘어가요.
 * - ‹ › · 오늘 버튼으로 달이 바뀌어도 옆으로 미끄러지며 바뀌어요. 움직임 줄이기를 켠 사람은 바로 바뀌어요.
 */

/** 이만큼(폭 대비) 넘게 밀면 다음/지난달로 */
const COMMIT_RATIO = 0.22
/** 이만큼 빠르게(px/ms) 휙 넘기면 짧게 밀어도 넘어가요 */
const FLICK_V = 0.35
const AXIS_SLOP = 8
/** 곡선(0.22, 1, 0.36, 1)의 처음 기울기: 손가락 빠르기를 이어받는 데 써요 */
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)'
const EASE_OUT_SLOPE = 1 / 0.22

function monthsBetween(a: string, b: string): number {
  const [y1, m1] = a.split('-').map(Number)
  const [y2, m2] = b.split('-').map(Number)
  return (y2 - y1) * 12 + (m2 - m1)
}

interface Track {
  id: number
  x0: number
  y0: number
  /** 잡기 시작할 때 달력이 이미 밀려 있던 거리 (넘어가는 중에 다시 잡은 경우) */
  base: number
  axis: 'x' | 'y' | null
  samples: { x: number; t: number }[]
}

export function MonthPager({
  month,
  events,
  today,
  selectedDay,
  compact,
  morph,
  rowsHeight,
  onTapDay,
  onOpenEvent,
  onMove,
  onChangeMonth,
}: {
  month: string
  events: CalEvent[]
  today: DayISO
  selectedDay: DayISO
  /** 그날 보기 (줄이 낮아지고 색 점) */
  compact: boolean
  /** 그날 보기를 열고 닫는 중 (줄 높이를 부드럽게) */
  morph: boolean
  /** 달력 전체 보기일 때 주 줄들이 쓸 수 있는 높이 */
  rowsHeight: number
  onTapDay: (d: DayISO) => void
  onOpenEvent: (e: CalEvent) => void
  onMove: (e: CalEvent, grabDay: DayISO, dropDay: DayISO) => void
  /** 넘겨서 달이 바뀔 때 */
  onChangeMonth: (ym: string) => void
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const { view, barHandlers } = useEventDrag(viewportRef, onMove)

  /** 달력 전체 보기의 한 주 높이 (5주 달·6주 달이 같은 높이를 나눠 써요) */
  const fullCell = useCallback((ym: string) => Math.max(MIN_CELL_H, Math.min(140, Math.floor(rowsHeight / monthWeeks(ym).length))), [rowsHeight])
  const cellFor = useCallback((ym: string) => (compact ? compactH() : fullCell(ym)), [compact, fullCell])
  const heightFor = useCallback((ym: string) => monthWeeks(ym).length * cellFor(ym), [cellFor])

  // 손가락 처리(아래 effect)는 한 번만 붙이므로 최신 값은 ref 로 봐요
  const live = useRef({ month, heightFor, onChangeMonth })
  live.current = { month, heightFor, onChangeMonth }

  /** 움직임 상태 (다시 그리지 않고 직접 style 을 바꿔요: 손가락을 60fps 로 따라가게) */
  const st = useRef({
    /** 가운데 장에서 밀린 거리 px (+ 면 지난달 쪽이 보임) */
    offset: 0,
    touch: null as Track | null,
    /** 넘어가는(또는 제자리로 돌아가는) 중: dir = -1 지난달, 0 제자리, 1 다음 달 */
    anim: null as { dir: number; timer: number } | null,
    /** 넘겨서 달이 바뀌었을 때, 바뀐 뒤 달력이 있어야 할 자리 */
    carry: null as number | null,
    suppressClickUntil: 0,
    wheelAcc: 0,
    wheelLast: 0,
    wheelLocked: false,
    mounted: false,
  })

  const setStrip = (offset: number, transition = 'none') => {
    const strip = stripRef.current
    st.current.offset = offset
    if (!strip) return
    strip.style.transition = transition
    strip.style.transform = `translate3d(calc(-100% / 3 + ${offset}px), 0, 0)`
  }
  const setHeight = (h: number, transition = 'none') => {
    const vp = viewportRef.current
    if (!vp) return
    vp.style.transition = transition
    vp.style.height = `${h}px`
  }
  /** 밀린 거리에 따라 높이도 옆 달 높이 쪽으로 (5주 ↔ 6주 달) */
  const followHeight = (offset: number) => {
    const vp = viewportRef.current
    if (!vp) return
    const { month: m, heightFor: hf } = live.current
    const w = vp.clientWidth || 1
    const h0 = hf(m)
    const h1 = hf(addMonths(m, offset < 0 ? 1 : -1))
    setHeight(h0 + (h1 - h0) * Math.min(1, Math.abs(offset) / w))
  }

  /** 지금 달력이 화면에서 실제로 밀려 있는 거리 (움직이는 중이어도) */
  const visualOffset = (): number => {
    const strip = stripRef.current
    const vp = viewportRef.current
    if (!strip || !vp) return st.current.offset
    const t = getComputedStyle(strip).transform
    if (!t || t === 'none') return st.current.offset
    return new DOMMatrix(t).m41 + vp.clientWidth
  }

  /** dir 쪽으로 넘기거나(±1) 제자리로(0). v = 놓을 때 손가락 빠르기 */
  const animateTo = (dir: number, v = 0) => {
    const vp = viewportRef.current
    const s = st.current
    if (!vp) return
    if (s.anim) window.clearTimeout(s.anim.timer)
    const w = vp.clientWidth
    const to = -dir * w
    const dist = Math.abs(to - s.offset)
    const finish = () => {
      s.anim = null
      if (dir === 0) return
      s.carry = 0
      flushSync(() => live.current.onChangeMonth(addMonths(live.current.month, dir)))
    }
    if (prefersReducedMotion() || dist < 1) {
      setStrip(to)
      finish()
      return
    }
    const sameWay = v !== 0 && Math.sign(v) === Math.sign(to - s.offset)
    const ms = sameWay && Math.abs(v) > 0.2 ? Math.max(200, Math.min(460, (EASE_OUT_SLOPE * dist) / Math.abs(v))) : dir === 0 ? 380 : 420
    setStrip(to, `transform ${ms}ms ${EASE_OUT}`)
    const { month: m, heightFor: hf } = live.current
    setHeight(hf(dir ? addMonths(m, dir) : m), `height ${ms}ms ${EASE_OUT}`)
    s.anim = { dir, timer: window.setTimeout(finish, ms + 20) }
  }

  /** 넘어가는 중에 다시 잡았을 때: 지금 보이는 자리에서 멈추고(달이 바뀌는 중이면 바꾸고) 그 자리를 돌려줘요 */
  const settleNow = (): number => {
    const s = st.current
    if (!s.anim) return s.offset
    window.clearTimeout(s.anim.timer)
    const cur = visualOffset()
    const dir = s.anim.dir
    s.anim = null
    if (dir === 0) {
      setStrip(cur)
      followHeight(cur)
      return cur
    }
    const vp = viewportRef.current
    const carry = cur + dir * (vp?.clientWidth ?? 0)
    s.carry = carry
    flushSync(() => live.current.onChangeMonth(addMonths(live.current.month, dir)))
    return carry
  }

  // 손가락·트랙패드
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const s = st.current
    const find = (list: TouchList, id: number) => {
      for (const t of Array.from(list)) if (t.identifier === id) return t
      return null
    }
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        // 두 손가락이면 넘기기 그만 (확대 등)
        if (s.touch?.axis === 'x') animateTo(0)
        s.touch = null
        return
      }
      const t = e.touches[0]
      // 새로 눌렀으니 그다음 click 은 진짜 누른 것
      s.suppressClickUntil = 0
      const base = settleNow()
      s.touch = { id: t.identifier, x0: t.clientX, y0: t.clientY, base, axis: null, samples: [{ x: t.clientX, t: e.timeStamp }] }
    }
    const onMoveT = (e: TouchEvent) => {
      const tr = s.touch
      if (!tr) return
      const t = find(e.changedTouches, tr.id)
      if (!t) return
      // 막대를 길게 눌러 끌기 시작했으면 넘기기는 그만
      if (useCalendar.getState().dragging) {
        s.touch = null
        if (s.offset !== 0) animateTo(0)
        return
      }
      const dx = t.clientX - tr.x0
      const dy = t.clientY - tr.y0
      if (!tr.axis) {
        if (Math.abs(dx) < AXIS_SLOP && Math.abs(dy) < AXIS_SLOP) return
        if (Math.abs(dx) > Math.abs(dy) && e.cancelable) {
          tr.axis = 'x'
          // 정하는 데 쓴 8px 만큼은 빼서 달력이 툭 튀지 않게
          tr.x0 += Math.sign(dx) * AXIS_SLOP
        } else {
          tr.axis = 'y'
          s.touch = null
          if (tr.base !== 0) animateTo(0)
          return
        }
      }
      if (e.cancelable) e.preventDefault()
      const w = vp.clientWidth
      const off = Math.max(-w, Math.min(w, tr.base + t.clientX - tr.x0))
      setStrip(off)
      followHeight(off)
      tr.samples.push({ x: t.clientX, t: e.timeStamp })
      if (tr.samples.length > 8) tr.samples.shift()
    }
    const onEnd = (e: TouchEvent) => {
      const tr = s.touch
      if (!tr || !find(e.changedTouches, tr.id)) return
      s.touch = null
      if (tr.axis !== 'x') {
        if (tr.base !== 0) animateTo(0)
        return
      }
      s.suppressClickUntil = performance.now() + 400
      if (e.type === 'touchcancel') return animateTo(0)
      // 마지막 0.1초 동안의 빠르기
      const now = e.timeStamp
      const recent = tr.samples.filter((p) => now - p.t < 100)
      const a = recent[0] ?? tr.samples[0]
      const b = tr.samples[tr.samples.length - 1]
      const v = b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0
      const w = vp.clientWidth
      const off = s.offset
      let dir = 0
      if (off < -w * COMMIT_RATIO || (v < -FLICK_V && off < -12)) dir = 1
      else if (off > w * COMMIT_RATIO || (v > FLICK_V && off > 12)) dir = -1
      // 반대로 휙 되돌리면 제자리로
      if ((dir === 1 && v > FLICK_V) || (dir === -1 && v < -FLICK_V)) dir = 0
      animateTo(dir, v)
    }
    const onClick = (e: MouseEvent) => {
      if (performance.now() < s.suppressClickUntil) {
        s.suppressClickUntil = 0
        e.preventDefault()
        e.stopPropagation()
      }
    }
    // 트랙패드로 옆으로 쓸기: 한 번 쓸 때 한 달 (관성으로 따라오는 움직임은 무시)
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.2) return
      e.preventDefault()
      const gap = e.timeStamp - s.wheelLast
      s.wheelLast = e.timeStamp
      if (gap > 250) {
        s.wheelLocked = false
        s.wheelAcc = 0
      }
      if (s.wheelLocked) return
      s.wheelAcc += e.deltaX
      if (Math.abs(s.wheelAcc) > 50) {
        s.wheelLocked = true
        settleNow()
        animateTo(s.wheelAcc > 0 ? 1 : -1)
        s.wheelAcc = 0
      }
    }
    vp.addEventListener('touchstart', onStart, { passive: true })
    vp.addEventListener('touchmove', onMoveT, { passive: false })
    vp.addEventListener('touchend', onEnd)
    vp.addEventListener('touchcancel', onEnd)
    vp.addEventListener('click', onClick, true)
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      vp.removeEventListener('touchstart', onStart)
      vp.removeEventListener('touchmove', onMoveT)
      vp.removeEventListener('touchend', onEnd)
      vp.removeEventListener('touchcancel', onEnd)
      vp.removeEventListener('click', onClick, true)
      vp.removeEventListener('wheel', onWheel)
      if (s.anim) window.clearTimeout(s.anim.timer)
      s.anim = null
    }
    // 안의 함수들은 ref 만 봐요
  }, [])

  // 달이 바뀌면: 넘겨서 바뀐 것이면 그 자리 그대로, 버튼으로 바뀐 것이면 옆으로 미끄러지며
  const prevMonth = useRef(month)
  useLayoutEffect(() => {
    const prev = prevMonth.current
    prevMonth.current = month
    if (prev === month) return
    const s = st.current
    const vp = viewportRef.current
    if (s.carry !== null) {
      setStrip(s.carry)
      if (s.carry !== 0) followHeight(s.carry)
      s.carry = null
      return
    }
    if (s.anim) {
      window.clearTimeout(s.anim.timer)
      s.anim = null
    }
    const diff = monthsBetween(prev, month)
    if (prefersReducedMotion() || !vp || !s.mounted) {
      setStrip(0)
      return
    }
    if (Math.abs(diff) === 1) {
      // 바뀌기 전 달(지금은 옆 장)이 보이는 자리에서 시작해서 가운데로
      setStrip(diff > 0 ? vp.clientWidth : -vp.clientWidth)
      void stripRef.current?.offsetWidth
      setStrip(0, `transform 0.44s ${EASE_IOS}`)
      // 높이도 같이 (5주 달 ↔ 6주 달). 아래 높이 effect 는 미끄러지는 중(s.anim)이라 건너뛰어요
      setHeight(live.current.heightFor(month), `height 0.44s ${EASE_IOS}`)
      // 미끄러지는 중에 손가락으로 잡으면 그 자리에서 이어 잡게
      s.anim = { dir: 0, timer: window.setTimeout(() => (s.anim = null), 460) }
    } else {
      // 멀리 건너뛰면(오늘로) 살짝 나타나기만
      setStrip(0)
      stripRef.current?.children[1]?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' })
    }
  }, [month])

  // 높이: 지금 달(가운데 장)의 높이. 그날 보기를 열고 닫을 때·달이 바뀔 때는 부드럽게
  useLayoutEffect(() => {
    const s = st.current
    if (s.touch?.axis === 'x' || s.anim) return
    if (s.offset !== 0) return followHeight(s.offset)
    const smooth = s.mounted && !prefersReducedMotion()
    setHeight(heightFor(month), smooth ? `height ${morph ? `0.46s ${EASE_IOS}` : `0.44s ${EASE_IOS}`}` : 'none')
  }, [month, heightFor, morph])

  // 처음 그린 다음부터 움직임을 켜요 (처음 높이를 맞출 때 움직이지 않게)
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      st.current.mounted = true
    })
    return () => cancelAnimationFrame(id)
  }, [])

  const months = [addMonths(month, -1), month, addMonths(month, 1)]
  return (
    <div>
      <div className="grid grid-cols-7 pb-1" aria-hidden="true">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={`text-center text-[12px] font-bold ${i === 0 ? 'text-danger' : i === 6 ? 'text-brand-ink' : 'text-ink-3'}`}>
            {w}
          </div>
        ))}
      </div>
      {/* 가로는 달 넘기기, 세로는 페이지 스크롤 (pan-y) */}
      <div ref={viewportRef} data-month-pager className="relative overflow-hidden" style={{ touchAction: 'pan-y' }}>
        <div ref={stripRef} className="flex w-[300%] will-change-transform" style={{ transform: 'translate3d(calc(-100% / 3), 0, 0)' }}>
          {months.map((ym, i) => (
            <div key={ym} className="w-1/3 shrink-0">
              <MonthGrid
                month={ym}
                events={events}
                today={today}
                selectedDay={selectedDay}
                cellHeight={fullCell(ym)}
                compact={compact}
                animate={morph}
                active={i === 1}
                onTapDay={i === 1 ? onTapDay : undefined}
                onOpenEvent={i === 1 ? onOpenEvent : undefined}
                dragView={i === 1 ? view : null}
                barHandlers={i === 1 ? barHandlers : undefined}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
