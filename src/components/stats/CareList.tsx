import { useState } from 'react'
import type { Group, Member } from '../../lib/types'
import { STATUS_LABEL } from '../../lib/types'
import { labelDot } from '../../lib/dates'
import { Card, Icon, STATUS_STYLE } from '../ui'
import { CARE_MIN_STREAK, type CareItem } from './statsCompute'
import { GRID_LIST } from './parts'

// 휴대폰 한 화면에 들어오도록 처음에는 몇 명만 (넓은 PC 화면은 두 줄씩이라 짝수로)
const PAGE = 6

/** 관심이 필요한 사람 (연속 결석) */
export function CareList({
  items,
  groups,
  onOpen,
}: {
  items: CareItem[]
  groups: Group[]
  onOpen: (m: Member) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const groupName = new Map(groups.map((g) => [g.id, g.name]))

  if (items.length === 0)
    return (
      <Card className="flex items-center gap-3 px-5 py-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-ok-line bg-ok-soft text-ok-icon">
          <Icon name="check" size={20} strokeWidth={2.4} />
        </span>
        <p className="text-[15px] font-semibold text-ok">지금은 {CARE_MIN_STREAK}주 이상 연속으로 못 나온 분이 없어요.</p>
      </Card>
    )

  const shown = showAll ? items : items.slice(0, PAGE)
  return (
    <Card className="overflow-hidden">
      <ul className={GRID_LIST}>
        {shown.map((it) => {
          const status = it.latest?.status ?? 'unchecked'
          const st = STATUS_STYLE[status]
          const ownReason = it.latest?.reason.trim() ?? ''
          // 최근 기록에 사유가 없으면, 연속 결석 중 가장 최근에 적힌 사유를 날짜와 함께 보여 준다
          const old = !ownReason && it.latestReason ? it.latestReason : null
          return (
            <li key={it.member.id}>
              <button
                type="button"
                onClick={() => onOpen(it.member)}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-hover active:bg-muted sm:px-5"
              >
                <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-2xl border border-danger-line bg-danger-soft text-danger">
                  <span className="tabular text-[17px] leading-none font-extrabold">{it.streak}</span>
                  <span className="mt-0.5 text-[11px] leading-none font-bold">주째</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[15px] font-bold">{it.member.name}</span>
                    <span className="shrink-0 text-[13px] text-ink-3">{groupName.get(it.member.groupId) ?? ''}</span>
                  </span>
                  <span className="mt-1 flex min-w-0 items-start gap-1.5 text-[13px] leading-5">
                    <span className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[12px] font-bold ${st.soft} ${st.ink}`}>
                      {status === 'unchecked' ? '미확인' : STATUS_LABEL[status]}
                    </span>
                    {/* 긴 사유는 두 줄까지 보여 준다 (전체는 눌러서) */}
                    {ownReason && <span className="line-clamp-2 min-w-0 break-words text-ink-2">{ownReason}</span>}
                    {old && (
                      <span className="line-clamp-2 min-w-0 break-words text-ink-3">
                        {labelDot(old.date)} {STATUS_LABEL[old.status]} · {old.reason}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[13px] text-ink-3">
                    {it.lastPresent ? `마지막 출석 ${labelDot(it.lastPresent)}` : '출석한 기록이 아직 없어요'}
                  </span>
                </span>
                <Icon name="chevronRight" size={18} className="shrink-0 text-ink-3" />
              </button>
            </li>
          )
        })}
      </ul>
      {items.length > PAGE && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="flex h-12 w-full items-center justify-center gap-1 border-t border-line text-sm font-semibold text-ink-2 transition hover:bg-hover"
        >
          {showAll ? '접기' : `${items.length - PAGE}명 더 보기`}
          <Icon name="chevronDown" size={16} className={showAll ? 'rotate-180' : ''} />
        </button>
      )}
    </Card>
  )
}
