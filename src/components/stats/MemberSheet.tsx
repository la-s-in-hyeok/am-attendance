import { useMemo } from 'react'
import type { ISODate, Member, Service, Status } from '../../lib/types'
import { ROLE_LABEL, SERVICE_LABEL, STATUS_LABEL } from '../../lib/types'
import { isOnRoster, rate, recKey, serviceOf } from '../../lib/compute'
import { labelDot, labelMD } from '../../lib/dates'
import { useStore } from '../../store'
import { recordStyle, SERVICE_STYLE, Sheet, STATUS_STYLE, StatusPill } from '../ui'

type Cell = { date: ISODate; status: Status | 'unchecked'; service: Service | null; reason: string }

const ORDER: (Status | 'unchecked')[] = ['present', 'away', 'nocontact', 'other', 'unchecked']

/** 한 사람의 한 해 출석 기록 */
export function MemberSheet({
  member,
  year,
  held,
  onClose,
}: {
  member: Member | null
  year: number
  /** 출석을 받은 주일 전체 (오래된 순) */
  held: ISODate[]
  onClose: () => void
}) {
  const records = useStore((s) => s.records)
  const groups = useStore((s) => s.groups)

  const data = useMemo(() => {
    if (!member) return null
    const prefix = `${year}-`
    const cells: Cell[] = []
    for (const d of held) {
      if (!d.startsWith(prefix) || !isOnRoster(member, d)) continue
      const r = records[recKey(d, member.id)]
      cells.push({ date: d, status: r?.status ?? 'unchecked', service: serviceOf(r), reason: r?.reason ?? '' })
    }
    const counts: Record<Status | 'unchecked', number> = { present: 0, away: 0, nocontact: 0, other: 0, unchecked: 0 }
    const services: Record<Service, number> = { 1: 0, 2: 0 }
    for (const c of cells) {
      counts[c.status]++
      if (c.service) services[c.service]++
    }
    const byMonth = new Map<number, Cell[]>()
    for (const c of cells) {
      const m = Number(c.date.slice(5, 7))
      const list = byMonth.get(m)
      if (list) list.push(c)
      else byMonth.set(m, [c])
    }
    const reasons = cells.filter((c) => c.status !== 'present' && c.reason.trim()).reverse()
    return { cells, counts, services, byMonth: [...byMonth.entries()], reasons, rate: rate(counts.present, cells.length) }
  }, [member, year, held, records])

  const group = member ? groups.find((g) => g.id === member.groupId) : undefined

  return (
    <Sheet open={!!member} onClose={onClose} title={member?.name}>
      {member && data && (
        <div>
          <p className="-mt-1 text-sm text-ink-3">
            {group?.name ?? '목장 없음'}
            {member.role && ` · ${ROLE_LABEL[member.role]}`}
            {member.removedOn && ` · ${labelMD(member.removedOn)}부터 명단에서 빠짐`}
          </p>

          {data.cells.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-3">{year}년에는 이 분의 출석 기록이 없어요.</p>
          ) : (
            <>
              <div className="mt-4 flex items-end justify-between rounded-2xl bg-present-soft px-4 py-3.5">
                <div>
                  <p className="text-[13px] font-semibold text-present-ink">{year}년 출석률</p>
                  <p className="tabular mt-0.5 text-[28px] leading-none font-extrabold">
                    {data.rate === null ? '-' : Math.round(data.rate * 100)}
                    <span className="ml-0.5 text-base">%</span>
                  </p>
                </div>
                <div className="tabular text-right text-sm font-semibold text-present-ink">
                  <p>
                    {data.cells.length}주 중 {data.counts.present}주 출석
                  </p>
                  {data.counts.present > 0 && (
                    <p className="mt-1 flex flex-wrap items-center justify-end gap-x-2.5 text-[13px]">
                      {([1, 2] as const).map((s) => (
                        <span key={s} className="inline-flex items-center gap-1">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${SERVICE_STYLE[s].bg} ring-1 ring-black/5`} />
                          {SERVICE_LABEL[s]} <b className="font-extrabold text-ink">{data.services[s]}</b>회
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {ORDER.filter((k) => k !== 'present' && data.counts[k] > 0).map((k) => (
                  <span key={k} className={`tabular inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[13px] font-semibold ${STATUS_STYLE[k].soft} ${STATUS_STYLE[k].ink}`}>
                    {k === 'unchecked' ? '미확인' : STATUS_LABEL[k]} {data.counts[k]}
                  </span>
                ))}
              </div>

              <div className="mt-5 space-y-2">
                {data.byMonth.map(([m, cells]) => (
                  <div key={m} className="flex items-center gap-3">
                    <span className="tabular w-8 shrink-0 text-right text-[13px] font-semibold text-ink-3">{m}월</span>
                    <div className="flex flex-wrap gap-1.5">
                      {cells.map((c) => {
                        const st = recordStyle(c.status, c.service)
                        const label =
                          c.status === 'unchecked' ? '미확인' : c.service ? `${SERVICE_LABEL[c.service]} 출석` : STATUS_LABEL[c.status]
                        return (
                          <span
                            key={c.date}
                            title={`${labelDot(c.date)} ${label}${c.reason ? ` · ${c.reason}` : ''}`}
                            className={`tabular flex h-9 w-9 items-center justify-center rounded-xl text-[13px] font-bold ${
                              c.status === 'present' ? `${st.bg} text-ink` : `${st.soft} ${st.ink}`
                            }`}
                          >
                            {Number(c.date.slice(8, 10))}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-ink-3">
                칸 안의 숫자는 날짜예요. 노란 칸은 1부, 민트 칸은 2부 출석이고, 옅은 회색 칸은 미확인이에요.
              </p>

              {data.reasons.length > 0 && (
                <div className="mt-6">
                  <p className="mb-2 text-sm font-bold">결석 사유</p>
                  <ul className="space-y-2">
                    {data.reasons.map((c) => (
                      <li key={c.date} className="flex items-start gap-2.5 text-sm">
                        <span className="tabular w-11 shrink-0 pt-0.5 font-semibold text-ink-3">{labelDot(c.date)}</span>
                        <StatusPill status={c.status} className="shrink-0" />
                        <span className="min-w-0 flex-1 pt-0.5 leading-snug text-ink-2">{c.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Sheet>
  )
}
