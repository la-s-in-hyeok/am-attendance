import { useMemo, useState } from 'react'
import { useStore } from '../../store'
import type { Group } from '../../lib/types'
import { removalDate, rosterChangeFrom } from '../../lib/roster'
import { useActiveGroups } from '../../hooks'
import { Button, Sheet } from '../ui'
import { Bullets, Callout, GroupPicker, MenuRow, ViewingDateNotice } from './parts'
import { labelDay, weekdayRuleNote } from './lib'

type View = 'start' | 'pick' | 'confirmMove' | 'confirmRemove'

/**
 * 목장 삭제 (= 보관). 지난 기록은 남는다.
 * 아직 목장원이 있으면 먼저 다른 목장으로 옮기거나 명단에서 빼야 한다.
 */
export function GroupDeleteSheet({ group, onClose }: { group: Group; onClose: () => void }) {
  const members = useStore((s) => s.members)
  const records = useStore((s) => s.records)
  const date = useStore((s) => s.date)
  const updateGroup = useStore((s) => s.updateGroup)
  const moveMember = useStore((s) => s.moveMember)
  const removeMember = useStore((s) => s.removeMember)
  const toast = useStore((s) => s.toast)
  const others = useActiveGroups().filter((g) => g.id !== group.id)

  const current = useMemo(() => members.filter((m) => m.groupId === group.id && m.removedOn === null), [members, group.id])
  const n = current.length

  /** 목장 이동·빼기가 적용되는 주일 (lib/roster.ts) */
  const changeFrom = rosterChangeFrom(date)
  const weekdayNote = weekdayRuleNote(date)
  /** 적용 주일이나 그 뒤에 이미 출석 기록이 있어서 더 늦게 빠지는 사람이 있는지 */
  const someRemoveLater = useMemo(() => {
    const list = Object.values(records)
    return current.some((m) => removalDate(m.id, list, date) > changeFrom)
  }, [records, current, date, changeFrom])

  const [view, setView] = useState<View>('start')
  const [target, setTarget] = useState<Group | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [archiving, setArchiving] = useState(false)
  const busy = progress !== null || archiving

  /** 목장 보관. 성공하면 doneText 를 알리고 닫는다 */
  async function archive(doneText: string): Promise<boolean> {
    setArchiving(true)
    const fresh = useStore.getState().groups.find((g) => g.id === group.id) ?? group
    const ok = await updateGroup({ ...fresh, archived: true })
    setArchiving(false)
    if (!ok) return false
    toast(doneText, 'success')
    onClose()
    return true
  }

  /**
   * 목장원을 한 명씩 정리한다. 하나라도 실패하면 그 자리에서 멈추고(목장은 삭제하지 않음) 몇 명까지 했는지 알려 준다.
   * 모두 성공하면 true.
   */
  async function processAll(run: (memberId: string) => Promise<boolean>, failText: (done: number, name: string) => string) {
    const list = current.map((m) => ({ id: m.id, name: m.name }))
    setProgress({ done: 0, total: list.length })
    for (let i = 0; i < list.length; i++) {
      if (!(await run(list[i].id))) {
        setProgress(null)
        toast(failText(i, list[i].name), 'error')
        return false
      }
      setProgress({ done: i + 1, total: list.length })
    }
    setProgress(null)
    return true
  }

  /** 멈췄을 때 남은 사람이 없으면(마지막 사람이 반쯤 옮겨진 경우) 처음 화면의 '삭제하기'로 */
  function afterStop() {
    const left = useStore.getState().members.some((m) => m.groupId === group.id && m.removedOn === null)
    if (!left) setView('start')
  }

  async function moveAllThenArchive() {
    if (!target || busy) return
    const to = target
    const total = n
    const allMoved = await processAll(
      (id) => moveMember(id, to.id),
      (done, name) =>
        `${done > 0 ? `${done}명은 ${to.name} 목장으로 옮겼지만, ` : ''}${name}님을 옮기지 못해서 멈췄어요. ${group.name} 목장은 삭제하지 않았어요. 다시 해 주세요.`,
    )
    if (!allMoved) return afterStop()
    const ok = await archive(`${total}명을 ${to.name} 목장으로 옮기고, ${group.name} 목장을 삭제했어요`)
    if (!ok) {
      setView('start')
      toast(`${total}명은 ${to.name} 목장으로 옮겼지만, ${group.name} 목장은 삭제하지 못했어요. 다시 해 주세요.`, 'error')
    }
  }

  async function removeAllThenArchive() {
    if (busy) return
    const total = n
    const allRemoved = await processAll(
      (id) => removeMember(id),
      (done, name) =>
        `${done > 0 ? `${done}명은 명단에서 뺐지만, ` : ''}${name}님을 빼지 못해서 멈췄어요. ${group.name} 목장은 삭제하지 않았어요. 다시 해 주세요.`,
    )
    if (!allRemoved) return afterStop()
    const ok = await archive(`${total}명을 명단에서 빼고, ${group.name} 목장을 삭제했어요`)
    if (!ok) {
      setView('start')
      toast(`${total}명은 명단에서 뺐지만, ${group.name} 목장은 삭제하지 못했어요. 다시 해 주세요.`, 'error')
    }
  }

  const title =
    view === 'pick'
      ? '어느 목장으로 옮길까요?'
      : view === 'confirmMove' || view === 'confirmRemove'
        ? '한 번 더 확인해 주세요'
        : n > 0
          ? `목장원이 아직 ${n}명 있어요`
          : `${group.name} 목장을 삭제할까요?`

  const progressText = archiving ? '삭제하는 중…' : progress && `정리하는 중… ${progress.done}/${progress.total}`

  return (
    <Sheet open onClose={busy ? () => {} : onClose} title={title}>
      {view === 'start' && n === 0 && (
        <div className="anim-fade">
          <Bullets
            items={[
              '목장 목록과 앞으로의 출석부에서 사라져요.',
              <>
                <b className="text-ink">지난 출석 기록과 보고서에는 그대로 남아요.</b>
              </>,
              '실수로 지웠다면 관리 화면 아래 ‘삭제한 목장’에서 되살릴 수 있어요.',
            ]}
          />
          <div className="mt-5 flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onClose}>
              취소
            </Button>
            <Button variant="danger" className="flex-1" disabled={busy} onClick={() => void archive(`${group.name} 목장을 삭제했어요`)}>
              {progressText || '삭제하기'}
            </Button>
          </div>
        </div>
      )}

      {view === 'start' && n > 0 && (
        <div className="anim-fade">
          <p className="mb-4 text-[15px] leading-relaxed text-ink-2">
            {group.name} 목장을 삭제하려면 먼저 목장원을 정리해야 해요. 어떻게 할까요?
          </p>
          <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
            {others.length > 0 && (
              <MenuRow
                icon="move"
                title="모두 다른 목장으로 옮기고 삭제"
                sub={`${n}명이 고른 목장으로 한꺼번에 옮겨져요`}
                onClick={() => setView('pick')}
              />
            )}
            <MenuRow icon="logout" title="모두 명단에서 빼고 삭제" sub="지난 출석 기록은 남아요" onClick={() => setView('confirmRemove')} />
            <MenuRow icon="users" title="한 명씩 정리할게요" sub="목장원 이름을 눌러 옮기거나 뺄 수 있어요" onClick={onClose} />
          </div>
          <Button variant="secondary" className="mt-5 w-full" onClick={onClose}>
            취소
          </Button>
        </div>
      )}

      {view === 'pick' && (
        <div className="anim-fade">
          <GroupPicker
            excludeId={group.id}
            onPick={(g) => {
              setTarget(g)
              setView('confirmMove')
            }}
          />
          <Button variant="secondary" className="mt-5 w-full" onClick={() => setView('start')}>
            뒤로
          </Button>
        </div>
      )}

      {view === 'confirmMove' && target && (
        <div className="anim-fade">
          <p className="mb-3 text-[15px] leading-relaxed text-ink-2">
            <b className="text-ink">{n}명</b>을 <b className="text-ink">{target.name}</b> 목장으로 옮기고, <b className="text-ink">{group.name}</b> 목장을
            삭제해요.
          </p>
          <Bullets
            small
            items={[
              <>
                <b className="text-ink-2">{labelDay(changeFrom)} 출석부</b>부터 {target.name} 목장에 나와요. 그 전 출석부는 그대로예요.
              </>,
              `그 전 출석 기록은 ${group.name} 목장 기록으로 남아요.`,
              weekdayNote,
              '목자·총무 역할은 풀려요. 새 목장에서 다시 정해 주세요.',
            ]}
          />
          <ViewingDateNotice className="mt-3" />
          <div className="mt-5 flex gap-2">
            <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => setView('pick')}>
              뒤로
            </Button>
            <Button variant="danger" className="flex-1" disabled={busy} onClick={() => void moveAllThenArchive()}>
              {progressText || '옮기고 삭제'}
            </Button>
          </div>
        </div>
      )}

      {view === 'confirmRemove' && (
        <div className="anim-fade">
          <p className="mb-3 text-[15px] leading-relaxed text-ink-2">
            <b className="text-ink">{n}명</b>을 명단에서 빼고, <b className="text-ink">{group.name}</b> 목장을 삭제해요.
          </p>
          <Bullets
            small
            items={[
              <>
                <b className="text-ink-2">{labelDay(changeFrom)} 출석부</b>부터 빠져요. 그 전 출석부는 그대로예요.
              </>,
              someRemoveLater && '그 주일이나 그 뒤에 이미 출석 기록이 있는 분은 마지막 기록 다음 주일부터 빠져요.',
              weekdayNote,
              '지난 출석 기록과 보고서는 그대로 남아요.',
              '빠진 분들은 ‘명단에서 뺀 사람’에 모여 있어서, 나중에 한 명씩 다시 넣을 수 있어요.',
            ]}
          />
          <ViewingDateNotice className="mt-3" />
          <Callout tone="danger" icon="trash" className="mt-3">
            교회를 떠나신 게 아니라면 ‘모두 다른 목장으로 옮기고 삭제’를 써 주세요.
          </Callout>
          <div className="mt-5 flex gap-2">
            <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => setView('start')}>
              뒤로
            </Button>
            <Button variant="danger" className="flex-1" disabled={busy} onClick={() => void removeAllThenArchive()}>
              {progressText || '빼고 삭제'}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  )
}
