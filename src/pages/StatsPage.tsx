import { useCallback, useMemo, useState } from 'react'
import type { Member } from '../lib/types'
import { heldSundays, indexRecords, monthlyStats, rate } from '../lib/compute'
import { currentSunday, todayKST } from '../lib/dates'
import { useStore } from '../store'
import { useRecordList } from '../hooks'
import { Card, Empty, PageHeader, Segmented } from '../components/ui'
import { YearSwitcher } from '../components/stats/parts'
import { OverviewPanel } from '../components/stats/OverviewPanel'
import { GroupHeatmap } from '../components/stats/GroupHeatmap'
import { CarePanel } from '../components/stats/CarePanel'
import { FIND_START, FindPanel, type FindState } from '../components/stats/FindPanel'
import { MemberSheet } from '../components/stats/MemberSheet'
import { availableYears, defaultMonthFor, monthsOfYear, prevMonth } from '../components/stats/statsCompute'

type View = 'overview' | 'groups' | 'care' | 'find'

const VIEWS: { value: View; label: string }[] = [
  { value: 'overview', label: '한눈에' },
  { value: 'groups', label: '목장별' },
  { value: 'care', label: '관심 필요' },
  { value: 'find', label: '개인 찾기' },
]

/** 마지막으로 고른 칸. 앱을 닫기 전까지는 다른 탭에 다녀와도 그 칸으로 돌아온다 */
let lastView: View = 'overview'

export function StatsPage() {
  const groups = useStore((s) => s.groups)
  const members = useStore((s) => s.members)
  const ensureLoadedFrom = useStore((s) => s.ensureLoadedFrom)
  const toast = useStore((s) => s.toast)
  const setDate = useStore((s) => s.setDate)
  const setTab = useStore((s) => s.setTab)
  const records = useRecordList()

  const cur = currentSunday()
  const today = todayKST()
  const curYear = Number(cur.slice(0, 4))
  const maxYear = Math.max(curYear, Number(today.slice(0, 4)))

  const [view, setView] = useState<View>(lastView)
  const [year, setYear] = useState(curYear)
  const [monthChoice, setMonthChoice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [find, setFind] = useState<FindState>(FIND_START)
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

  const month = monthChoice && monthChoice.startsWith(`${year}-`) ? monthChoice : defaultMonthFor(year, cur, yearStats)
  const mIdx = months.indexOf(month)
  const sel = yearStats[mIdx]
  const prev = allStats[mIdx] // allStats 는 한 칸 앞에서 시작하므로 같은 번호가 지난달

  const yearRate = useMemo(() => {
    let p = 0
    let t = 0
    for (const s of yearStats) {
      p += s.present
      t += s.possible
    }
    return rate(p, t)
  }, [yearStats])

  const chooseView = useCallback((v: View) => {
    lastView = v
    setView(v)
  }, [])

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

  // 휴대폰(360px)에서도 네 칸이 한 줄에 같은 너비로 들어가도록 칸 안 여백을 줄인다
  const tabs = (
    <div role="group" aria-label="통계 보기">
      <Segmented<View> value={view} onChange={chooseView} options={VIEWS} className="w-full *:min-w-0 max-md:*:px-1 md:max-w-xl" />
    </div>
  )

  const header = (hasTabs: boolean) => (
    <PageHeader
      title="통계"
      right={<YearSwitcher year={year} years={years} loading={loading} onChange={(y) => void chooseYear(y)} />}
    >
      {hasTabs ? tabs : undefined}
    </PageHeader>
  )

  if (records.length === 0 && !loading)
    return (
      <div className="anim-fade contain-inline-size">
        {header(false)}
        <Card>
          <Empty title="아직 출석 기록이 없어요" />
        </Card>
      </div>
    )

  // '관심 필요'는 고른 해와 상관없이 지금 기준이라 해마다 기록이 없어도 보여 준다
  const byYear = view !== 'care'

  // contain-inline-size: 긴 표·그래프의 너비가 PC 화면 전체를 밀어 넓히지 않도록
  return (
    <div className="anim-fade contain-inline-size">
      {header(true)}

      {byYear && !yearHasData && (
        <Card>
          {loading ? (
            <p className="px-5 py-8 text-center text-sm text-ink-3">불러오는 중이에요</p>
          ) : (
            <Empty title={`${year}년에는 출석 기록이 없어요`}>다른 해를 골라 보세요.</Empty>
          )}
        </Card>
      )}

      {yearHasData && view === 'overview' && (
        <OverviewPanel
          month={month}
          yearRate={yearRate}
          sel={sel}
          prev={prev}
          yearStats={yearStats}
          cur={cur}
          index={index}
          onSelectMonth={setMonthChoice}
          onOpenWeek={openWeek}
        />
      )}

      {yearHasData && view === 'groups' && <GroupHeatmap groups={groups} stats={yearStats} />}

      {view === 'care' && <CarePanel index={index} cur={cur} today={today} onOpen={setPerson} />}

      {yearHasData && view === 'find' && (
        <FindPanel value={find} onChange={setFind} month={month} year={year} today={cur} onOpen={setPerson} />
      )}

      <MemberSheet member={person} year={year} held={held} onClose={closePerson} />
    </div>
  )
}
