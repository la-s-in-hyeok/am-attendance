import type { ReactNode } from 'react'
import { SERVICE_STYLE } from '../ui'
import { roundParts } from './statsCompute'

export interface Kpi {
  rate: number | null
  /** 지난달 출석률 (비교용) */
  prevRate: number | null
  /** 주일 평균 출석 인원 (새신자·방문 포함) */
  avgAttend: number | null
  /** 주일 평균을 1부 / 2부 / 새신자·방문으로 나눈 값 (합 = avgAttend) */
  avgParts: { service1: number; service2: number; extra: number } | null
  heldCount: number
  sundayCount: number
  newcomers: number
  visitors: number
}

function Tile({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean }) {
  return (
    <div
      className={`flex min-h-[112px] flex-col justify-between rounded-[var(--radius-card)] p-4 ${
        accent ? 'bg-present text-ink' : 'bg-surface shadow-[var(--shadow-card)]'
      }`}
    >
      <p className={`text-[13px] font-semibold ${accent ? 'text-present-ink' : 'text-ink-3'}`}>{label}</p>
      <div>
        <p className="tabular text-[28px] leading-none font-extrabold tracking-tight">{value}</p>
        {sub && <div className={`mt-1.5 text-[13px] leading-snug font-medium ${accent ? 'text-present-ink' : 'text-ink-3'}`}>{sub}</div>}
      </div>
    </div>
  )
}

function Unit({ children }: { children: ReactNode }) {
  return <span className="ml-0.5 text-base font-bold">{children}</span>
}

function deltaText(rate: number | null, prev: number | null): string {
  if (rate === null) return '아직 기록이 없어요'
  if (prev === null) return '지난달 기록이 없어요'
  const d = Math.round((rate - prev) * 100)
  if (d === 0) return '지난달과 같아요'
  return d > 0 ? `지난달보다 ${d}%p 올랐어요` : `지난달보다 ${-d}%p 내렸어요`
}

/** 주일 평균: ● 1부 18  ● 2부 9  (+ 새신자·방문 3) */
function AvgSplit({ parts }: { parts: NonNullable<Kpi['avgParts']> }) {
  const [s1, s2, extra] = roundParts([parts.service1, parts.service2, parts.extra])
  return (
    <>
      <span className="tabular flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {([1, 2] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <span className={`h-2 w-2 shrink-0 rounded-full ${SERVICE_STYLE[s].bg}`} />
            {SERVICE_STYLE[s].label} <b className="font-bold text-ink-2">{s === 1 ? s1 : s2}</b>
          </span>
        ))}
      </span>
      <span className="tabular mt-0.5 block">{extra > 0 ? `새신자·방문 +${extra}` : '한 주일 평균'}</span>
    </>
  )
}

export function KpiTiles({ kpi, monthLabel }: { kpi: Kpi; monthLabel: string }) {
  const ratePct = kpi.rate === null ? null : Math.round(kpi.rate * 100)
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile
        accent
        label={`${monthLabel} 출석률`}
        value={ratePct === null ? '-' : <>{ratePct}<Unit>%</Unit></>}
        sub={deltaText(kpi.rate, kpi.prevRate)}
      />
      <Tile
        label="주일 평균 출석"
        value={kpi.avgAttend === null ? '-' : <>{Math.round(kpi.avgAttend)}<Unit>명</Unit></>}
        sub={kpi.avgParts ? <AvgSplit parts={kpi.avgParts} /> : '한 주일에, 새신자·방문까지'}
      />
      <Tile
        label="출석 받은 주일"
        value={<>{kpi.heldCount}<Unit>번</Unit></>}
        sub={kpi.sundayCount > 0 ? `이 달 주일 ${kpi.sundayCount}번 중` : '아직 주일이 없어요'}
      />
      <Tile
        label="새신자"
        value={<>{kpi.newcomers}<Unit>명</Unit></>}
        sub={kpi.visitors > 0 ? `방문한 분도 ${kpi.visitors}명 있어요` : '이 달에 처음 온 분'}
      />
    </div>
  )
}
