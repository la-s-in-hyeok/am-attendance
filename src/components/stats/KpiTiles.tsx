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

/** 요약 칸 하나. brand 이면 파랗게 칠한 대표 칸 */
function Tile({ label, value, sub, brand }: { label: string; value: ReactNode; sub: ReactNode; brand?: boolean }) {
  return (
    <div
      className={`flex min-h-[96px] min-w-0 flex-col justify-between gap-1.5 rounded-2xl p-3 sm:p-4 ${
        brand ? 'bg-brand text-white shadow-[0_4px_12px_rgb(10_114_180/0.22)]' : 'bg-surface text-ink shadow-[var(--shadow-card)]'
      }`}
    >
      <p className={`text-[12px] leading-tight font-semibold sm:text-[13px] ${brand ? 'text-white' : 'text-ink-3'}`}>{label}</p>
      <div>
        <p className="tabular text-[28px] leading-none font-bold tracking-tight sm:text-[30px]">{value}</p>
        <div className={`mt-1.5 min-h-4 text-[12px] leading-tight font-medium sm:text-[13px] ${brand ? 'text-white' : 'text-ink-3'}`}>{sub}</div>
      </div>
    </div>
  )
}

function Unit({ children }: { children: ReactNode }) {
  return <span className="ml-px text-base font-bold">{children}</span>
}

/** 지난달과 비교: '지난달 +5%p' */
function deltaText(rate: number | null, prev: number | null): string {
  if (rate === null || prev === null) return ''
  const d = Math.round((rate - prev) * 100)
  if (d === 0) return '지난달과 같음'
  return `지난달 ${d > 0 ? '+' : '−'}${Math.abs(d)}%p`
}

/** 주일 평균: ● 1부 18  ● 2부 9 (나머지는 새신자·방문. 새신자 수는 제목 줄에 따로 보여 준다) */
function AvgSplit({ parts }: { parts: NonNullable<Kpi['avgParts']> }) {
  const [s1, s2, extra] = roundParts([parts.service1, parts.service2, parts.extra])
  return (
    <span className="tabular flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {([1, 2] as const).map((s) => (
        <span key={s} className="inline-flex items-center gap-1 whitespace-nowrap">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${SERVICE_STYLE[s].bg}`} />
          {SERVICE_STYLE[s].label} <b className="font-bold text-ink-2">{s === 1 ? s1 : s2}</b>
        </span>
      ))}
      {extra > 0 && <span className="sr-only">새신자·방문 {extra}</span>}
    </span>
  )
}

/** 고른 달 요약 세 칸: 평균 출석률(파랑) · 평균 출석 · 출석 받은 주일 */
export function KpiTiles({ kpi }: { kpi: Kpi }) {
  const ratePct = kpi.rate === null ? null : Math.round(kpi.rate * 100)
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      <Tile
        brand
        label="평균 출석률"
        value={ratePct === null ? '-' : <>{ratePct}<Unit>%</Unit></>}
        sub={deltaText(kpi.rate, kpi.prevRate)}
      />
      <Tile
        label="평균 출석"
        value={kpi.avgAttend === null ? '-' : <>{Math.round(kpi.avgAttend)}<Unit>명</Unit></>}
        sub={kpi.avgParts ? <AvgSplit parts={kpi.avgParts} /> : ''}
      />
      <Tile
        label="출석 받은 주일"
        value={<>{kpi.heldCount}<Unit>주</Unit></>}
        sub={kpi.sundayCount > 0 ? `${kpi.sundayCount}주 중` : ''}
      />
    </div>
  )
}
