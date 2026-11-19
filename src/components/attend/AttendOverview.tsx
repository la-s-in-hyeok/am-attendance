import { useCallback, useLayoutEffect, useMemo } from 'react'
import { groupDayKey, useStore } from '../../store'
import { useWeek } from '../../hooks'
import { Button, Card, Empty, Icon, PageHeader, SyncBadge, WeekSwitcher } from '../ui'
import { NotifyButton } from '../notify/NotifyButton'
import { SummaryCard } from './SummaryCard'
import { MemberSearch } from './MemberSearch'
import { GroupCard, staffLine } from './GroupCard'
import { WeekNoteEditor } from './WeekNoteEditor'

/** 목장에 들어갔다 나오면 보던 자리로 돌아오기 위한 스크롤 위치 */
let returnScrollY: number | null = null

/** 출석 탭 첫 화면: 주일 요약 + 이름 찾기 + 목장 목록 + 기타 기록 */
export function AttendOverview() {
  const { date, week, totals } = useWeek()
  const openGroup = useStore((s) => s.openGroup)
  const setTab = useStore((s) => s.setTab)
  const groupDays = useStore((s) => s.groupDays)

  useLayoutEffect(() => {
    if (returnScrollY !== null) {
      window.scrollTo(0, returnScrollY)
      returnScrollY = null
    }
  }, [])

  const open = useCallback(
    (id: string) => {
      returnScrollY = window.scrollY
      openGroup(id)
    },
    [openGroup],
  )

  const cards = useMemo(
    () => week.map((gw) => ({ gw, staff: staffLine(gw), dayState: groupDays[groupDayKey(date, gw.group.id)]?.state })),
    [week, groupDays, date],
  )
  // 목장원이 없는 목장은 '완료'를 누를 수 없으니 세지 않는다
  const countable = cards.filter((c) => c.gw.entries.length > 0)
  const doneCount = countable.filter((c) => c.dayState === 'done').length
  const allDone = countable.length > 0 && doneCount === countable.length

  return (
    <div className="anim-fade">
      <PageHeader
        title="출석"
        right={
          <div className="flex items-center gap-2.5">
            <SyncBadge />
            <NotifyButton />
          </div>
        }
      />

      <div className="space-y-4">
        <Card className="p-2">
          <WeekSwitcher />
        </Card>

        {week.length === 0 ? (
          <Card>
            <Empty title="아직 목장이 없어요">
              관리 탭에서 목장과 목장원을 먼저 추가해 주세요.
              <div className="mt-5">
                <Button icon="settings" onClick={() => setTab('manage')}>
                  관리 탭으로 가기
                </Button>
              </div>
            </Empty>
          </Card>
        ) : (
          <>
            <SummaryCard totals={totals} date={date} />

            <MemberSearch week={week} date={date} />

            <section>
              <div className="mb-2.5 flex items-end justify-between gap-2 px-1 pt-2">
                <h2 className="text-[19px] font-extrabold tracking-tight">목장별 출석</h2>
                <span
                  className={`tabular inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-bold ${
                    allDone ? 'bg-ok/10 text-ok' : 'bg-[#ececE7] text-ink-2'
                  }`}
                >
                  {allDone && <Icon name="check" size={13} strokeWidth={2.8} />}
                  완료 {doneCount} / {countable.length} 목장
                </span>
              </div>
              {/* 목록 폭이 넉넉할 때만 두 줄로 (태블릿처럼 옆 메뉴 때문에 좁으면 한 줄) */}
              <div className="@container">
                <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2">
                  {cards.map(({ gw, staff, dayState }) => (
                    <GroupCard key={gw.group.id} group={gw.group} summary={gw.summary} staff={staff} dayState={dayState} onOpen={open} />
                  ))}
                </div>
              </div>
            </section>

            <div className="pt-2">
              <WeekNoteEditor key={date} date={date} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
