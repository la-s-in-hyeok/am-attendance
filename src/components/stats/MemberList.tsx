import { useDeferredValue, useMemo, useState } from 'react'
import type { Group, Member } from '../../lib/types'
import { ROLE_LABEL } from '../../lib/types'
import type { MemberStat } from '../../lib/compute'
import { Card, Icon, SERVICE_STYLE, Segmented } from '../ui'
import { GRID_LIST, RateBar } from './parts'

type Sort = 'rate' | 'name'
const PAGE = 30

/** 개인별 출석 현황 (검색 + 정렬) */
export function MemberList({
  stats,
  service2,
  groups,
  today,
  onOpen,
}: {
  stats: MemberStat[]
  /** 사람별 2부 출석 횟수 (1부 = 출석 - 2부) */
  service2: Map<string, number>
  groups: Group[]
  today: string
  onOpen: (m: Member) => void
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('rate')
  const [limit, setLimit] = useState(PAGE)
  const q = useDeferredValue(query.trim())
  const groupName = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups])

  const list = useMemo(() => {
    const filtered = q
      ? stats.filter((s) => s.member.name.includes(q) || (groupName.get(s.member.groupId) ?? '').toLowerCase().includes(q.toLowerCase()))
      : stats
    const byName = (a: MemberStat, b: MemberStat) => a.member.name.localeCompare(b.member.name, 'ko')
    return [...filtered].sort((a, b) => {
      if (sort === 'name') return byName(a, b)
      const ra = a.rate ?? 2
      const rb = b.rate ?? 2
      return ra - rb || b.weeks - a.weeks || byName(a, b)
    })
  }, [stats, q, sort, groupName])

  const shown = list.slice(0, limit)

  return (
    <div>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative block flex-1">
          <Icon name="search" size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setLimit(PAGE)
            }}
            placeholder="이름이나 목장으로 찾기"
            aria-label="이름이나 목장으로 찾기"
            className="h-11 w-full rounded-2xl border border-line bg-surface pr-4 pl-10 outline-none transition placeholder:text-ink-3 focus:border-ink"
          />
        </label>
        <Segmented<Sort>
          value={sort}
          onChange={setSort}
          className="shrink-0 whitespace-nowrap max-md:*:h-11"
          options={[
            { value: 'rate', label: '출석률 낮은 순' },
            { value: 'name', label: '이름순' },
          ]}
        />
      </div>

      <Card className="overflow-hidden">
        {list.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-3">{q ? `'${q}'에 맞는 사람이 없어요.` : '이 기간에는 명단에 있던 사람이 없어요.'}</p>
        ) : (
          <ul className={GRID_LIST}>
            {shown.map((s) => {
              const m = s.member
              const left = m.removedOn !== null && m.removedOn <= today
              const s2 = Math.min(s.present, service2.get(m.id) ?? 0)
              const byService = [
                { sv: 1 as const, n: s.present - s2 },
                { sv: 2 as const, n: s2 },
              ].filter((x) => x.n > 0)
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(m)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-black/[0.02] active:bg-black/[0.04] sm:px-5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-1.5">
                        <span className="min-w-0 truncate text-[15px] font-bold">{m.name}</span>
                        {/* 자리가 모자라면 목장 이름이 먼저 줄어든다 */}
                        <span className="min-w-0 shrink-[4] truncate text-[13px] text-ink-3">
                          {groupName.get(m.groupId) ?? ''}
                          {m.role && ` · ${ROLE_LABEL[m.role]}`}
                        </span>
                        {left && <span className="shrink-0 rounded-full bg-bg px-1.5 text-[12px] font-semibold text-ink-3">명단에서 빠짐</span>}
                        {byService.length > 0 && (
                          <span className="tabular ml-auto inline-flex shrink-0 items-center gap-2 self-center text-[13px] text-ink-3">
                            {byService.map((x) => (
                              <span key={x.sv} className="inline-flex items-center gap-1">
                                <span className={`h-1.5 w-1.5 rounded-full ${SERVICE_STYLE[x.sv].bg}`} />
                                {SERVICE_STYLE[x.sv].label} <b className="font-semibold text-ink-2">{x.n}</b>
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                      <span className="mt-1.5 flex items-center gap-2.5">
                        <RateBar value={s.rate} value2={s.weeks > 0 ? s2 / s.weeks : 0} className="flex-1" />
                        <span className="tabular w-[92px] shrink-0 text-right text-[13px] text-ink-3">
                          출석 <b className="font-bold text-ink-2">{s.present}</b>/{s.weeks}주
                        </span>
                      </span>
                    </span>
                    <span className="tabular w-12 shrink-0 text-right text-[16px] font-extrabold">
                      {s.rate === null ? '-' : `${Math.round(s.rate * 100)}%`}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {list.length > shown.length && (
          <button
            type="button"
            onClick={() => setLimit((l) => l + PAGE * 2)}
            className="flex h-12 w-full items-center justify-center gap-1 border-t border-line text-sm font-semibold text-ink-2 transition hover:bg-black/[0.02]"
          >
            {list.length - shown.length}명 더 보기
            <Icon name="chevronDown" size={16} />
          </button>
        )}
      </Card>
    </div>
  )
}
