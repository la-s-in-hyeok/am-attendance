import { useId } from 'react'
import type { GroupDayState } from '../../lib/types'
import { ABSENCE_KIND_LABEL, presentOfTotal, type AbsenceCategory, type AbsenceGroup, type AbsenceReport } from '../../lib/report'
import { STATUS_STYLE } from '../ui'

/** 목장 완료 상태 글: 완료 / 수정 중 / 미완료 */
export function dayStateLabel(state: GroupDayState | undefined): string {
  return state === 'done' ? '완료' : state === 'editing' ? '수정 중' : '미완료'
}

/** 완료(초록 동그라미 ✓) / 미완료·수정 중(빨강 동그라미 !) 아이콘. 늘 글과 함께 쓴다 */
export function StateIcon({ done, size = 16 }: { done: boolean; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" className={`shrink-0 ${done ? 'text-ok-icon' : 'text-danger'}`}>
      <circle cx="8" cy="8" r="8" fill="currentColor" />
      {done ? (
        <path d="M4.6 8.2l2.2 2.2 4.6-4.6" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <>
          <path d="M8 4.4v4.4" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="8" cy="11.5" r="1.1" fill="white" />
        </>
      )}
    </svg>
  )
}

/**
 * 결석 심방보고 한눈에 보기: 목장마다 한 칸 (휴대폰 3칸, 넓으면 더)
 * - 완료(초록 ✓ + 출석 수) / 미완료·수정 중(빨강 ! + 미확인 인원)
 * - 칸을 누르면 그 목장 보고를 연다
 * - 아래 줄: 타지 · 연락두절 · 기타 (· 미확인) 합계
 */
export function StatusGrid({
  report,
  stateOf,
  onOpen,
}: {
  report: AbsenceReport
  stateOf: (groupId: string) => GroupDayState | undefined
  onOpen: (groupId: string) => void
}) {
  const headId = useId()
  const groups = report.groups
  const done = groups.filter((g) => stateOf(g.group.id) === 'done').length

  return (
    <section aria-labelledby={headId} className="@container">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-0.5">
        <h2 id={headId} className="text-[16px] font-bold">
          보고 완료 <span className="tabular text-ok">{done}</span> <span className="tabular font-medium text-ink-3">/ {groups.length}</span>
        </h2>
        <span className="flex items-center gap-3 text-[12px] font-medium text-ink-3" aria-hidden="true">
          <span className="inline-flex items-center gap-1.5">
            <StateIcon done size={14} />
            완료
          </span>
          <span className="inline-flex items-center gap-1.5">
            <StateIcon done={false} size={14} />
            미완료
          </span>
        </span>
      </div>

      <ul className="grid grid-cols-3 gap-2 @lg:grid-cols-4 @2xl:grid-cols-5">
        {groups.map((g) => (
          <li key={g.group.id} className="flex min-w-0">
            <StatusTile g={g} state={stateOf(g.group.id)} onOpen={onOpen} />
          </li>
        ))}
      </ul>

      <CategoryTotals report={report} />
    </section>
  )
}

function StatusTile({ g, state, onOpen }: { g: AbsenceGroup; state: GroupDayState | undefined; onOpen: (groupId: string) => void }) {
  const done = state === 'done'
  const s = g.summary
  const label = dayStateLabel(state)
  // 완료면 출석 수, 아니면 아직 체크 안 한 인원 (다 체크했으면 출석 수)
  const showUnchecked = !done && s.unchecked > 0
  const sub = showUnchecked ? `미확인 ${s.unchecked}` : `출석 ${presentOfTotal(s)}`
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={`${g.group.name} 목장 ${label}, ${showUnchecked ? `${sub}명` : sub}`}
      onClick={() => onOpen(g.group.id)}
      className={`flex min-h-[92px] w-full min-w-0 flex-col items-stretch justify-between gap-1.5 rounded-2xl border-[1.5px] px-2 py-2.5 text-left transition active:scale-[0.98] min-[375px]:px-2.5 sm:px-3 ${
        done ? 'border-ok-line bg-ok-soft hover:border-ok/50' : 'border-danger-line bg-danger-soft hover:border-danger/50'
      }`}
    >
      {/* 긴 목장 이름은 줄여 쓰지 않고 줄을 바꾼다 */}
      <span className="text-[15px] leading-tight font-bold break-keep text-ink [overflow-wrap:anywhere]">{g.group.name}</span>
      <span className="flex flex-col gap-0.5">
        <span className={`inline-flex items-center gap-1 text-[13px] leading-snug font-bold ${done ? 'text-ok' : 'text-danger'}`}>
          <StateIcon done={done} />
          {label}
        </span>
        <span className="tabular text-[12px] leading-snug font-medium break-keep text-ink-2">{sub}</span>
      </span>
    </button>
  )
}

/** 합계 줄 순서 */
const TOTAL_ORDER: readonly AbsenceCategory[] = ['away', 'nocontact', 'other']

/** 결석 합계 한 줄: 결석 | ● 타지 2  ● 연락두절 1  ● 기타 3 (+ 미확인) */
function CategoryTotals({ report }: { report: AbsenceReport }) {
  const t = report.totals
  return (
    <div className="mt-3 flex min-h-11 items-center gap-2 rounded-2xl bg-surface px-3 py-2 text-[13px] shadow-[var(--shadow-card)]">
      <span className="shrink-0 font-bold text-ink">결석</span>
      <span className="h-4 w-px shrink-0 bg-line" aria-hidden="true" />
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        {TOTAL_ORDER.map((c) => {
          const st = STATUS_STYLE[c]
          return (
            <span key={c} className={`inline-flex h-[26px] items-center gap-1.5 rounded-full px-2.5 font-semibold whitespace-nowrap ${st.soft} ${st.ink}`}>
              <span className={`h-2 w-2 rounded-full ${st.dot}`} aria-hidden="true" />
              {ABSENCE_KIND_LABEL[c]} <b className="tabular font-bold">{t[c]}</b>
            </span>
          )
        })}
        {t.unchecked > 0 && (
          <span className="inline-flex h-[26px] items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 font-semibold whitespace-nowrap text-ink-2">
            <span className="h-2 w-2 rounded-full border-[1.5px] border-ink-3" aria-hidden="true" />
            {ABSENCE_KIND_LABEL.unchecked} <b className="tabular font-bold">{t.unchecked}</b>
          </span>
        )}
      </span>
    </div>
  )
}
