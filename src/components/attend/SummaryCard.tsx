import type { WeekTotals } from '../../lib/compute'
import { pct, rate } from '../../lib/compute'
import type { ISODate, Status } from '../../lib/types'
import { STATUS_LABEL } from '../../lib/types'
import { labelMD } from '../../lib/dates'
import { Card, Icon, STATUS_STYLE, StackBar } from '../ui'

type LegendKey = 'service1' | 'service2' | Exclude<Status, 'present'> | 'unchecked'

const LEGEND: { key: LegendKey; label: string; dot: string }[] = [
  { key: 'service1', label: '1부', dot: 'bg-present' },
  { key: 'service2', label: '2부', dot: 'bg-present2' },
  { key: 'away', label: STATUS_LABEL.away, dot: STATUS_STYLE.away.dot },
  { key: 'nocontact', label: STATUS_LABEL.nocontact, dot: STATUS_STYLE.nocontact.dot },
  { key: 'other', label: STATUS_LABEL.other, dot: STATUS_STYLE.other.dot },
  { key: 'unchecked', label: '미확인', dot: STATUS_STYLE.unchecked.dot },
]

/** 그 주일 전체 요약: 총 출석(목장원 + 새신자 + 방문), 출석률, 미확인 */
export function SummaryCard({ totals, date }: { totals: WeekTotals; date: ISODate }) {
  const r = rate(totals.present, totals.total)
  const allChecked = totals.total > 0 && totals.unchecked === 0

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-3">{labelMD(date)} 총 출석</p>
          <p className="mt-1.5 flex items-baseline gap-1">
            <span className="tabular bg-[linear-gradient(transparent_62%,var(--color-present)_62%)] px-0.5 text-[46px] leading-none font-extrabold tracking-tight">
              {totals.grandTotal}
            </span>
            <span className="text-lg font-bold">명</span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[13px] font-medium text-ink-3">목장원 출석률</p>
          <p className="tabular mt-1 text-[26px] leading-none font-extrabold">{pct(r)}</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-[1.4fr_1fr_1fr] gap-2">
        <Stat
          label="목장원 출석"
          value={totals.present}
          suffix={`/${totals.total}`}
          hint={[
            { label: `1부 ${totals.service1}`, dot: 'bg-present' },
            { label: `2부 ${totals.service2}`, dot: 'bg-present2' },
          ]}
        />
        <Stat label="새신자" value={totals.newcomers} />
        <Stat label="방문" value={totals.visitors} />
      </div>

      <StackBar
        className="mt-5"
        present={totals.present}
        service2={totals.service2}
        away={totals.away}
        nocontact={totals.nocontact}
        other={totals.other}
        total={totals.total}
      />
      <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[13px] text-ink-2">
        {LEGEND.map((l) => (
          <span key={l.key} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${l.dot}`} />
            {l.label}
            <span className="tabular font-semibold text-ink">{totals[l.key]}</span>
          </span>
        ))}
      </div>

      {totals.total > 0 && (
        <div
          className={`mt-4 flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold ${
            allChecked ? 'bg-ok/10 text-ok' : `${STATUS_STYLE.unchecked.soft} text-ink-2`
          }`}
        >
          {allChecked ? (
            <>
              <Icon name="check" size={16} strokeWidth={2.6} />
              모든 목장 확인 완료
            </>
          ) : (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-ink-3" />
              아직 확인 안 한 사람이 <span className="tabular font-extrabold text-ink">{totals.unchecked}명</span> 있어요
            </>
          )}
        </div>
      )}
    </Card>
  )
}

function Stat({ label, value, suffix, hint }: { label: string; value: number; suffix?: string; hint?: { label: string; dot: string }[] }) {
  return (
    <div className="min-w-0 rounded-2xl bg-bg px-3 py-2.5">
      <p className="text-[13px] font-medium text-ink-3">{label}</p>
      <p className="tabular mt-0.5 text-[19px] font-extrabold">
        {value}
        {suffix && <span className="text-sm font-semibold text-ink-3">{suffix}</span>}
      </p>
      {hint && (
        <p className="tabular mt-0.5 flex flex-wrap gap-x-2 text-[13px] leading-snug font-medium text-ink-3">
          {hint.map((h) => (
            <span key={h.dot} className="inline-flex items-center gap-1 whitespace-nowrap">
              <span className={`h-1.5 w-1.5 rounded-full ${h.dot}`} />
              {h.label}
            </span>
          ))}
        </p>
      )}
    </div>
  )
}
