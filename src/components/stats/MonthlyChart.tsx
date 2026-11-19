import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { MonthStat } from '../../lib/compute'
import { SERVICE_STYLE } from '../ui'
import { roundParts, type ServiceSplit } from './statsCompute'

/** 요소의 실제 너비 (px) — 글자가 늘어나지 않도록 SVG를 화면 크기에 맞춰 그린다 */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0)
      setWidth((prev) => (prev === w ? prev : w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

const H = 196
const TOP = 26
const BOTTOM = 28
const PLOT = H - TOP - BOTTOM

/** 위쪽만 둥근 막대 */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(7, w / 2, h)
  const b = y + h
  return `M${x},${b}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${b}Z`
}

/** 1부·2부 몫을 출석률(%)로 — 두 값의 합이 반올림한 출석률과 같도록 */
function servicePcts(s: MonthStat, sp: ServiceSplit | undefined): [number, number] {
  if (s.possible <= 0 || !sp) return [0, 0]
  const [a, b] = roundParts([(sp.service1 / s.possible) * 100, (sp.service2 / s.possible) * 100])
  return [a, b]
}

/**
 * 월별 출석률 막대그래프 (1월~12월).
 * 막대 높이 = 출석률, 아래 노랑 = 1부, 위 민트 = 2부.
 * 고른 달은 진하게, 나머지 달은 옅게, 기록 없는 달은 빈 자리로 보여 준다.
 */
export function MonthlyChart({
  stats,
  split,
  selected,
  onSelect,
  lastMonth,
}: {
  stats: MonthStat[]
  /** stats 와 같은 순서의 1부·2부 출석 인원 합 */
  split: ServiceSplit[]
  selected: string
  onSelect: (ym: string) => void
  /** 이 달 뒤로는 아직 오지 않은 달 */
  lastMonth: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const n = stats.length || 12
  const slot = width / n
  const barW = Math.max(10, Math.min(34, slot * 0.62))
  const trackR = Math.min(8, barW / 2)
  const small = slot < 30

  const selIdx = stats.findIndex((s) => s.month === selected)
  const selStat = selIdx >= 0 ? stats[selIdx] : undefined
  const selHas = !!selStat && selStat.sundays.length > 0 && selStat.rate !== null
  const [sel1, sel2] = selStat ? servicePcts(selStat, split[selIdx]) : [0, 0]

  return (
    // contain-inline-size: 그린 SVG 너비가 다시 바깥 너비를 붙잡지 않도록 (창을 줄여도 함께 줄어든다)
    <div ref={ref} className="w-full contain-inline-size select-none">
      {width > 0 && (
        <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} className="block" role="group" aria-label="월별 출석률 그래프 (1부·2부)">
          {/* 바닥선 */}
          <line x1={0} x2={width} y1={TOP + PLOT + 0.5} y2={TOP + PLOT + 0.5} className="stroke-line" strokeWidth={1} />
          {stats.map((s, i) => {
            const m = Number(s.month.slice(5, 7))
            const isSel = s.month === selected
            const has = s.sundays.length > 0 && s.rate !== null
            const future = s.month > lastMonth
            const cx = i * slot + slot / 2
            const x = cx - barW / 2
            const h = has ? Math.max(4, (s.rate ?? 0) * PLOT) : 0
            const y = TOP + PLOT - h
            // 막대를 1부(아래) / 2부(위)로 나눈다. 합 = 출석률 높이
            const sp = split[i]
            const h2 = has && sp && s.present > 0 ? h * (sp.service2 / s.present) : 0
            const h1 = h - h2
            const clip = `${uid}-bar-${i}`
            const label = has ? `${Math.round((s.rate ?? 0) * 100)}%` : future ? '' : '–'
            const [p1, p2] = has ? servicePcts(s, sp) : [0, 0]
            const onKey = (e: KeyboardEvent<SVGGElement>) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(s.month)
              }
            }
            return (
              <g
                key={s.month}
                role="button"
                tabIndex={0}
                aria-pressed={isSel}
                aria-label={`${m}월 출석률 ${has ? `${label} (1부 ${p1}%, 2부 ${p2}%)` : '기록 없음'}`}
                onClick={() => onSelect(s.month)}
                onKeyDown={onKey}
                className="group cursor-pointer outline-none"
              >
                {/* 누르기 쉽게 칸 전체를 받는다 */}
                <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
                {/* 빈 자리 (100% 높이의 바탕) */}
                <rect
                  x={x}
                  y={TOP}
                  width={barW}
                  height={PLOT}
                  rx={trackR}
                  className={`transition-colors group-focus-visible:stroke-ink ${isSel ? 'fill-[#efefea]' : 'fill-bg group-hover:fill-[#efefea]'} ${future && !isSel ? 'opacity-50' : ''}`}
                  strokeWidth={2}
                />
                {has && (
                  <>
                    <clipPath id={clip}>
                      <path d={barPath(x, y, barW, h)} />
                    </clipPath>
                    <g
                      clipPath={`url(#${clip})`}
                      className={`transition-opacity ${isSel ? 'opacity-100' : 'opacity-[0.42] group-hover:opacity-70'}`}
                    >
                      {h1 > 0 && <rect x={x} y={y + h2} width={barW} height={h1} className="fill-present" />}
                      {h2 > 0 && <rect x={x} y={y} width={barW} height={h2} className="fill-present2" />}
                    </g>
                  </>
                )}
                {label && (
                  <text
                    x={cx}
                    y={has ? Math.max(TOP - 8, y - 7) : TOP + PLOT - 8}
                    textAnchor="middle"
                    className={`tabular text-[12px] ${isSel ? 'fill-ink font-extrabold' : 'fill-ink-3 font-semibold'}`}
                  >
                    {has && small ? label.replace('%', '') : label}
                  </text>
                )}
                <text
                  x={cx}
                  y={H - 8}
                  textAnchor="middle"
                  className={`tabular text-[13px] ${isSel ? 'fill-ink font-bold' : future ? 'fill-ink-3/60 font-medium' : 'fill-ink-3 font-medium'}`}
                >
                  {/* 휴대폰처럼 칸이 좁으면 '월'을 빼고 숫자만 (글자가 서로 붙지 않게) */}
                  {small ? m : `${m}월`}
                </text>
              </g>
            )
          })}
        </svg>
      )}
      {width === 0 && <div style={{ height: H }} />}

      {/* 범례 + 고른 달의 1부·2부 몫 */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 pt-1 pb-1.5 text-[13px] text-ink-3">
        <span className="flex items-center gap-3">
          {([1, 2] as const).map((sv) => (
            <span key={sv} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${SERVICE_STYLE[sv].bg}`} />
              {SERVICE_STYLE[sv].label} 예배
            </span>
          ))}
        </span>
        {selHas && selStat && (
          <span className="tabular">
            <b className="font-semibold text-ink-2">{Number(selStat.month.slice(5, 7))}월</b> 1부 <b className="font-bold text-ink">{sel1}%</b>
            {' + '}2부 <b className="font-bold text-ink">{sel2}%</b>
          </span>
        )}
      </div>
    </div>
  )
}
