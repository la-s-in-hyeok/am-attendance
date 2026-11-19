import { useDeferredValue, useMemo, useRef, type KeyboardEvent } from 'react'
import type { Member } from '../../lib/types'
import { memberStats } from '../../lib/compute'
import { monthRange } from '../../lib/dates'
import { useStore } from '../../store'
import { useRecordList } from '../../hooks'
import { Card, Icon, IconButton, Segmented } from '../ui'
import { MemberList, type Sort } from './MemberList'
import { memberService2 } from './statsCompute'

export type Scope = 'month' | 'year'

/** '개인 찾기' 칸에 넣은 값 (다른 칸에 다녀와도 남도록 통계 화면이 들고 있다) */
export interface FindState {
  query: string
  scope: Scope
  sort: Sort
}

export const FIND_START: FindState = { query: '', scope: 'month', sort: 'rate' }

/** 휴대폰 키보드의 '검색'을 누르면 키보드를 내려 결과가 보이게 */
function blurOnEnter(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === 'Enter') e.currentTarget.blur()
}

/** '개인 찾기' 칸: 이름(초성도 됨)이나 목장 이름으로 찾은 사람만 보여 준다. 찾기 전에는 아무도 보여 주지 않는다 */
export function FindPanel({
  value,
  onChange,
  month,
  year,
  today,
  onOpen,
}: {
  value: FindState
  onChange: (v: FindState) => void
  /** 통계 화면에서 고른 달 (YYYY-MM) */
  month: string
  year: number
  today: string
  onOpen: (m: Member) => void
}) {
  const members = useStore((s) => s.members)
  const groups = useStore((s) => s.groups)
  const records = useRecordList()
  const input = useRef<HTMLInputElement>(null)

  const q = useDeferredValue(value.query.trim())
  const active = q !== ''

  // 찾기 전에는 계산하지 않는다
  const { from, to } = value.scope === 'month' ? monthRange(month) : { from: `${year}-01-01`, to: `${year}-12-31` }
  const people = useMemo(
    () => (active ? memberStats(members, records, from, to).filter((s) => s.weeks > 0) : []),
    [active, members, records, from, to],
  )
  const service2 = useMemo(
    () => (active ? memberService2(members, records, from, to) : new Map<string, number>()),
    [active, members, records, from, to],
  )

  const set = (patch: Partial<FindState>) => onChange({ ...value, ...patch })

  return (
    <div>
      <div className="relative">
        <label className="block">
          <Icon name="search" size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-3" />
          <input
            ref={input}
            type="search"
            value={value.query}
            onChange={(e) => set({ query: e.target.value })}
            onKeyDown={blurOnEnter}
            enterKeyHint="search"
            autoComplete="off"
            placeholder="이름이나 목장으로 찾기"
            aria-label="이름이나 목장으로 찾기"
            className="h-12 w-full rounded-2xl border border-line bg-surface pr-12 pl-10 shadow-[var(--shadow-card)] outline-none transition placeholder:text-ink-3 focus:border-brand [&::-webkit-search-cancel-button]:appearance-none"
          />
        </label>
        {value.query && (
          <span className="absolute inset-y-0 right-1 flex items-center">
            <IconButton
              icon="x"
              label="검색어 지우기"
              size={18}
              onClick={() => {
                set({ query: '' })
                input.current?.focus()
              }}
            />
          </span>
        )}
      </div>

      {active ? (
        <>
          <div className="mt-4 mb-3 flex flex-wrap items-center justify-between gap-2">
            <Segmented<Scope>
              value={value.scope}
              onChange={(scope) => set({ scope })}
              className="max-md:*:px-2.5"
              options={[
                { value: 'month', label: `${Number(month.slice(5, 7))}월` },
                { value: 'year', label: `${year}년` },
              ]}
            />
            <Segmented<Sort>
              value={value.sort}
              onChange={(sort) => set({ sort })}
              className="max-md:*:px-2.5"
              options={[
                { value: 'rate', label: '출석률 낮은 순' },
                { value: 'name', label: '이름순' },
              ]}
            />
          </div>
          <MemberList stats={people} service2={service2} groups={groups} today={today} query={q} sort={value.sort} onOpen={onOpen} />
        </>
      ) : (
        <Card className="mt-4 px-5 py-8 text-center text-sm text-ink-3">이름을 검색하면 출석 현황이 보여요</Card>
      )}
    </div>
  )
}
