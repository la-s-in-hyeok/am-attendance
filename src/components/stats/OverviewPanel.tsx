import { useMemo } from 'react'
import type { AttendanceRecord } from '../../lib/types'
import type { MonthStat } from '../../lib/compute'
import { useStore } from '../../store'
import { useRecordList } from '../../hooks'
import { Card, SERVICE_STYLE } from '../ui'
import { Section } from './parts'
import { KpiTiles, type Kpi } from './KpiTiles'
import { MonthlyChart } from './MonthlyChart'
import { WeeklyTrend } from './WeeklyTrend'
import { monthNoteCounts, monthServiceSplit, servicePcts, sundaysInMonthSoFar, weekPoints } from './statsCompute'

/** '한눈에' 칸: 고른 달의 요약 + 월별 그래프 + 주일별 출석 */
export function OverviewPanel({
  month,
  yearRate,
  sel,
  prev,
  yearStats,
  cur,
  index,
  onSelectMonth,
  onOpenWeek,
}: {
  month: string
  /** 그 해 평균 출석률 */
  yearRate: number | null
  /** 고른 달 */
  sel: MonthStat | undefined
  /** 고른 달의 지난달 (비교용) */
  prev: MonthStat | undefined
  /** 그 해 1~12월 */
  yearStats: MonthStat[]
  cur: string
  index: Map<string, AttendanceRecord>
  onSelectMonth: (ym: string) => void
  onOpenWeek: (date: string) => void
}) {
  const groups = useStore((s) => s.groups)
  const members = useStore((s) => s.members)
  const notes = useStore((s) => s.notes)
  const records = useRecordList()

  // 월별 출석 인원 합을 1부·2부로 (그래프용, yearStats 와 같은 순서)
  const yearSplit = useMemo(() => monthServiceSplit(groups, members, records, yearStats), [groups, members, records, yearStats])

  // 고른 달의 주일별 합계
  const points = useMemo(() => weekPoints(groups, members, index, notes, sel?.sundays ?? []), [groups, members, index, notes, sel])

  const kpi = useMemo<Kpi>(() => {
    const nc = monthNoteCounts(notes, month)
    let grand = 0
    let s1 = 0
    let s2 = 0
    for (const p of points) {
      grand += p.totals.grandTotal
      s1 += p.totals.service1
      s2 += p.totals.service2
    }
    const n = points.length
    return {
      rate: sel?.rate ?? null,
      prevRate: prev && prev.sundays.length > 0 ? prev.rate : null,
      avgAttend: n > 0 ? grand / n : null,
      avgParts: n > 0 ? { service1: s1 / n, service2: s2 / n, extra: (grand - s1 - s2) / n } : null,
      heldCount: points.length,
      sundayCount: sundaysInMonthSoFar(month, cur),
      newcomers: nc.newcomers,
      visitors: nc.visitors,
      barnabas: nc.barnabas,
    }
  }, [notes, month, points, sel, prev, cur])

  const mLabel = `${Number(month.slice(5, 7))}월`
  const isThisMonth = month === cur.slice(0, 7)
  const selIdx = yearStats.findIndex((s) => s.month === month)
  const selHas = !!sel && sel.sundays.length > 0 && sel.rate !== null
  const [sel1, sel2] = servicePcts(sel, yearSplit[selIdx])
  const year = month.slice(0, 4)

  return (
    <>
      <div className="mb-2.5 flex min-h-6 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1">
        <div className="flex items-center gap-2">
          <h2 className="text-[17px] leading-tight font-bold tracking-tight">{mLabel} 한눈에</h2>
          {isThisMonth && (
            <span className="inline-flex h-[22px] items-center rounded-full bg-accent px-2 text-[12px] font-bold text-accent-ink">이번 달</span>
          )}
        </div>
        <p className="tabular text-[13px] text-ink-3">
          새신자 <b className="font-bold text-ink-2">{kpi.newcomers}</b> · 방문 <b className="font-bold text-ink-2">{kpi.visitors}</b> · 바나바{' '}
          <b className="font-bold text-ink-2">{kpi.barnabas}</b>
        </p>
      </div>
      <KpiTiles kpi={kpi} />

      <Card className="mt-3 px-3 pt-3.5 pb-2 sm:px-5 sm:pt-4">
        <div className="flex items-center justify-between gap-3 px-1">
          <h3 className="text-[15px] leading-tight font-bold">월별 출석률</h3>
          <span className="flex items-center gap-3 text-[12px] font-medium text-ink-3">
            {([1, 2] as const).map((sv) => (
              <span key={sv} className="inline-flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-[3px] ${SERVICE_STYLE[sv].bg}`} />
                {SERVICE_STYLE[sv].label}
              </span>
            ))}
          </span>
        </div>
        <div className="tabular mt-0.5 mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 px-1 text-[13px] text-ink-3">
          <span>
            {year}년 평균 <b className="font-bold text-ink-2">{yearRate === null ? '-' : `${Math.round(yearRate * 100)}%`}</b>
          </span>
          {selHas && (
            <span>
              <b className="font-semibold text-brand-ink">{mLabel}</b> 1부 <b className="font-bold text-ink-2">{sel1}%</b> · 2부{' '}
              <b className="font-bold text-ink-2">{sel2}%</b>
            </span>
          )}
        </div>
        <MonthlyChart stats={yearStats} split={yearSplit} selected={month} onSelect={onSelectMonth} lastMonth={cur.slice(0, 7)} />
      </Card>

      <Section title={`${mLabel} 주일별 출석`}>
        <WeeklyTrend points={points} onOpen={onOpenWeek} />
      </Section>
    </>
  )
}
