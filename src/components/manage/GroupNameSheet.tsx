import { useState } from 'react'
import { useStore } from '../../store'
import type { Group } from '../../lib/types'
import { Button, Sheet, TextField } from '../ui'
import { cleanName, normName, onEnter, roOf } from './lib'

/** 새 목장 만들기 / 목장 이름 바꾸기 (group 이 있으면 이름 바꾸기) */
export function GroupNameSheet({
  group,
  onClose,
  onCreated,
}: {
  group?: Group
  onClose: () => void
  onCreated?: (g: Group) => void
}) {
  const groups = useStore((s) => s.groups)
  const addGroup = useStore((s) => s.addGroup)
  const updateGroup = useStore((s) => s.updateGroup)
  const toast = useStore((s) => s.toast)
  const [name, setName] = useState(group?.name ?? '')
  const [busy, setBusy] = useState(false)

  const trimmed = cleanName(name)
  const clash = trimmed ? groups.find((g) => !g.archived && g.id !== group?.id && normName(g.name) === normName(trimmed)) : undefined
  const archivedClash = trimmed ? groups.find((g) => g.archived && normName(g.name) === normName(trimmed)) : undefined
  const unchanged = !!group && trimmed === group.name
  const canSave = trimmed.length > 0 && !clash && !unchanged && !busy

  async function save() {
    if (!canSave) return
    setBusy(true)
    if (group) {
      const fresh = useStore.getState().groups.find((g) => g.id === group.id) ?? group
      // 실패하면 store 가 화면을 되돌리고 오류를 알려 준다
      if (!(await updateGroup({ ...fresh, name: trimmed }))) return setBusy(false)
      toast(`목장 이름을 ‘${trimmed}’${roOf(trimmed)} 바꿨어요`, 'success')
      onClose()
    } else {
      const created = await addGroup(trimmed)
      if (!created) return setBusy(false)
      toast(`${trimmed} 목장을 만들었어요. 이제 목장원을 넣어 주세요`, 'success')
      if (onCreated) onCreated(created)
      else onClose()
    }
  }

  return (
    <Sheet open onClose={onClose} title={group ? '목장 이름 바꾸기' : '새 목장 만들기'}>
      <TextField
        label="목장 이름"
        autoFocus
        value={name}
        maxLength={20}
        placeholder="예: 믿음"
        enterKeyHint="done"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onEnter(() => void save())}
      />
      {clash ? (
        <p className="mt-2 px-1 text-sm font-semibold text-danger">이미 ‘{clash.name}’ 목장이 있어요. 다른 이름으로 해 주세요.</p>
      ) : archivedClash && !group ? (
        <p className="mt-2 px-1 text-[13px] leading-relaxed text-ink-3">
          삭제한 목장 중에 같은 이름이 있어요. 예전 목장을 다시 쓰려면 관리 화면 아래 ‘삭제한 목장’에서 되살릴 수 있어요.
        </p>
      ) : (
        <p className="mt-2 px-1 text-[13px] leading-relaxed text-ink-3">
          {group ? '지난 출석부와 보고서에도 바뀐 이름으로 나와요.' : '만들고 나면 바로 목장원을 넣을 수 있어요.'}
        </p>
      )}
      <div className="mt-5 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>
          취소
        </Button>
        <Button className="flex-1" disabled={!canSave} onClick={() => void save()}>
          {busy ? '저장 중…' : group ? '바꾸기' : '만들기'}
        </Button>
      </div>
    </Sheet>
  )
}
