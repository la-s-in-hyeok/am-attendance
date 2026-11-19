import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store'
import { compareMembers } from '../../lib/compute'
import { Button, Card, Empty, Icon, PageHeader } from '../ui'
import { AddMembers } from './AddMembers'
import { GroupDeleteSheet } from './GroupDeleteSheet'
import { GroupNameSheet } from './GroupNameSheet'
import { MemberSheet } from './MemberSheet'
import { ListCard, MenuRow, RoleTag, SectionTitle, ViewingDateNotice } from './parts'
import { labelDay } from './lib'

/** 목장 하나의 목장원 관리 화면 */
export function GroupDetail({ groupId, onBack }: { groupId: string; onBack: () => void }) {
  const group = useStore((s) => s.groups.find((g) => g.id === groupId))
  const members = useStore((s) => s.members)
  const date = useStore((s) => s.date)
  const [memberId, setMemberId] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const current = useMemo(
    () => members.filter((m) => m.groupId === groupId && m.removedOn === null).sort(compareMembers),
    [members, groupId],
  )

  // 삭제되었거나(다른 기기 포함) 없어지면 목록으로 돌아간다
  useEffect(() => {
    if (!group || group.archived) onBack()
  }, [group, onBack])

  if (!group) return null

  const leader = current.find((m) => m.role === 'leader')
  const manager = current.find((m) => m.role === 'manager')

  return (
    <div className="anim-fade contain-inline-size">
      <button
        type="button"
        onClick={onBack}
        className="-ml-2 inline-flex h-11 items-center gap-0.5 rounded-full pr-3.5 pl-1.5 text-[15px] font-semibold text-ink-2 transition hover:bg-black/5 active:bg-black/10"
      >
        <Icon name="chevronLeft" size={22} />
        관리
      </button>

      <PageHeader
        title={`${group.name} 목장`}
        sub={
          <>
            {leader ? `목자 ${leader.name}` : '목자 미정'} · {manager ? `총무 ${manager.name}` : '총무 미정'} · {current.length}명
          </>
        }
        right={
          <Button variant="secondary" size="sm" icon="edit" className="max-md:h-11" onClick={() => setRenaming(true)}>
            이름 바꾸기
          </Button>
        }
      />

      <ViewingDateNotice className="mb-3" />

      {/* 휴대폰: 추가 → 목장원 → 정리 차례로. 넓은 PC: 왼쪽에 추가·정리, 오른쪽에 목장원 */}
      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-5">
        <AddMembers group={group} />

        <section className="mt-8 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0">
          <SectionTitle>
            목장원 <span className="text-[15px] font-semibold text-ink-3">{current.length}명</span>
          </SectionTitle>
          {current.length === 0 ? (
            <Card>
              <Empty title="아직 목장원이 없어요">이름을 넣어 추가해 보세요.</Empty>
            </Card>
          ) : (
            <>
              <p className="mb-2 px-1 text-[13px] text-ink-3">이름을 누르면 수정·역할·목장 이동·빼기를 할 수 있어요.</p>
              <ListCard>
                {current.map((m) => {
                  const later = m.joinedOn > date
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMemberId(m.id)}
                      className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-black/[0.02] active:bg-black/5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[16px] font-semibold">{m.name}</span>
                          <RoleTag role={m.role} />
                        </span>
                        {(later || m.note) && (
                          <span className="mt-0.5 block truncate text-[13px] text-ink-3">
                            {later && (
                              <span className="font-semibold text-present-ink">
                                {labelDay(m.joinedOn)} 출석부부터{m.note ? ' · ' : ''}
                              </span>
                            )}
                            {m.note}
                          </span>
                        )}
                      </span>
                      <Icon name="more" size={20} className="shrink-0 text-ink-3" />
                    </button>
                  )
                })}
              </ListCard>
            </>
          )}
        </section>

        <section className="mt-8 lg:col-start-1 lg:row-start-2">
          <SectionTitle>목장 정리</SectionTitle>
          <ListCard>
            <MenuRow icon="trash" danger title="목장 삭제" sub="목록에서 없애요. 지난 출석 기록은 남아요" onClick={() => setDeleting(true)} />
          </ListCard>
        </section>
      </div>

      {memberId && <MemberSheet key={memberId} memberId={memberId} onClose={() => setMemberId(null)} />}
      {renaming && <GroupNameSheet group={group} onClose={() => setRenaming(false)} />}
      {deleting && <GroupDeleteSheet group={group} onClose={() => setDeleting(false)} />}
    </div>
  )
}
