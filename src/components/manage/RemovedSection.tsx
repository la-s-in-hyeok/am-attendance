import { useMemo, useState } from 'react'
import { useStore } from '../../store'
import type { Group, Member } from '../../lib/types'
import { sortGroups } from '../../lib/compute'
import { Button, Sheet } from '../ui'
import { Callout, Collapsible, GroupPicker, SectionTitle } from './parts'
import { labelDay, restoreGapNote } from './lib'
import { useGroupMap, useRosterSplit } from './useManage'

const PAGE = 20

/** 명단에서 뺀 사람(다시 넣기)과 삭제한 목장(되살리기) */
export function RemovedSection() {
  const { removed } = useRosterSplit()
  const groups = useStore((s) => s.groups)
  const date = useStore((s) => s.date)
  const restoreMember = useStore((s) => s.restoreMember)
  const updateGroup = useStore((s) => s.updateGroup)
  const toast = useStore((s) => s.toast)
  const groupMap = useGroupMap()
  const [showAll, setShowAll] = useState(false)
  /** 다시 넣기 확인 / 넣을 목장 고르기 */
  const [restoring, setRestoring] = useState<Member | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const archived = useMemo(() => sortGroups(groups.filter((g) => g.archived)), [groups])
  const sorted = useMemo(
    () =>
      [...removed].sort(
        (a, b) => (b.removedOn ?? '').localeCompare(a.removedOn ?? '') || a.name.localeCompare(b.name, 'ko'),
      ),
    [removed],
  )

  if (sorted.length === 0 && archived.length === 0) return null

  /** 원래 목장이 남아 있으면 그 목장 */
  const homeOf = (m: Member): Group | null => {
    const g = groupMap.get(m.groupId)
    return g && !g.archived ? g : null
  }

  function askRestore(m: Member) {
    // 바로 지난번에 뺀 사람(빠진 기간이 없음)이고 원래 목장이 있으면 확인 없이 되돌린다
    const home = homeOf(m)
    if (home && !restoreGapNote(m, date)) void restoreInto(m, home)
    else setRestoring(m)
  }

  async function restoreInto(m: Member, g: Group) {
    setBusyId(m.id)
    // 다시 넣으면서 고른 목장으로 옮기는 것까지 한 번에 저장한다
    const ok = await restoreMember(m.id, g.id)
    setBusyId(null)
    // 실패하면 store 가 화면을 되돌리고 오류를 알려 준다. 확인 창은 열어 두어 다시 누를 수 있게
    if (!ok) return
    setRestoring(null)
    toast(`${m.name}님을 다시 ${g.name} 목장 명단에 넣었어요`, 'success')
  }

  async function revive(g: Group) {
    setBusyId(g.id)
    const fresh = useStore.getState().groups.find((x) => x.id === g.id) ?? g
    const ok = await updateGroup({ ...fresh, archived: false })
    setBusyId(null)
    if (ok) toast(`${g.name} 목장을 되살렸어요`, 'success')
  }

  const visible = showAll ? sorted : sorted.slice(0, PAGE)
  const restoringHome = restoring ? homeOf(restoring) : null
  const restoringGap = restoring ? restoreGapNote(restoring, date) : null
  const restoringBusy = !!restoring && busyId === restoring.id

  return (
    <section className="mt-10">
      <SectionTitle>보관함</SectionTitle>
      <div className="space-y-3">
        {sorted.length > 0 && (
          <Collapsible icon="undo" title="명단에서 뺀 사람" count={`${sorted.length}명`}>
            <p className="px-4 py-3 text-[13px] leading-relaxed text-ink-3">
              지난 출석 기록은 남아 있어요. 다시 넣으면 기록이 그대로 이어져요.
            </p>
            {visible.map((m) => {
              const g = groupMap.get(m.groupId)
              return (
                <div key={m.id} className="flex min-h-[64px] items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-semibold">{m.name}</span>
                    <span className="block truncate text-[13px] text-ink-3">
                      {g ? `${g.name} 목장${g.archived ? '(삭제됨)' : ''}` : '목장 없음'}
                      {m.removedOn ? ` · ${labelDay(m.removedOn)}부터 빠짐` : ''}
                    </span>
                  </span>
                  <Button variant="secondary" icon="undo" className="shrink-0" disabled={busyId === m.id} onClick={() => askRestore(m)}>
                    다시 넣기
                  </Button>
                </div>
              )
            })}
            {!showAll && sorted.length > PAGE && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="h-12 w-full text-sm font-semibold text-ink-2 hover:bg-black/[0.02]"
              >
                {sorted.length - PAGE}명 더 보기
              </button>
            )}
          </Collapsible>
        )}

        {archived.length > 0 && (
          <Collapsible icon="trash" title="삭제한 목장" count={`${archived.length}개`}>
            <p className="px-4 py-3 text-[13px] leading-relaxed text-ink-3">
              지난 출석 기록과 보고서에는 남아 있어요. 되살리면 목장 목록에 다시 나와요.
            </p>
            {archived.map((g) => (
              <div key={g.id} className="flex min-h-[64px] items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1 truncate text-[16px] font-semibold">{g.name}</span>
                <Button variant="secondary" icon="undo" className="shrink-0" disabled={busyId === g.id} onClick={() => void revive(g)}>
                  되살리기
                </Button>
              </div>
            ))}
          </Collapsible>
        )}
      </div>

      {restoring && (
        <Sheet
          open
          onClose={() => setRestoring(null)}
          title={restoringHome ? `${restoring.name}님을 다시 넣을까요?` : `${restoring.name}님을 어느 목장에 넣을까요?`}
        >
          {restoringGap && (
            <Callout tone="warn" icon="calendar" className="mb-4">
              {restoringGap}
            </Callout>
          )}
          {restoringHome ? (
            <>
              <p className="mb-5 text-[15px] leading-relaxed text-ink-2">
                {restoringHome.name} 목장 명단으로 돌아가요. 지난 출석 기록도 그대로 이어져요.
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setRestoring(null)}>
                  취소
                </Button>
                <Button className="flex-1" disabled={restoringBusy} onClick={() => void restoreInto(restoring, restoringHome)}>
                  {restoringBusy ? '넣는 중…' : '다시 넣기'}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="mb-4 text-[15px] leading-relaxed text-ink-2">
                원래 있던 {groupMap.get(restoring.groupId)?.name ?? ''} 목장은 삭제되어 있어요. 넣을 목장을 골라 주세요.
              </p>
              <GroupPicker disabled={restoringBusy} onPick={(g) => void restoreInto(restoring, g)} />
              <Button variant="secondary" className="mt-5 w-full" onClick={() => setRestoring(null)}>
                취소
              </Button>
            </>
          )}
        </Sheet>
      )}
    </section>
  )
}
