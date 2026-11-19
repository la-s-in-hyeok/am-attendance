import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store'
import { ROLE_LABEL, type AttendanceRecord, type Group, type Role } from '../../lib/types'
import { addDays } from '../../lib/dates'
import { removalDate, rosterChangeFrom } from '../../lib/roster'
import { Button, Segmented, Sheet, TextArea, TextField } from '../ui'
import { Bullets, Callout, GroupPicker, MenuRow, RoleTag, SameNameNotice, ViewingDateNotice } from './parts'
import { cleanName, findSameName, labelDay, weekdayRuleNote } from './lib'
import { useGroupMap, useRosterSplit } from './useManage'

type View = 'main' | 'move' | 'remove' | 'purge'
type RoleKey = 'none' | 'leader' | 'manager'

const toKey = (r: Role): RoleKey => r ?? 'none'
const fromKey = (k: RoleKey): Role => (k === 'none' ? null : k)

/**
 * 목장원 한 명 관리: 이름·역할·메모 수정, 목장 이동, 명단에서 빼기, 완전히 삭제.
 * 확인 단계도 같은 시트 안에서 화면만 바꿔서 보여 준다 (시트를 겹쳐 띄우지 않는다).
 */
export function MemberSheet({ memberId, onClose }: { memberId: string; onClose: () => void }) {
  const member = useStore((s) => s.members.find((m) => m.id === memberId))
  const date = useStore((s) => s.date)
  /** 명단에서 빼면 이 주일 출석부부터 빠진다 (store.removeMember 와 같은 규칙) */
  const removeFrom = useStore((s) => {
    const mine: AttendanceRecord[] = []
    for (const k in s.records) if (s.records[k].memberId === memberId) mine.push(s.records[k])
    return removalDate(memberId, mine, s.date)
  })
  const recordCount = useStore((s) => {
    let n = 0
    for (const k in s.records) if (s.records[k].memberId === memberId) n++
    return n
  })
  const updateMember = useStore((s) => s.updateMember)
  const moveMember = useStore((s) => s.moveMember)
  const removeMember = useStore((s) => s.removeMember)
  const purgeMember = useStore((s) => s.purgeMember)
  const toast = useStore((s) => s.toast)
  const { current } = useRosterSplit()
  const groupMap = useGroupMap()

  const [view, setView] = useState<View>('main')
  const [name, setName] = useState(member?.name ?? '')
  const [role, setRole] = useState<RoleKey>(toKey(member?.role ?? null))
  const [note, setNote] = useState(member?.note ?? '')
  const [busy, setBusy] = useState(false)

  // 다른 기기에서 지워졌거나 완전히 삭제되면 닫는다
  useEffect(() => {
    if (!member) onClose()
  }, [member, onClose])

  const trimmed = cleanName(name)
  const sameName = useMemo(
    () => (member && trimmed !== member.name ? findSameName(trimmed, current, member.id) : []),
    [member, trimmed, current],
  )

  if (!member) return null

  const groupName = groupMap.get(member.groupId)?.name ?? '?'
  const newRole = fromKey(role)
  const dirty = trimmed !== member.name || newRole !== member.role || note.trim() !== member.note.trim()
  const canSave = dirty && trimmed.length > 0 && !busy

  /** 같은 목장에서 지금 그 역할을 맡은 사람 */
  const holderOf = (r: 'leader' | 'manager') =>
    current.find((m) => m.groupId === member.groupId && m.id !== member.id && m.role === r)
  const replaced = newRole && newRole !== member.role ? holderOf(newRole) : undefined

  async function save() {
    const cur = useStore.getState().members.find((m) => m.id === memberId)
    if (!cur || !canSave) return
    setBusy(true)
    // 목자·총무는 목장마다 한 명: 새로 맡기면 전에 맡던 사람은 일반 목장원이 된다
    if (newRole && newRole !== cur.role) {
      const others = useStore
        .getState()
        .members.filter((m) => m.groupId === cur.groupId && m.removedOn === null && m.id !== cur.id && m.role === newRole)
      for (const o of others) {
        // 실패하면 store 가 화면을 되돌리고 오류를 알려 준다
        if (!(await updateMember({ ...o, role: null }))) return setBusy(false)
      }
    }
    if (!(await updateMember({ ...cur, name: trimmed, role: newRole, note: note.trim() }))) return setBusy(false)
    toast(newRole && newRole !== cur.role ? `${trimmed}님을 ${ROLE_LABEL[newRole]}로 정했어요` : '저장했어요', 'success')
    onClose()
  }

  async function doMove(g: Group) {
    if (busy || !member) return
    setBusy(true)
    const from = rosterChangeFrom(useStore.getState().date)
    if (!(await moveMember(member.id, g.id))) return setBusy(false)
    toast(`${member.name}님을 ${g.name} 목장으로 옮겼어요. ${labelDay(from)} 출석부부터 나와요`, 'success')
    onClose()
  }

  async function doRemove() {
    if (busy || !member) return
    setBusy(true)
    if (!(await removeMember(member.id))) return setBusy(false)
    const removedOn = useStore.getState().members.find((m) => m.id === member.id)?.removedOn
    toast(`${member.name}님을 명단에서 뺐어요${removedOn ? `. ${labelDay(removedOn)} 출석부부터 빠져요` : ''}`, 'success')
    onClose()
  }

  async function doPurge() {
    if (busy || !member) return
    setBusy(true)
    const nm = member.name
    if (!(await purgeMember(member.id))) return setBusy(false)
    toast(`${nm}님을 완전히 삭제했어요`, 'success')
    onClose()
  }

  /** 목장 이동이 적용되는 주일 */
  const changeFrom = rosterChangeFrom(date)
  const weekdayNote = weekdayRuleNote(date)
  /** 적용 주일이나 그 뒤에 이미 출석 기록이 있어서 더 늦게 빠지는지 */
  const removeLater = removeFrom > changeFrom

  const title =
    view === 'main' ? (
      <span className="flex items-center gap-2">
        {member.name}
        <RoleTag role={member.role} />
      </span>
    ) : view === 'move' ? (
      '어느 목장으로 옮길까요?'
    ) : view === 'remove' ? (
      '명단에서 뺄까요?'
    ) : (
      '완전히 삭제할까요?'
    )

  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      footer={
        view === 'main' ? (
          <Button size="lg" className="w-full" disabled={!canSave} onClick={() => void save()}>
            {busy ? '저장 중…' : '저장하기'}
          </Button>
        ) : undefined
      }
    >
      {view === 'main' && (
        <div className="anim-fade">
          <p className="mb-4 text-[13px] text-ink-3">
            {groupName} 목장 · {labelDay(member.joinedOn)} 출석부부터 있어요
          </p>

          <TextField label="이름" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
          <SameNameNotice name={trimmed} matches={sameName} className="mt-2" />

          <div className="mt-5">
            <span className="mb-1.5 block text-sm font-medium text-ink-2">역할</span>
            <Segmented<RoleKey>
              className="w-full max-md:*:h-11"
              value={role}
              onChange={setRole}
              options={[
                { value: 'none', label: '없음' },
                { value: 'leader', label: '목자' },
                { value: 'manager', label: '총무' },
              ]}
            />
            {replaced && newRole && (
              <p className="mt-2 px-1 text-[13px] leading-relaxed text-accent-soft-ink">
                지금 {ROLE_LABEL[newRole]}인 <b>{replaced.name}</b>님은 일반 목장원이 돼요. (목장마다 {ROLE_LABEL[newRole]}는 한 명)
              </p>
            )}
          </div>

          <TextArea
            className="mt-5"
            label="메모"
            rows={2}
            maxLength={300}
            placeholder="연락처, 참고할 내용 등"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          <div className="mt-6 divide-y divide-line overflow-hidden rounded-2xl border border-line">
            <MenuRow icon="move" title="다른 목장으로 옮기기" sub="지난 출석 기록은 지금 목장에 남아요" onClick={() => setView('move')} />
            <MenuRow icon="logout" title="명단에서 빼기" sub="출석부에 더 안 나와요. 지난 기록은 남아요" onClick={() => setView('remove')} />
          </div>

          <p className="mt-6 mb-2 px-1 text-[13px] font-bold text-danger">위험 구역</p>
          <div className="overflow-hidden rounded-2xl border border-danger-line">
            <MenuRow icon="trash" danger title="완전히 삭제" sub="이름을 잘못 넣었을 때만 써 주세요" onClick={() => setView('purge')} />
          </div>
        </div>
      )}

      {view === 'move' && (
        <div className="anim-fade">
          <p className="mb-3 text-[15px] text-ink-2">
            <b className="text-ink">{member.name}</b>님 · 지금 {groupName} 목장
          </p>
          <GroupPicker excludeId={member.groupId} disabled={busy} onPick={(g) => void doMove(g)} />
          <Bullets
            small
            className="mt-4"
            items={[
              <>
                <b className="text-ink-2">{labelDay(changeFrom)} 출석부</b>부터 새 목장에 나와요. 그 전 출석부는 그대로예요.
              </>,
              `그 전 출석 기록은 ${groupName} 목장 기록으로 남아요.`,
              weekdayNote,
              member.role && `${ROLE_LABEL[member.role]} 역할은 풀려요. 새 목장에서 다시 정해 주세요.`,
            ]}
          />
          <ViewingDateNotice className="mt-3" />
          <Button variant="secondary" className="mt-5 w-full" onClick={() => setView('main')}>
            뒤로
          </Button>
        </div>
      )}

      {view === 'remove' && (
        <div className="anim-fade">
          <p className="mb-3 text-[15px] leading-relaxed text-ink-2">
            <b className="text-ink">{member.name}</b>님을 {groupName} 목장 명단에서 빼요.
          </p>
          <Bullets
            items={[
              <>
                <b className="text-ink">{labelDay(removeFrom)} 출석부</b>부터 빠져요. 그 전 출석부는 그대로예요.
              </>,
              <>
                <b className="text-ink">지난 출석 기록은 그대로 남아요.</b> 보고서·통계에도 남아요.
              </>,
              '마음이 바뀌면 관리 화면의 ‘명단에서 뺀 사람’에서 다시 넣을 수 있어요.',
            ]}
          />
          {removeLater ? (
            <Callout className="mt-4" icon="check">
              {labelDay(addDays(removeFrom, -7))} 출석부에 이미 출석 기록이 있어서, 그다음 주일부터 빠져요.
            </Callout>
          ) : (
            weekdayNote && (
              <Callout className="mt-4" icon="calendar">
                {weekdayNote}
              </Callout>
            )
          )}
          <ViewingDateNotice className="mt-3" />
          <div className="mt-5 flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setView('main')}>
              취소
            </Button>
            <Button className="flex-1" disabled={busy} onClick={() => void doRemove()}>
              명단에서 빼기
            </Button>
          </div>
        </div>
      )}

      {view === 'purge' && (
        <div className="anim-fade">
          <Callout tone="danger" icon="trash">
            <b>되돌릴 수 없어요.</b> {member.name}님의 정보
            {recordCount > 0 ? `와 출석 기록 ${recordCount}건이` : '가'} 모두 지워지고, 지난 보고서·통계에서도 사라져요.
          </Callout>
          <Bullets
            className="mt-4"
            items={[
              '이름을 잘못 넣었거나 두 번 넣었을 때만 써 주세요.',
              <>
                교회를 떠나신 분은 <b className="text-ink">‘명단에서 빼기’</b>를 쓰면 지난 기록이 남아요.
              </>,
            ]}
          />
          <div className="mt-5 flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setView('main')}>
              취소
            </Button>
            <Button variant="danger" className="flex-1" disabled={busy} onClick={() => void doPurge()}>
              완전히 삭제
            </Button>
          </div>
          <button
            type="button"
            onClick={() => setView('remove')}
            className="mt-3 h-11 w-full rounded-2xl text-sm font-semibold text-ink-2 hover:bg-muted"
          >
            명단에서 빼기로 할게요
          </button>
        </div>
      )}
    </Sheet>
  )
}
