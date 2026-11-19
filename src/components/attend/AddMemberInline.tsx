import { useState } from 'react'
import type { ISODate } from '../../lib/types'
import { useStore } from '../../store'
import { Button, Icon } from '../ui'

/** 목장 화면 맨 아래: 이름 적고 Enter → 보고 있는 주일부터 이 목장 가족으로 */
export function AddMemberInline({
  groupId,
  groupName,
  date,
  existingNames,
}: {
  groupId: string
  groupName: string
  date: ISODate
  existingNames: string[]
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const addMembers = useStore((s) => s.addMembers)
  const toast = useStore((s) => s.toast)

  const submit = async () => {
    // 쉼표로 여러 명을 한 번에 넣을 수 있다
    const names = [...new Set(name.split(/[,，\n]/).map((n) => n.trim()).filter(Boolean))]
    if (names.length === 0 || busy) return
    const dup = names.filter((n) => existingNames.includes(n))
    if (dup.length) {
      toast(`${dup.join(', ')}님은 이미 ${groupName}에 있어요`, 'error')
      return
    }
    // 같은 이름이 다른 목장에 있거나, 예전에 명단에서 뺀 사람이면 새로 만들지 않고 물어본다
    // (새로 만들면 같은 사람이 두 명이 되고 지난 기록이 이어지지 않는다)
    const norm = (x: string) => x.replace(/\s+/g, '')
    const { members, groups, restoreMember, moveMember } = useStore.getState()
    const clashes = names
      .map((n) => ({ n, m: members.find((m) => norm(m.name) === norm(n) && (m.removedOn !== null || m.groupId !== groupId)) }))
      .filter((c): c is { n: string; m: NonNullable<typeof c.m> } => !!c.m)
    if (clashes.length) {
      if (names.length > 1) {
        toast(`${clashes.map((c) => c.n).join(', ')}님은 이미 명단에 있어요. 한 명씩 넣어 주세요`, 'error')
        return
      }
      const m = clashes[0].m
      const from = groups.find((g) => g.id === m.groupId)?.name ?? '다른'
      setName('')
      if (m.removedOn !== null) {
        toast(`${m.name}님은 예전에 명단에서 뺀 분이에요`, 'info', {
          label: '다시 넣기',
          run: () =>
            void restoreMember(m.id, groupId).then((ok) => ok && toast(`${m.name}님을 다시 ${groupName}에 넣었어요`, 'success')),
        })
      } else {
        toast(`${m.name}님은 지금 ${from} 목장에 있어요`, 'info', {
          label: '이리로 옮기기',
          run: () => void moveMember(m.id, groupId).then((ok) => ok && toast(`${m.name}님을 ${groupName}${groupName.endsWith('목장') ? '' : ' 목장'}으로 옮겼어요`, 'success')),
        })
      }
      return
    }
    setBusy(true)
    setName('')
    try {
      const added = await addMembers(groupId, names, date)
      if (added.length === 1) toast(`${added[0].name}님을 ${groupName}에 추가했어요`, 'success')
      else if (added.length > 1) toast(`${added.length}명을 ${groupName}에 추가했어요`, 'success')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        className="flex h-14 items-center gap-2 rounded-2xl border-2 border-dashed border-ink-3/30 pr-2 pl-3.5 transition focus-within:border-solid focus-within:border-brand focus-within:bg-surface"
      >
        <Icon name="plus" size={20} className="shrink-0 text-brand" />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="이 목장에 새 가족 추가"
          aria-label="새 가족 이름"
          enterKeyHint="done"
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent font-semibold outline-none placeholder:font-medium placeholder:text-ink-3"
        />
        {name.trim() && (
          <Button type="submit" disabled={busy} className="anim-pop shrink-0 px-4">
            추가
          </Button>
        )}
      </form>
      {name.trim() && (
        <p className="anim-fade mt-1.5 px-1 text-[13px] text-ink-3">쉼표(,)로 나누면 여러 명을 한 번에 넣을 수 있어요.</p>
      )}
    </div>
  )
}
