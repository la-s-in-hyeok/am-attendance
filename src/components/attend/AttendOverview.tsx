import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import { groupDayKey, useStore } from '../../store'
import { useWeek } from '../../hooks'
import { Button, Card, Empty, Icon, PageHeader, SyncBadge, WeekSwitcher } from '../ui'
import { NotifyButton } from '../notify/NotifyButton'
import { SummaryCard } from './SummaryCard'
import { MemberSearch } from './MemberSearch'
import { GroupCard, staffLine } from './GroupCard'
import { WeekNoteSheet } from './WeekNoteSheet'
import type { NoteSection } from './WeekNoteEditor'

/** 목장에 들어갔다 나오면 보던 자리로 돌아오기 위한 스크롤 위치 */
let returnScrollY: number | null = null

/** 출석 탭 첫 화면: 주일 요약(새신자·방문 포함) + 이름 찾기 + 목장 칸 (휴대폰 한 화면에 들어가게) */
export function AttendOverview() {
  const { date, week, totals } = useWeek()
  const openGroup = useStore((s) => s.openGroup)
  const setTab = useStore((s) => s.setTab)
  const groupDays = useStore((s) => s.groupDays)
  /** 새신자·방문 창 (어느 칸을 눌러 열었는지) */
  const [notes, setNotes] = useState<NoteSection | null>(null)

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
  const openNotes = useCallback((section: NoteSection) => setNotes(section), [])
  const closeNotes = useCallback(() => setNotes(null), [])

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
          // 휴대폰에서 한 줄에 안 들어가면 제목을 밀지 않고 두 줄로 (알림 버튼 위, 저장 상태 아래)
          <div className="flex max-w-[calc(100vw-12rem)] flex-wrap-reverse items-center justify-end gap-x-2.5 gap-y-1 md:max-w-none">
            <SyncBadge />
            <NotifyButton />
          </div>
        }
      >
        <WeekSwitcher />
      </PageHeader>

      <div className="space-y-3">
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
            <SummaryCard totals={totals} onOpenNotes={openNotes} />

            <MemberSearch week={week} date={date} />

            <section>
              <div className="mb-2.5 flex items-center justify-between gap-2 px-0.5 pt-0.5">
                <h2 className="text-[16px] font-bold">목장</h2>
                <span className="tabular inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-ink-2">
                  {allDone && <Icon name="check" size={14} strokeWidth={2.8} className="text-ok" />}
                  완료 <b className="font-bold text-ok">{doneCount}</b> / {countable.length}
                </span>
              </div>
              {/* 번호판처럼: 휴대폰 3칸(아주 좁으면 2칸), 목록 폭이 넓어지면 4·5칸 */}
              <div className="@container">
                <div className="grid grid-cols-2 gap-2 @min-[19rem]:grid-cols-3 @md:grid-cols-4 @2xl:grid-cols-5 md:gap-3">
                  {cards.map(({ gw, staff, dayState }) => (
                    <GroupCard key={gw.group.id} group={gw.group} summary={gw.summary} staff={staff} dayState={dayState} onOpen={open} />
                  ))}
                </div>
              </div>
            </section>
          </>
        )}
      </div>

      <WeekNoteSheet date={date} open={notes !== null} section={notes ?? undefined} onClose={closeNotes} />
    </div>
  )
}
