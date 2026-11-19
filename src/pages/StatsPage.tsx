import { useCallback, useMemo, useState } from 'react'
import type { Member } from '../lib/types'
import { heldSundays, indexRecords, memberStats, monthlyStats, rate } from '../lib/compute'
import { currentSunday, labelMonth, monthRange, todayKST } from '../lib/dates'
import { useStore } from '../store'
import { useRecordList } from '../hooks'
import { Card, Empty, PageHeader, Segmented } from '../components/ui'
import { Section, YearSwitcher } from '../components/stats/parts'
import { KpiTiles, type Kpi } from '../components/stats/KpiTiles'
import { MonthlyChart } from '../components/stats/MonthlyChart'
import { WeeklyTrend } from '../components/stats/WeeklyTrend'
import { GroupHeatmap } from '../components/stats/GroupHeatmap'
import { CareList } from '../components/stats/CareList'
import { MemberList } from '../components/stats/MemberList'
import { MemberSheet } from '../components/stats/MemberSheet'
import {
  CARE_MIN_STREAK,
  availableYears,
  careList,
  defaultMonthFor,
  memberService2,
  monthNoteCounts,
  monthServiceSplit,
  monthsOfYear,
  prevMonth,
  sundaysInMonthSoFar,
  weekPoints,
} from '../components/stats/statsCompute'

type Scope = 'month' | 'year'

export function StatsPage() {
  const groups = useStore((s) => s.groups)
  const members = useStore((s) => s.members)
  const notes = useStore((s) => s.notes)
  const ensureLoadedFrom = useStore((s) => s.ensureLoadedFrom)
  const toast = useStore((s) => s.toast)
  const setDate = useStore((s) => s.setDate)
  const setTab = useStore((s) => s.setTab)
  const records = useRecordList()

  const cur = currentSunday()
  const today = todayKST()
  const curYear = Number(cur.slice(0, 4))
  const maxYear = Math.max(curYear, Number(today.slice(0, 4)))

  const [year, setYear] = useState(curYear)
  const [monthChoice, setMonthChoice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [scope, setScope] = useState<Scope>('month')
  const [person, setPerson] = useState<Member | null>(null)

  const years = useMemo(() => availableYears(members, records, maxYear), [members, records, maxYear])
  const index = useMemo(() => indexRecords(records), [records])
  const held = useMemo(() => [...heldSundays(records)].sort(), [records])

  // 1~12월 + 비교용 지난해 12월
  const months = useMemo(() => monthsOfYear(year), [year])
  const allStats = useMemo(
    () => monthlyStats(groups, members, records, [prevMonth(months[0]), ...months]),
    [groups, members, records, months],
  )
  const yearStats = useMemo(() => allStats.slice(1), [allStats])
  const yearHasData = yearStats.some((s) => s.sundays.length > 0)
  // 월별 출석 인원 합을 1부·2부로 (그래프용, yearStats 와 같은 순서)
  const yearSplit = useMemo(() => monthServiceSplit(groups, members, records, yearStats), [groups, members, records, yearStats])

  const month = monthChoice && monthChoice.startsWith(`${year}-`) ? monthChoice : defaultMonthFor(year, cur, yearStats)
  const mIdx = months.indexOf(month)
  const sel = yearStats[mIdx]
  const prev = allStats[mIdx] // allStats 는 한 칸 앞에서 시작하므로 같은 번호가 지난달

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
    }
  }, [notes, month, points, sel, prev, cur])

  const yearRate = useMemo(() => {
    let p = 0
    let t = 0
    for (const s of yearStats) {
      p += s.present
      t += s.possible
    }
    return rate(p, t)
  }, [yearStats])

  // 관심이 필요한 사람: 고른 해와 상관없이 '지금' 기준
  const care = useMemo(
    () =>
      careList(groups, members, records, index, cur, today === cur).sort(
        (a, b) => b.streak - a.streak || a.member.name.localeCompare(b.member.name, 'ko'),
      ),
    [groups, members, records, index, cur, today],
  )

  // 개인별 현황 (월/연)
  const range = scope === 'month' ? monthRange(month) : { from: `${year}-01-01`, to: `${year}-12-31` }
  const people = useMemo(
    () => memberStats(members, records, range.from, range.to).filter((s) => s.weeks > 0),
    [members, records, range.from, range.to],
  )
  const peopleService2 = useMemo(() => memberService2(members, records, range.from, range.to), [members, records, range.from, range.to])

  const chooseYear = useCallback(
    async (y: number) => {
      setYear(y)
      setMonthChoice(null)
      const from = `${y}-01-01`
      if (from < useStore.getState().loadedFrom) {
        setLoading(true)
        try {
          await ensureLoadedFrom(from)
        } catch (e) {
          console.error(e)
          toast('지난 기록을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.', 'error')
        } finally {
          setLoading(false)
        }
      }
    },
    [ensureLoadedFrom, toast],
  )

  const openWeek = useCallback(
    (d: string) => {
      setDate(d)
      setTab('report')
    },
    [setDate, setTab],
  )

  const closePerson = useCallback(() => setPerson(null), [])

  const mLabel = `${Number(month.slice(5, 7))}월`

  const header = (
    <PageHeader
      title="통계"
      sub={yearHasData ? `${year}년 평균 출석률 ${yearRate === null ? '-' : `${Math.round(yearRate * 100)}%`}` : undefined}
      right={<YearSwitcher year={year} years={years} loading={loading} onChange={(y) => void chooseYear(y)} />}
    />
  )

  if (records.length === 0 && !loading)
    return (
      <div className="anim-fade contain-inline-size">
        {header}
        <Card>
          <Empty title="아직 출석 기록이 없어요" />
        </Card>
      </div>
    )

  // contain-inline-size: 긴 표·그래프의 너비가 PC 화면 전체를 밀어 넓히지 않도록
  return (
    <div className="anim-fade contain-inline-size">
      {header}

      {!yearHasData && !loading && (
        <Card className="mb-4">
          <Empty title={`${year}년에는 출석 기록이 없어요`}>다른 해를 골라 보세요.</Empty>
        </Card>
      )}

      {yearHasData && (
        <>
          <h2 className="mb-3 px-1 text-[19px] font-bold tracking-tight">{labelMonth(month)}</h2>
          <KpiTiles kpi={kpi} monthLabel={mLabel} />

          <Card className="mt-3 px-3 pt-4 pb-2 sm:px-5">
            <div className="mb-1 flex items-baseline justify-between px-1">
              <p className="text-[15px] font-bold">월별 출석률</p>
              <p className="text-[13px] text-ink-3">막대를 누르면 그 달을 봐요</p>
            </div>
            <MonthlyChart stats={yearStats} split={yearSplit} selected={month} onSelect={setMonthChoice} lastMonth={cur.slice(0, 7)} />
          </Card>

          <Section title={`${mLabel} 주일별 출석`} sub="주일을 누르면 그 주 보고서로 가요">
            <WeeklyTrend points={points} onOpen={openWeek} />
          </Section>
        </>
      )}

      <Section title="관심이 필요한 사람" sub={`출석 받은 주일 기준, ${CARE_MIN_STREAK}주 이상 연속으로 못 나온 분들이에요`}>
        <CareList items={care} groups={groups} onOpen={setPerson} />
      </Section>

      {yearHasData && (
        <>
          <Section title="목장별 출석률" sub={`${year}년, 색이 진할수록 출석률이 높아요`}>
            <GroupHeatmap groups={groups} stats={yearStats} />
          </Section>

          <Section
            title="개인별 출석 현황"
            sub={scope === 'month' ? `${labelMonth(month)} 기준` : `${year}년 전체 기준`}
            right={
              <Segmented<Scope>
                value={scope}
                onChange={setScope}
                className="max-md:*:h-11"
                options={[
                  { value: 'month', label: mLabel },
                  { value: 'year', label: `${year}년` },
                ]}
              />
            }
          >
            <MemberList stats={people} service2={peopleService2} groups={groups} today={cur} onOpen={setPerson} />
          </Section>
        </>
      )}

      <MemberSheet member={person} year={year} held={held} onClose={closePerson} />
    </div>
  )
}
