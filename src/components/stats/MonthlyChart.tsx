import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { MonthStat } from '../../lib/compute'
import { servicePcts, type ServiceSplit } from './statsCompute'

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

// 한 화면에 들어오도록 낮게 (그래프 높이 = 막대 칸 + 위 숫자 + 아래 달 이름)
const H = 172
const TOP = 20
const BOTTOM = 24
const PLOT = H - TOP - BOTTOM
/** 왼쪽 눈금 글자 자리 */
const AXIS = 32

/** 막대 테두리: 노랑·민트를 조금 진하게 (흰 바탕에서도 경계가 보이게) */
const EDGE1: CSSProperties = { stroke: 'color-mix(in srgb, var(--color-present), var(--color-present-ink) 30%)' }
const EDGE2: CSSProperties = { stroke: 'color-mix(in srgb, var(--color-present2), var(--color-present2-ink) 35%)' }

/** 위쪽만 둥근 막대 */
function barPath(x: number, y: number, w: number, h: number, radius = 5): string {
  const r = Math.max(0, Math.min(radius, w / 2, h))
  const b = y + h
  return `M${x},${b}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${b}Z`
}

/**
 * 월별 출석률 막대그래프.
 * 막대 높이 = 출석률, 아래 노랑 = 1부, 위 민트 = 2부. 고른 달은 칸 전체를 옅은 파랑으로.
 * 이번 해는 이번 달까지만 그린다 (오지 않은 달은 빼서 막대를 넓게).
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

  // 보여 줄 달 (stats 안의 번호도 함께: split 과 짝을 맞추려고)
  const cols = useMemo(() => {
    const out = stats.map((s, i) => ({ s, sp: split[i] })).filter(({ s }) => s.month <= lastMonth || s.month === selected)
    return out.length > 0 ? out : stats.map((s, i) => ({ s, sp: split[i] }))
  }, [stats, split, lastMonth, selected])

  // 세로 눈금: 가장 높은 달에 맞춰 20%·40%…100% 중 하나 (낮은 출석률도 막대 차이가 잘 보이게)
  const top = useMemo(() => {
    let max = 0
    for (const { s } of cols) if (s.sundays.length > 0 && s.rate !== null) max = Math.max(max, s.rate)
    return Math.min(1, Math.max(0.2, Math.ceil(max * 5 - 1e-9) / 5))
  }, [cols])

  const plotW = Math.max(0, width - AXIS)
  const n = cols.length || 1
  const slot = plotW / n
  const barW = Math.max(8, Math.min(22, slot * 0.58))
  const small = slot < 27
  const yOf = (v: number) => TOP + PLOT - (v / top) * PLOT
  const ticks = [top, top / 2, 0]

  return (
    // contain-inline-size: 그린 SVG 너비가 다시 바깥 너비를 붙잡지 않도록 (창을 줄여도 함께 줄어든다)
    <div ref={ref} className="w-full contain-inline-size select-none">
      {width > 0 ? (
        <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} className="block" role="group" aria-label="월별 출석률 그래프 (1부·2부)">
          {/* 눈금 */}
          {ticks.map((t) => {
            const y = Math.round(yOf(t)) + 0.5
            return (
              <g key={t} aria-hidden>
                <line
                  x1={AXIS}
                  x2={width}
                  y1={y}
                  y2={y}
                  className={t === 0 ? 'stroke-ink-3/40' : 'stroke-line'}
                  strokeWidth={1}
                  strokeDasharray={t === 0 ? undefined : '3 3'}
                />
                <text x={AXIS - 6} y={y + 4} textAnchor="end" className="tabular fill-ink-3 text-[11px] font-medium">
                  {Math.round(t * 100)}%
                </text>
              </g>
            )
          })}

          {cols.map(({ s, sp }, i) => {
            const m = Number(s.month.slice(5, 7))
            const isSel = s.month === selected
            const has = s.sundays.length > 0 && s.rate !== null
            const cx = AXIS + i * slot + slot / 2
            const x = cx - barW / 2
            const h = has ? Math.max(3, Math.min(PLOT, ((s.rate ?? 0) / top) * PLOT)) : 0
            const y = TOP + PLOT - h
            // 막대를 1부(아래) / 2부(위)로 나눈다. 합 = 출석률 높이, 둘 다 있으면 사이를 2px 띄운다
            const h2 = has && sp && s.present > 0 ? h * (sp.service2 / s.present) : 0
            const h1 = h - h2
            const gap = h1 >= 3 && h2 >= 3 ? 2 : 0
            const label = has ? `${Math.round((s.rate ?? 0) * 100)}%` : '–'
            const [p1, p2] = has ? servicePcts(s, sp) : [0, 0]
            const hw = Math.min(slot - 2, 44)
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
                <rect x={AXIS + i * slot} y={0} width={slot} height={H} fill="transparent" />
                {/* 고른 달 = 옅은 파랑 칸 */}
                <path
                  d={barPath(cx - hw / 2, 2, hw, TOP + PLOT - 2, 8)}
                  strokeWidth={2}
                  className={`transition-colors group-focus-visible:stroke-brand ${isSel ? 'fill-brand-soft' : 'fill-transparent group-hover:fill-hover'}`}
                />
                {has && (
                  <g clipPath={`url(#${uid}-plot)`}>
                    {h2 - gap > 0 && <path d={barPath(x + 0.5, y + 0.5, barW - 1, h2 - gap)} className="fill-present2" style={EDGE2} />}
                    {h1 > 0 &&
                      (h2 > 0 ? (
                        <rect x={x + 0.5} y={y + h2} width={barW - 1} height={h1} className="fill-present" style={EDGE1} />
                      ) : (
                        <path d={barPath(x + 0.5, y + 0.5, barW - 1, h1)} className="fill-present" style={EDGE1} />
                      ))}
                  </g>
                )}
                <text
                  x={cx}
                  y={has ? y - 5 : TOP + PLOT - 6}
                  textAnchor="middle"
                  className={`tabular ${isSel ? 'fill-brand-ink text-[12px] font-bold' : `${has ? 'fill-ink-2' : 'fill-ink-3'} text-[11px] font-semibold`}`}
                >
                  {has && small ? label.replace('%', '') : label}
                </text>
                <text
                  x={cx}
                  y={H - 6}
                  textAnchor="middle"
                  className={`tabular text-[11px] ${isSel ? 'fill-brand-ink font-bold' : 'fill-ink-3 font-medium'}`}
                >
                  {/* 칸이 좁으면 '월'을 빼고 숫자만 (글자가 서로 붙지 않게) */}
                  {small ? m : `${m}월`}
                </text>
              </g>
            )
          })}
          {/* 막대가 바닥선 아래로 삐져나오지 않게 */}
          <defs>
            <clipPath id={`${uid}-plot`}>
              <rect x={0} y={0} width={width} height={TOP + PLOT} />
            </clipPath>
          </defs>
        </svg>
      ) : (
        <div style={{ height: H }} />
      )}
    </div>
  )
}
