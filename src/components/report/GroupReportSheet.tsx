import type { GroupDayState } from '../../lib/types'
import { ABSENCE_CATEGORIES, ABSENCE_LABEL, presentOfTotal, type AbsenceCategory, type AbsenceGroup, type AbsencePerson } from '../../lib/report'
import { Button, Icon, Sheet, STATUS_STYLE } from '../ui'
import { CopyButton, ShareButton } from './CopyShareButtons'
import { ServiceCounts } from './ServiceBits'
import { canShare } from './share'
import { dayStateLabel, StateIcon } from './StatusGrid'
import { useCopyShare } from './useCopyShare'

/**
 * 한 목장의 목장심방 현황 (바텀시트)
 * - 타지 / 기타(사유) / 연락두절 / 미확인 이름
 * - 이 목장 글만 복사·공유
 * - 미확인이 있으면 '체크하러 가기'
 */
export function GroupReportSheet({
  g,
  state,
  text,
  onClose,
  onCheck,
}: {
  /** null 이면 닫힘 */
  g: AbsenceGroup | null
  state: GroupDayState | undefined
  /** 이 목장 보고 글 */
  text: string
  onClose: () => void
  onCheck: (groupId: string) => void
}) {
  const { copied, copy, share } = useCopyShare(text)

  return (
    <Sheet
      open={g !== null}
      onClose={onClose}
      title={g ? `${g.group.name} 목장` : undefined}
      footer={
        g && (
          <div className="flex flex-col gap-2">
            {g.unchecked.length > 0 && (
              <Button variant="secondary" className="w-full" onClick={() => onCheck(g.group.id)}>
                체크하러 가기
                <Icon name="chevronRight" size={16} />
              </Button>
            )}
            <div className="flex gap-2.5">
              <CopyButton copied={copied} className="flex-1" disabled={!text} onClick={() => void copy()} title="이 목장 보고 글 복사" />
              {canShare() && <ShareButton disabled={!text} onClick={() => void share()} />}
            </div>
          </div>
        )
      }
    >
      {g && <GroupReport g={g} state={state} />}
    </Sheet>
  )
}

function GroupReport({ g, state }: { g: AbsenceGroup; state: GroupDayState | undefined }) {
  const s = g.summary
  const done = state === 'done'
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span
          className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border pr-2.5 pl-1.5 text-[13px] font-bold ${
            done ? 'border-ok-line bg-ok-soft text-ok' : 'border-danger-line bg-danger-soft text-danger'
          }`}
        >
          <StateIcon done={done} size={15} />
          {dayStateLabel(state)}
        </span>
        <span className="tabular text-[13px] font-medium text-ink-3">출석 {presentOfTotal(s)}</span>
        <ServiceCounts service1={s.service1} service2={s.service2} className="ml-auto" />
      </div>
      <div className="flex flex-col divide-y divide-line">
        {ABSENCE_CATEGORIES.map((c) => (
          <CategoryRow key={c} category={c} people={g[c]} />
        ))}
        {g.unchecked.length > 0 && <CategoryRow category="unchecked" people={g.unchecked} />}
      </div>
    </div>
  )
}

/** 한 줄: [타지 2]  최지훈 안산 · 정하나 */
function CategoryRow({ category, people }: { category: AbsenceCategory | 'unchecked'; people: AbsencePerson[] }) {
  const st = STATUS_STYLE[category]
  const label = category === 'unchecked' ? '미확인' : ABSENCE_LABEL[category]
  const n = people.length
  return (
    <div className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
      <span
        className={`tabular inline-flex h-7 w-[96px] shrink-0 items-center justify-between gap-1.5 rounded-full px-2.5 text-[13px] font-bold ${st.soft} ${st.ink} ${
          n === 0 ? 'opacity-55' : ''
        }`}
      >
        {label}
        <span>{n}</span>
      </span>
      {n === 0 ? (
        <span className="pt-[3px] text-[14px] text-ink-3">없음</span>
      ) : (
        <ul className="flex min-w-0 flex-1 flex-wrap content-start items-start gap-1.5">
          {people.map((p) => (
            <li key={p.memberId} className="inline-flex max-w-full items-baseline gap-1 rounded-lg bg-bg px-2 py-1 text-[14px] leading-snug">
              <span className="shrink-0 font-semibold text-ink">{p.name}</span>
              {p.memo && <span className="min-w-0 text-[13px] break-words text-ink-3">{p.memo}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
