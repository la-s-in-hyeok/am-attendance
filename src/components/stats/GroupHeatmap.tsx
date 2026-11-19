import { useLayoutEffect, useMemo, useRef } from 'react'
import type { Group } from '../../lib/types'
import { rate, sortGroups, type MonthStat } from '../../lib/compute'
import { Card } from '../ui'
import { heat } from './parts'

interface Row {
  id: string
  name: string
  cells: (number | null)[]
  year: number | null
}

function Cell({ value, strong }: { value: number | null; strong?: boolean }) {
  return (
    <td className="p-0.5">
      <div
        className={`tabular flex h-10 min-w-[44px] items-center justify-center rounded-lg text-[13px] lg:min-w-[38px] ${
          value === null ? 'text-ink-3/60' : strong ? 'font-extrabold text-ink' : value >= 0.7 ? 'font-bold text-ink' : 'font-semibold text-ink-2'
        }`}
        style={{ background: value === null ? 'var(--color-bg)' : heat(value) }}
      >
        {value === null ? '–' : `${Math.round(value * 100)}`}
        {value !== null && <span className="text-[10px] font-semibold opacity-60">%</span>}
      </div>
    </td>
  )
}

/** 목장별 월 출석률 (진할수록 출석률이 높아요) */
export function GroupHeatmap({ groups, stats }: { groups: Group[]; stats: MonthStat[] }) {
  const months = useMemo(() => stats.filter((s) => s.sundays.length > 0), [stats])
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    for (const g of sortGroups(groups)) {
      let present = 0
      let possible = 0
      const cells = months.map((m) => {
        const v = m.byGroup.get(g.id)
        if (!v || v.possible === 0) return null
        present += v.present
        possible += v.possible
        return v.rate
      })
      if (possible === 0) continue
      out.push({ id: g.id, name: g.name, cells, year: rate(present, possible) })
    }
    return out
  }, [groups, months])
  const total = useMemo(() => {
    let present = 0
    let possible = 0
    for (const m of months) {
      present += m.present
      possible += m.possible
    }
    return { cells: months.map((m) => m.rate), year: rate(present, possible) }
  }, [months])

  // 휴대폰처럼 표가 넘치면 최근 달이 먼저 보이도록 오른쪽 끝으로 (연간 칸은 늘 오른쪽에 붙어 있다)
  const scroller = useRef<HTMLDivElement>(null)
  const lastMonth = months[months.length - 1]?.month
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [lastMonth])

  if (months.length === 0 || rows.length === 0)
    return <Card className="px-5 py-8 text-center text-sm text-ink-3">이 해에는 아직 목장별 기록이 없어요.</Card>

  return (
    <Card className="overflow-hidden">
      {/* contain-inline-size: 표 너비가 바깥(페이지) 너비를 밀어 넓히지 않도록 */}
      <div ref={scroller} className="overflow-x-auto overscroll-x-contain contain-inline-size">
        <table className="w-full border-separate border-spacing-0 text-left">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-surface py-3 pr-2 pl-4 text-[13px] font-semibold text-ink-3">목장</th>
              {months.map((m) => (
                <th key={m.month} className="px-0.5 py-3 text-center text-[13px] font-semibold text-ink-3">
                  {Number(m.month.slice(5, 7))}월
                </th>
              ))}
              <th className={`${YEAR_COL} py-3 text-center text-[13px] font-bold text-ink`}>연간</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <th scope="row" className="sticky left-0 z-10 bg-surface py-0 pr-2 pl-4 text-[14px] leading-tight font-semibold">
                  {/* 'Living hope'처럼 긴 이름은 휴대폰에서 두 줄로 */}
                  <span className="block max-w-[88px] lg:max-w-none lg:whitespace-nowrap">{r.name}</span>
                </th>
                {r.cells.map((v, i) => (
                  <Cell key={months[i].month} value={v} />
                ))}
                <td className={`${YEAR_COL} py-0.5`}>
                  <YearCell value={r.year} />
                </td>
              </tr>
            ))}
            <tr>
              <th scope="row" className="sticky left-0 z-10 border-t border-line bg-surface pt-1.5 pr-2 pb-3 pl-4 text-[14px] font-extrabold">
                전체
              </th>
              {total.cells.map((v, i) => (
                <td key={months[i].month} className="border-t border-line p-0.5 pt-1.5 pb-3">
                  <div className="tabular flex h-10 min-w-[44px] items-center justify-center text-[13px] font-extrabold lg:min-w-[38px]">
                    {v === null ? '–' : `${Math.round(v * 100)}%`}
                  </div>
                </td>
              ))}
              <td className={`${YEAR_COL} border-t border-line pt-1.5 pb-3`}>
                <YearCell value={total.year} strong />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line bg-[#fbfbf9] px-4 py-2.5 text-[13px] text-ink-3">
        <span>낮음</span>
        <span className="flex overflow-hidden rounded-full">
          {[0.1, 0.3, 0.5, 0.7, 0.9].map((v) => (
            <span key={v} className="h-2.5 w-5" style={{ background: heat(v) }} />
          ))}
        </span>
        <span>높음</span>
      </div>
    </Card>
  )
}

/** 연간 칸: 표를 옆으로 밀어도 오른쪽에 붙어 있다 */
const YEAR_COL = 'sticky right-0 z-10 bg-surface pr-4 pl-1.5'

function YearCell({ value, strong }: { value: number | null; strong?: boolean }) {
  return (
    <div
      className={`tabular flex h-10 min-w-[56px] items-center justify-center rounded-lg text-[14px] ${
        value === null ? 'bg-bg text-ink-3' : strong ? 'bg-ink font-extrabold text-white' : 'bg-ink/[0.06] font-extrabold text-ink'
      }`}
    >
      {value === null ? '–' : `${Math.round(value * 100)}%`}
    </div>
  )
}
