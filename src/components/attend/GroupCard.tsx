import { memo } from 'react'
import type { Counts, GroupWeek } from '../../lib/compute'
import { rate } from '../../lib/compute'
import type { Group, GroupDayState } from '../../lib/types'
import { Icon, Ring, StackBar } from '../ui'

/** "목자 홍길동 · 총무 김철수" (없으면 인원 수) */
export function staffLine(gw: GroupWeek): string {
  const leaders = gw.entries.filter((e) => e.member.role === 'leader').map((e) => e.member.name)
  const managers = gw.entries.filter((e) => e.member.role === 'manager').map((e) => e.member.name)
  const parts: string[] = []
  if (leaders.length) parts.push(`목자 ${leaders.join(', ')}`)
  if (managers.length) parts.push(`총무 ${managers.join(', ')}`)
  return parts.length ? parts.join(' · ') : `목장원 ${gw.entries.length}명`
}

interface Props {
  group: Group
  summary: Counts
  staff: string
  /** 완료 상태 (없으면 아직 완료 전) */
  dayState?: GroupDayState
  onOpen: (groupId: string) => void
}

function GroupCardView({ group, summary, staff, dayState, onOpen }: Props) {
  const r = rate(summary.present, summary.total)
  return (
    <button
      type="button"
      onClick={() => onOpen(group.id)}
      className="block w-full rounded-[var(--radius-card)] bg-surface p-4 text-left shadow-[var(--shadow-card)] transition hover:shadow-[0_1px_2px_rgb(16_18_24/0.05),0_8px_24px_rgb(16_18_24/0.08)] active:scale-[0.99]"
    >
      <div className="flex items-center gap-3.5">
        <Ring value={r ?? 0} size={52} stroke={5}>
          <span className="tabular text-[13px] font-extrabold">
            {r === null ? '-' : Math.round(r * 100)}
            {r !== null && <span className="text-[10px] font-bold">%</span>}
          </span>
        </Ring>
        <div className="min-w-0 flex-1">
          {/* 긴 목장 이름은 줄여 쓰지 않고 줄을 바꾼다 */}
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
            <p className="min-w-0 text-[17px] leading-snug font-extrabold [overflow-wrap:anywhere]">{group.name}</p>
            {group.archived && (
              <span className="shrink-0 rounded-md bg-[#f1f1ec] px-1.5 py-0.5 text-[13px] font-bold text-ink-3">보관됨</span>
            )}
            {dayState === 'done' ? (
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-ok/10 px-2 py-0.5 text-[13px] font-bold text-ok">
                <Icon name="check" size={12} strokeWidth={2.8} />
                완료
              </span>
            ) : dayState === 'editing' ? (
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-present-soft px-2 py-0.5 text-[13px] font-bold text-present-ink">
                <Icon name="edit" size={11} strokeWidth={2.4} />
                수정 중
              </span>
            ) : summary.unchecked > 0 ? (
              <span className="tabular shrink-0 rounded-full bg-[#f3f3ef] px-2 py-0.5 text-[13px] font-bold text-ink-2">
                미확인 {summary.unchecked}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-ink-3">{staff}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="tabular text-[17px] leading-tight font-extrabold">
            {summary.present}
            <span className="text-sm font-semibold text-ink-3">/{summary.total}</span>
          </p>
          <p className="text-[13px] text-ink-3">출석</p>
        </div>
        <Icon name="chevronRight" size={18} className="-mr-1 shrink-0 text-ink-3" />
      </div>
      <StackBar
        className="mt-3.5"
        present={summary.present}
        service2={summary.service2}
        away={summary.away}
        nocontact={summary.nocontact}
        other={summary.other}
        total={summary.total}
      />
    </button>
  )
}

function sameCounts(a: Counts, b: Counts) {
  return (
    a.total === b.total &&
    a.present === b.present &&
    a.away === b.away &&
    a.nocontact === b.nocontact &&
    a.other === b.other &&
    a.unchecked === b.unchecked &&
    a.service2 === b.service2
  )
}

/** 목장 카드. 숫자가 그대로면 다시 그리지 않는다 */
export const GroupCard = memo(
  GroupCardView,
  (a, b) =>
    a.group === b.group &&
    a.staff === b.staff &&
    a.dayState === b.dayState &&
    a.onOpen === b.onOpen &&
    sameCounts(a.summary, b.summary),
)
