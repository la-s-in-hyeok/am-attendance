import { memo, useEffect, useRef } from 'react'
import type { Member, Service, Status } from '../../lib/types'
import { ROLE_LABEL, SERVICE_LABEL } from '../../lib/types'
import { Icon, STATUS_STYLE, StatusPill } from '../ui'

export interface MemberRowProps {
  member: Member
  status: Status | 'unchecked'
  /** 출석일 때 몇 부 예배인지 (출석이 아니면 null) */
  service: Service | null
  reason: string
  /** 검색 결과처럼 여러 목장이 섞일 때 목장 이름을 함께 보여 준다 */
  groupName?: string
  /** 이름을 눌렀을 때 (출석 ↔ 미확인) */
  onToggle: (memberId: string) => void
  /** '결석' 버튼 */
  onAbsent: (memberId: string) => void
  /** 완료로 잠긴 목장이면 '결석' 버튼을 흐리게 보여 준다 */
  locked?: boolean
}

function MemberRowView({ member, status, service, reason, groupName, onToggle, onAbsent, locked = false }: MemberRowProps) {
  // 방금 출석으로 바뀐 줄만 살짝 튕기게 (처음 열 때는 가만히)
  const look = status === 'present' ? `present${service}` : status
  const prevLook = useRef(look)
  const bounce = prevLook.current !== look && status === 'present'
  useEffect(() => {
    prevLook.current = look
  }, [look])

  const present = status === 'present'
  const absent = status === 'away' || status === 'nocontact' || status === 'other'
  const sub = [groupName, absent ? reason : ''].filter(Boolean).join(' · ')
  const fill = present ? (service === 2 ? 'bg-present2' : 'bg-present') : 'bg-surface'

  return (
    <div
      className={`flex min-h-[60px] items-stretch rounded-2xl shadow-[var(--shadow-card)] transition-colors duration-150 ${fill} ${
        bounce ? 'anim-bounce' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => onToggle(member.id)}
        aria-pressed={present}
        aria-label={`${member.name} ${present ? `${SERVICE_LABEL[service ?? 1]} 출석` : '출석 체크'}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl py-2.5 pr-2 pl-3.5 text-left select-none active:bg-black/[0.04]"
      >
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
            present
              ? 'bg-ink text-white'
              : absent
                ? `${STATUS_STYLE[status].soft} ${STATUS_STYLE[status].ink}`
                : 'border-2 border-ink-3/35 bg-surface'
          }`}
        >
          {present && <Icon name="check" size={18} strokeWidth={3} />}
          {absent && <Icon name="x" size={14} strokeWidth={2.6} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className={`min-w-0 text-[17px] leading-snug font-bold [overflow-wrap:anywhere] ${absent ? 'text-ink-2' : 'text-ink'}`}>
              {member.name}
            </span>
            {member.role && (
              <span
                className={`shrink-0 rounded-md px-1.5 py-[3px] text-[13px] leading-none font-bold ${
                  present ? 'bg-black/10 text-ink' : 'bg-muted text-ink-2'
                }`}
              >
                {ROLE_LABEL[member.role]}
              </span>
            )}
            {absent && <StatusPill status={status} className="shrink-0" />}
          </span>
          {sub && (
            <span className={`mt-0.5 line-clamp-2 text-[13px] leading-snug [overflow-wrap:anywhere] ${present ? 'text-ink/60' : 'text-ink-3'}`}>{sub}</span>
          )}
        </span>
        {present && (
          <span className="shrink-0 rounded-full bg-white/55 px-2 py-0.5 text-[13px] font-extrabold text-ink/75">
            {SERVICE_LABEL[service ?? 1]}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => onAbsent(member.id)}
        aria-disabled={locked || undefined}
        className={`my-2 mr-2 shrink-0 rounded-xl px-3.5 text-[14px] font-semibold transition ${
          present ? 'text-ink/70 hover:bg-black/5 active:bg-black/10' : 'bg-muted text-ink-2 hover:bg-track active:bg-track'
        } ${locked ? 'opacity-35' : ''}`}
      >
        결석
      </button>
    </div>
  )
}

/** 목장원 한 줄. 사람·상태·예배·사유가 그대로면 다시 그리지 않는다 */
export const MemberRow = memo(
  MemberRowView,
  (a, b) =>
    a.member === b.member &&
    a.status === b.status &&
    a.service === b.service &&
    a.reason === b.reason &&
    a.groupName === b.groupName &&
    a.onToggle === b.onToggle &&
    a.onAbsent === b.onAbsent &&
    a.locked === b.locked,
)
