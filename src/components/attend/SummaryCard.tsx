import type { ReactNode } from 'react'
import type { WeekTotals } from '../../lib/compute'
import { pct, rate } from '../../lib/compute'
import { Card, Icon, Ring } from '../ui'
import type { NoteSection } from './WeekNoteEditor'

/**
 * 그 주일 전체 요약: 총 출석(목장원 + 새신자 + 방문 + 바나바), 목장원 출석률, 1부·2부·미확인.
 * 아래 새신자·방문·바나바 칸을 누르면 적는 창이 그 자리로 열린다
 */
export function SummaryCard({ totals, onOpenNotes }: { totals: WeekTotals; onOpenNotes: (section: NoteSection) => void }) {
  const r = rate(totals.present, totals.total)
  const allChecked = totals.total > 0 && totals.unchecked === 0

  return (
    <>
      <Card className="flex flex-col gap-3 px-[18px] py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-ink-2">총 출석</p>
            <p className="mt-0.5 flex items-baseline gap-0.5 text-brand">
              <span className="tabular text-[44px] leading-none font-bold tracking-[-0.02em]">{totals.grandTotal}</span>
              <span className="text-[20px] leading-none font-bold">명</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="text-right text-[12px] leading-snug font-semibold text-ink-2">
              목장원
              <br />
              출석률
            </span>
            <Ring value={r ?? 0} size={64} stroke={7}>
              <span className="tabular text-[15px] font-bold text-ink">{pct(r)}</span>
            </Ring>
          </div>
        </div>

        {/* [1부 12] [2부 5] ……… [미확인 3] */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill className="bg-present text-present-ink">
            1부 <b className="font-bold">{totals.service1}</b>
          </Pill>
          <Pill className="bg-present2 text-present2-ink">
            2부 <b className="font-bold">{totals.service2}</b>
          </Pill>
          {allChecked ? (
            <Pill className="ml-auto bg-ok-soft text-ok">
              <Icon name="check" size={14} strokeWidth={2.8} />
              모두 확인
            </Pill>
          ) : (
            totals.total > 0 && (
              <Pill className="ml-auto bg-muted text-ink-2">
                미확인 <b className="font-bold">{totals.unchecked}</b>
              </Pill>
            )
          )}
        </div>
      </Card>

      {/* 새신자 · 방문 · 바나바 세 칸 (칸이 좁은 휴대폰에서는 아이콘을 뺀다) */}
      <div className="@container">
        <div className="grid grid-cols-3 gap-2 @min-[30rem]:gap-2.5">
          <NoteTile
            section="newcomers"
            label="새신자"
            count={totals.newcomers}
            // 바나바 명단에도 있는 새신자는 바나바 칸에서 한 번만 세요 (칸 숫자를 더한 값과 총 출석이 다른 이유)
            sub={totals.newcomers > totals.newcomersOnly ? `${totals.newcomers - totals.newcomersOnly}명은 바나바` : undefined}
            onOpen={onOpenNotes}
          />
          <NoteTile section="visitors" label="방문" count={totals.visitors} onOpen={onOpenNotes} />
          <NoteTile section="barnabas" label="바나바" count={totals.barnabas} onOpen={onOpenNotes} />
        </div>
      </div>
    </>
  )
}

function Pill({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={`tabular inline-flex h-[30px] items-center gap-1 rounded-full px-3 text-[13px] font-semibold whitespace-nowrap ${className}`}>
      {children}
    </span>
  )
}

type PersonKind = 'plus' | 'one' | 'pair'

/** 사람 모양 (새신자는 + 가 붙고, 바나바는 두 사람) */
function PersonIcon({ kind }: { kind: PersonKind }) {
  const d =
    kind === 'plus'
      ? 'M10 11.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM3.5 20a6.5 6.5 0 0113 0M19 8v6M16 11h6'
      : kind === 'pair'
        ? 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 6.5M18.5 14.2A6.5 6.5 0 0121.5 20'
        : 'M12 11.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM5 20a7 7 0 0114 0'
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const TILE: Record<NoteSection, { chip: string; icon: PersonKind }> = {
  newcomers: { chip: 'bg-accent-soft text-accent-soft-ink', icon: 'plus' },
  visitors: { chip: 'bg-brand-soft text-brand', icon: 'one' },
  barnabas: { chip: 'bg-present2-soft text-present2-ink', icon: 'pair' },
}

/** [아이콘 새신자 2명 +] — 누르면 새신자·방문·바나바 창이 그 칸 자리로 열린다 */
function NoteTile({
  section,
  label,
  count,
  sub,
  onOpen,
}: {
  section: NoteSection
  label: string
  count: number
  /** 이름 옆 작은 설명 (예: '1명은 바나바') */
  sub?: string
  onOpen: (section: NoteSection) => void
}) {
  const t = TILE[section]
  return (
    <button
      type="button"
      onClick={() => onOpen(section)}
      aria-haspopup="dialog"
      className="flex h-[60px] min-w-0 items-center gap-2 rounded-2xl bg-surface pr-2 pl-3 text-left shadow-[var(--shadow-card)] transition hover:bg-hover active:scale-[0.98] max-[359px]:pl-2.5 @min-[30rem]:gap-2.5 @min-[30rem]:pr-2.5"
    >
      {/* 세 칸이 좁을 때(휴대폰)는 숫자가 잘리지 않게 아이콘을 뺀다 */}
      <span className={`hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl @min-[30rem]:flex ${t.chip}`}>
        <PersonIcon kind={t.icon} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-[12px] font-semibold text-ink-2">{label}</span>
        <span className="tabular shrink-0 text-[17px] font-bold whitespace-nowrap text-ink">{count}명</span>
        {sub && <span className="truncate text-[11px] font-medium text-ink-3">{sub}</span>}
      </span>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-white">
        <Icon name="plus" size={16} strokeWidth={2.6} />
      </span>
    </button>
  )
}
