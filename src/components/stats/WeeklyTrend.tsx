import { STATUS_LABEL } from '../../lib/types'
import { labelDot } from '../../lib/dates'
import { Card, Icon, SERVICE_STYLE, StackBar, STATUS_STYLE } from '../ui'
import type { WeekPoint } from './statsCompute'

const LEGEND = [
  { key: 's1', label: '1부', dot: SERVICE_STYLE[1].bg },
  { key: 's2', label: '2부', dot: SERVICE_STYLE[2].bg },
  { key: 'away', label: STATUS_LABEL.away, dot: STATUS_STYLE.away.dot },
  { key: 'nocontact', label: STATUS_LABEL.nocontact, dot: STATUS_STYLE.nocontact.dot },
  { key: 'other', label: STATUS_LABEL.other, dot: STATUS_STYLE.other.dot },
  { key: 'unchecked', label: '미확인', dot: 'bg-track ring-1 ring-line' },
] as const

/** 고른 달의 주일별 출석 흐름 */
export function WeeklyTrend({ points, onOpen }: { points: WeekPoint[]; onOpen: (date: string) => void }) {
  if (points.length === 0)
    return (
      <Card className="px-5 py-8 text-center text-sm text-ink-3">이 달은 아직 출석을 받은 주일이 없어요.</Card>
    )
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-line">
        {points.map((p) => {
          const t = p.totals
          const extra = t.newcomers + t.visitors
          return (
            <li key={p.date}>
              <button
                type="button"
                onClick={() => onOpen(p.date)}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-hover active:bg-muted sm:px-5"
                aria-label={`${labelDot(p.date)} 주일 보고서 보기 (1부 ${t.service1}명, 2부 ${t.service2}명)`}
              >
                <span className="tabular w-11 shrink-0 text-[15px] font-bold">{labelDot(p.date)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="tabular min-w-0 text-[13px] leading-snug text-ink-3">
                      목장원 <b className="font-semibold text-ink-2">{t.present}</b>/{t.total}
                      {extra > 0 && (
                        <>
                          {' · '}새신자·방문 <b className="font-semibold text-ink-2">{extra}</b>
                        </>
                      )}
                    </span>
                    <span className="tabular shrink-0 text-[15px] font-extrabold">
                      {p.rate === null ? '-' : `${Math.round(p.rate * 100)}%`}
                    </span>
                  </span>
                  <StackBar
                    present={t.present}
                    service2={t.service2}
                    away={t.away}
                    nocontact={t.nocontact}
                    other={t.other}
                    total={t.total}
                    className="mt-2"
                  />
                  <span className="tabular mt-1.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-[13px] text-ink-3">
                    <span className="flex min-w-0 items-center gap-2.5">
                      {([1, 2] as const).map((s) => (
                        <span key={s} className="inline-flex items-center gap-1">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${SERVICE_STYLE[s].bg}`} />
                          {SERVICE_STYLE[s].label} <b className="font-semibold text-ink-2">{s === 1 ? t.service1 : t.service2}</b>
                        </span>
                      ))}
                    </span>
                    <span className="shrink-0">
                      총 출석 <b className="font-bold text-ink">{t.grandTotal}명</b>
                    </span>
                  </span>
                </span>
                <Icon name="chevronRight" size={18} className="shrink-0 text-ink-3" />
              </button>
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line bg-hover px-4 py-2.5 sm:px-5">
        {LEGEND.map((l) => (
          <span key={l.key} className="inline-flex items-center gap-1.5 text-[13px] text-ink-3">
            <span className={`h-2 w-2 rounded-full ${l.dot}`} />
            {l.label}
          </span>
        ))}
      </div>
    </Card>
  )
}
