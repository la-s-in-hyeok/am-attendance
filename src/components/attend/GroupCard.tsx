import { memo } from 'react'
import type { Counts, GroupWeek } from '../../lib/compute'
import type { Group, GroupDayState } from '../../lib/types'
import { Icon } from '../ui'

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
  /** 목자·총무 (PC 에서 마우스를 올리면 보인다) */
  staff: string
  /** 완료 상태 (없으면 아직 완료 전) */
  dayState?: GroupDayState
  onOpen: (groupId: string) => void
}

/** 초록 동그라미 안의 체크 */
function DoneDot() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <circle cx="8" cy="8" r="8" className="fill-ok-icon" />
      <path d="M4.6 8.2l2.2 2.2 4.6-4.6" fill="none" className="stroke-white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * 목장 칸 하나: 위에 이름, 아래에 출석 수와 상태(완료 / 수정 중 / 미확인).
 * 완료는 초록 칸, 수정 중은 주황 칸, 아직이면 흰 칸. 칸 전체가 하나의 버튼
 */
function GroupCardView({ group, summary, staff, dayState, onOpen }: Props) {
  const done = dayState === 'done'
  const editing = dayState === 'editing'
  const state = done ? '완료' : editing ? '수정 중' : summary.unchecked > 0 ? `미확인 ${summary.unchecked}명` : ''
  const look = done
    ? 'border-ok-line bg-ok-soft hover:brightness-[0.98]'
    : editing
      ? 'border-accent bg-accent-soft hover:brightness-[0.98]'
      : 'border-line bg-surface shadow-[0_1px_4px_rgb(16_42_67/0.05)] hover:bg-hover'
  return (
    <button
      type="button"
      onClick={() => onOpen(group.id)}
      title={staff}
      aria-label={`${group.name}${group.archived ? ' (보관됨)' : ''}, ${summary.present}/${summary.total}명${state ? `, ${state}` : ''}`}
      className={`flex min-h-[84px] w-full min-w-0 flex-col items-stretch justify-between gap-1.5 rounded-2xl border-[1.5px] py-2 pr-2.5 pl-3 text-left transition active:scale-[0.97] ${look}`}
    >
      {/* 긴 목장 이름은 줄여 쓰지 않고 줄을 바꾼다 */}
      <span className="min-w-0">
        <span className="block text-[15px] leading-tight font-bold [overflow-wrap:anywhere]">{group.name}</span>
        {group.archived && <span className="mt-0.5 block text-[12px] leading-tight font-semibold text-ink-3">보관됨</span>}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="tabular text-[12px] leading-snug font-medium text-ink-2">
          {summary.present}/{summary.total}명
        </span>
        {done ? (
          <span className="inline-flex items-center gap-1 text-[13px] leading-snug font-bold text-ok">
            <DoneDot />
            완료
          </span>
        ) : editing ? (
          <span className="inline-flex items-center gap-1 text-[13px] leading-snug font-bold text-accent-soft-ink">
            <Icon name="edit" size={13} strokeWidth={2.4} className="shrink-0" />
            수정 중
          </span>
        ) : summary.unchecked > 0 ? (
          <span className="tabular inline-flex items-center gap-1.5 text-[13px] leading-snug font-semibold text-ink-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-nocontact" />
            미확인 {summary.unchecked}
          </span>
        ) : summary.total > 0 ? (
          <span className="inline-flex items-center gap-1 text-[13px] leading-snug font-semibold text-ink-2">
            <Icon name="check" size={13} strokeWidth={2.6} className="shrink-0" />
            모두 확인
          </span>
        ) : null}
      </span>
    </button>
  )
}

function sameCounts(a: Counts, b: Counts) {
  return a.total === b.total && a.present === b.present && a.unchecked === b.unchecked
}

/** 목장 칸. 보이는 숫자가 그대로면 다시 그리지 않는다 */
export const GroupCard = memo(
  GroupCardView,
  (a, b) =>
    a.group === b.group &&
    a.staff === b.staff &&
    a.dayState === b.dayState &&
    a.onOpen === b.onOpen &&
    sameCounts(a.summary, b.summary),
)
