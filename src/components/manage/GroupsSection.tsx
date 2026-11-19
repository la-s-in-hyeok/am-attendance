import { useMemo, useState } from 'react'
import { useStore } from '../../store'
import { useActiveGroups } from '../../hooks'
import { compareMembers } from '../../lib/compute'
import { Button, Card, Empty, Icon, type IconName } from '../ui'
import { Initial, ListCard, RoleTag, SectionTitle } from './parts'
import { normName } from './lib'
import { useGroupInfo, useGroupMap, useRosterSplit } from './useManage'

/** 목장 목록 + 이름 찾기 + 순서 바꾸기 */
export function GroupsSection({
  onOpen,
  onAdd,
  onPickMember,
}: {
  onOpen: (groupId: string) => void
  onAdd: () => void
  onPickMember: (memberId: string) => void
}) {
  const groups = useActiveGroups()
  const info = useGroupInfo()
  const reorderGroups = useStore((s) => s.reorderGroups)
  const [reorder, setReorder] = useState(false)
  const [q, setQ] = useState('')

  const total = groups.reduce((n, g) => n + (info.get(g.id)?.count ?? 0), 0)

  function move(i: number, dir: -1 | 1) {
    const ids = groups.map((g) => g.id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    void reorderGroups(ids)
  }

  return (
    <section>
      <SectionTitle
        right={
          groups.length > 1 && (
            <button
              type="button"
              onClick={() => {
                setReorder((v) => !v)
                setQ('')
              }}
              className={`h-11 shrink-0 rounded-full px-3.5 text-sm font-semibold transition md:h-9 ${
                reorder ? 'bg-ink text-white' : 'text-ink-2 hover:bg-black/5 active:bg-black/10'
              }`}
            >
              {reorder ? '완료' : '순서 바꾸기'}
            </button>
          )
        }
      >
        목장{' '}
        <span className="text-[15px] font-semibold text-ink-3">
          {groups.length}개 · {total}명
        </span>
      </SectionTitle>

      {!reorder && groups.length > 0 && <MemberSearch q={q} setQ={setQ} onPick={onPickMember} />}

      {reorder && <p className="mb-2 px-1 text-[13px] text-ink-3">화살표로 출석부·보고서에 나오는 순서를 바꿔요. 바로 저장돼요.</p>}

      {q.trim() ? null : groups.length === 0 ? (
        <Card>
          <Empty title="아직 목장이 없어요">아래 ‘목장 추가’로 첫 목장을 만들어 보세요.</Empty>
        </Card>
      ) : (
        <ListCard wide={!reorder} className={reorder ? 'lg:w-1/2' : ''}>
          {groups.map((g, i) => {
            const gi = info.get(g.id)
            if (reorder)
              return (
                <div key={g.id} className="flex min-h-[64px] items-center gap-3 px-4 py-2">
                  <span className="tabular w-6 text-center text-sm font-bold text-ink-3">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-[16px] font-bold">{g.name}</span>
                  <OrderButton icon="up" label={`${g.name} 위로`} disabled={i === 0} onClick={() => move(i, -1)} />
                  <OrderButton icon="down" label={`${g.name} 아래로`} disabled={i === groups.length - 1} onClick={() => move(i, 1)} />
                </div>
              )
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => onOpen(g.id)}
                className="flex min-h-[68px] w-full items-center gap-3.5 px-4 py-3 text-left transition hover:bg-black/[0.02] active:bg-black/5"
              >
                <Initial text={g.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-bold">{g.name}</span>
                  <span className="mt-0.5 block truncate text-[13px] text-ink-3">
                    {gi?.leader ? `목자 ${gi.leader}` : '목자 미정'}
                    {gi?.manager ? ` · 총무 ${gi.manager}` : ''}
                  </span>
                </span>
                <span className="tabular shrink-0 text-[15px] font-semibold text-ink-2">{gi?.count ?? 0}명</span>
                <Icon name="chevronRight" size={18} className="shrink-0 text-ink-3" />
              </button>
            )
          })}
        </ListCard>
      )}

      {!reorder && !q.trim() && (
        <Button variant="secondary" size="lg" icon="plus" className="mt-3 w-full lg:w-1/2" onClick={onAdd}>
          목장 추가
        </Button>
      )}
    </section>
  )
}

function OrderButton({ icon, label, disabled, onClick }: { icon: IconName; label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-line bg-surface text-ink-2 transition active:bg-present-soft disabled:opacity-30"
    >
      <Icon name={icon} size={18} />
    </button>
  )
}

/** 전체 목장원 중에서 이름으로 찾기 → 눌러서 바로 관리 */
function MemberSearch({ q, setQ, onPick }: { q: string; setQ: (v: string) => void; onPick: (memberId: string) => void }) {
  const { current } = useRosterSplit()
  const groupMap = useGroupMap()
  const key = normName(q)
  const results = useMemo(() => {
    if (!key) return []
    return current
      .filter((m) => normName(m.name).includes(key))
      .sort((a, b) => {
        // 정확히 같은 이름 → 앞부분이 같은 이름 → 나머지
        const rank = (n: string) => (normName(n) === key ? 0 : normName(n).startsWith(key) ? 1 : 2)
        return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, 'ko') || compareMembers(a, b)
      })
      .slice(0, 40)
  }, [current, key])

  // 넓은 PC 에서는 목장 목록 왼쪽 칸 너비에 맞춘다 (입력칸이 너무 길어지지 않게)
  return (
    <div className="mb-3 lg:w-1/2">
      <div className="relative">
        <Icon name="search" size={18} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-ink-3" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이름으로 찾기"
          aria-label="목장원 이름으로 찾기"
          enterKeyHint="search"
          className="h-12 w-full rounded-2xl border border-line bg-surface pr-12 pl-11 outline-none transition placeholder:text-ink-3 focus:border-ink"
        />
        {q && (
          <button
            type="button"
            aria-label="검색어 지우기"
            onClick={() => setQ('')}
            className="absolute top-1/2 right-1.5 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-ink-3 hover:bg-black/5"
          >
            <Icon name="x" size={16} />
          </button>
        )}
      </div>

      {key &&
        (results.length > 0 ? (
          <ListCard className="anim-fade mt-2">
            {results.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onPick(m.id)}
                className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-black/[0.02] active:bg-black/5"
              >
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="truncate text-[16px] font-semibold">{m.name}</span>
                  <RoleTag role={m.role} />
                </span>
                <span className="shrink-0 text-[13px] font-medium text-ink-3">{groupMap.get(m.groupId)?.name ?? '?'} 목장</span>
                <Icon name="more" size={20} className="shrink-0 text-ink-3" />
              </button>
            ))}
          </ListCard>
        ) : (
          <Card className="anim-fade mt-2 px-5 py-8 text-center text-sm text-ink-3">‘{q.trim()}’ 이름의 목장원이 없어요</Card>
        ))}
    </div>
  )
}
