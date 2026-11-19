import type { ReactNode } from 'react'
import { IconButton } from '../ui'

/** 통계 화면의 한 덩어리 (제목 + 내용) */
export function Section({ title, sub, right, children }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-9">
      <div className="mb-3 flex items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <h2 className="text-[19px] leading-tight font-bold tracking-tight">{title}</h2>
          {sub && <p className="mt-1 text-sm text-ink-3">{sub}</p>}
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      {children}
    </section>
  )
}

/**
 * 줄 목록 (ul 에 쓰는 클래스): 휴대폰은 한 줄에 하나, 넓은 PC 화면은 두 줄로 나란히.
 * 칸 사이 선은 각 줄의 아래·오른쪽 선으로 그리고, 맨 아래 선은 카드 밖으로 1px 밀어 감춘다.
 */
export const GRID_LIST =
  '-mb-px grid lg:grid-cols-2 [&>*]:border-b [&>*]:border-line lg:[&>*:nth-child(odd):not(:last-child)]:border-r'

/** ‹ 2026년 › */
export function YearSwitcher({
  year,
  years,
  loading,
  onChange,
}: {
  year: number
  years: number[]
  loading: boolean
  onChange: (y: number) => void
}) {
  const min = years[years.length - 1] ?? year
  const max = years[0] ?? year
  return (
    <div className="flex items-center rounded-full bg-surface p-0.5 shadow-[var(--shadow-card)]">
      <IconButton
        icon="chevronLeft"
        label="지난해"
        size={18}
        disabled={year <= min || loading}
        className="max-md:size-11 disabled:opacity-25 disabled:hover:bg-transparent"
        onClick={() => onChange(year - 1)}
      />
      <span className="tabular flex min-w-[68px] items-center justify-center gap-1.5 text-[15px] font-bold">
        {loading && <span className="h-3 w-3 animate-spin rounded-full border-2 border-line border-t-ink" />}
        {year}년
      </span>
      <IconButton
        icon="chevronRight"
        label="다음 해"
        size={18}
        disabled={year >= max || loading}
        className="max-md:size-11 disabled:opacity-25 disabled:hover:bg-transparent"
        onClick={() => onChange(year + 1)}
      />
    </div>
  )
}

/**
 * 출석률 막대 (가로). 노랑 = 1부, 민트 = 2부.
 * value2 를 주면 value(전체 출석률) 중 그만큼(0~1, 전체 대비)을 민트로 칠한다.
 */
export function RateBar({ value, value2 = 0, className = '' }: { value: number | null; value2?: number; className?: string }) {
  const v = value === null ? 0 : Math.max(0, Math.min(1, value))
  const v2 = Math.max(0, Math.min(v, value2))
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-[#efefea] ${className}`}>
      <div className="flex h-full overflow-hidden rounded-full transition-all" style={{ width: `${v * 100}%` }}>
        <div className="h-full min-w-0 flex-1 bg-present" />
        {v2 > 0 && <div className="h-full shrink-0 bg-present2" style={{ width: `${(v2 / v) * 100}%` }} />}
      </div>
    </div>
  )
}

/** 출석률 → 노란 정도 (히트맵·점 색) */
export function heat(value: number | null): string | undefined {
  if (value === null) return undefined
  // 20% 이하는 거의 흰색, 95% 이상은 가장 진한 노랑 (차이가 잘 보이도록)
  const p = Math.round(Math.max(0.04, Math.min(1, (value - 0.2) / 0.75)) * 100)
  return `color-mix(in srgb, var(--color-present) ${p}%, var(--color-surface))`
}
