import { useMemo, useState } from 'react'
import type { GroupWeek } from '../../lib/compute'
import { serviceOf } from '../../lib/compute'
import type { ISODate } from '../../lib/types'
import { Icon } from '../ui'
import { MemberRow } from './MemberRow'
import { useAbsenceSheet } from './AbsenceSheet'
import { matchName, useToggleAttendance } from './attendUtils'
import { ServiceSwitch } from './serviceMode'

const MAX_RESULTS = 40

/** 휴대폰에서 찾기 칸을 누르면 칸을 화면 위쪽으로 올려, 키보드가 떠도 찾은 사람이 보이게 */
function liftOnPhone(el: HTMLElement) {
  if (!window.matchMedia('(pointer: coarse) and (max-width: 767px)').matches) return
  window.setTimeout(() => {
    if (document.activeElement !== el) return
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 12, behavior: 'smooth' })
  }, 300)
}

/** 이번 주 명단 전체에서 이름으로 찾아 바로 출석·결석 처리 */
export function MemberSearch({ week, date }: { week: GroupWeek[]; date: ISODate }) {
  const [query, setQuery] = useState('')
  const toggle = useToggleAttendance(date)
  const absence = useAbsenceSheet(date)

  const everyone = useMemo(
    () => week.flatMap((gw) => gw.entries.map((entry) => ({ entry, groupName: gw.group.name }))),
    [week],
  )
  const q = query.trim()
  const matches = useMemo(() => (q ? everyone.filter((x) => matchName(x.entry.member.name, q)) : []), [everyone, q])
  const shown = matches.slice(0, MAX_RESULTS)

  return (
    <section>
      <div className="relative">
        <Icon name="search" size={19} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-ink-3" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
          onFocus={(e) => liftOnPhone(e.currentTarget)}
          placeholder="이름으로 찾기"
          aria-label="이름으로 찾기"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          className="h-13 w-full rounded-2xl border border-transparent bg-surface pr-12 pl-11 shadow-[var(--shadow-card)] outline-none transition placeholder:text-ink-3 focus:border-ink"
        />
        {query && (
          <button
            type="button"
            aria-label="검색어 지우기"
            onClick={() => setQuery('')}
            className="absolute top-1/2 right-1 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-ink-3 hover:bg-black/5"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink-3 text-white">
              <Icon name="x" size={12} strokeWidth={2.8} />
            </span>
          </button>
        )}
      </div>

      {q && (
        <div className="anim-fade mt-2.5">
          {matches.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-ink-3">‘{q}’ 이름을 이번 주 명단에서 찾지 못했어요</p>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <p className="text-[13px] font-medium text-ink-3">{matches.length}명 찾았어요</p>
                <ServiceSwitch compact />
              </div>
              <div className="@container">
                <div className="grid grid-cols-1 gap-2 @2xl:grid-cols-2">
                  {shown.map(({ entry, groupName }) => (
                    <MemberRow
                      key={entry.member.id}
                      member={entry.member}
                      status={entry.status}
                      service={serviceOf(entry.record)}
                      reason={entry.record?.reason ?? ''}
                      groupName={groupName}
                      onToggle={toggle}
                      onAbsent={absence.open}
                    />
                  ))}
                </div>
              </div>
              {matches.length > shown.length && (
                <p className="mt-2 px-1 text-center text-[13px] text-ink-3">
                  {matches.length - shown.length}명이 더 있어요. 이름을 조금 더 입력해 주세요.
                </p>
              )}
            </>
          )}
        </div>
      )}
      {absence.element}
    </section>
  )
}
