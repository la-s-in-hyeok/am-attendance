import type { ReactNode } from 'react'
import type { WeekTotals } from '../../lib/compute'
import { pct, rate } from '../../lib/compute'
import { Card, Icon, Ring } from '../ui'
import type { NoteSection } from './WeekNoteEditor'

/**
 * 그 주일 전체 요약: 총 출석(목장원 + 새신자 + 방문), 목장원 출석률, 1부·2부·미확인.
 * 아래 새신자·방문 칸을 누르면 적는 창이 그 자리로 열린다
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

      <div className="grid grid-cols-2 gap-2.5">
        <NoteTile section="newcomers" label="새신자" count={totals.newcomers} onOpen={onOpenNotes} />
        <NoteTile section="visitors" label="방문" count={totals.visitors} onOpen={onOpenNotes} />
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

/** 사람 모양 (새신자는 + 가 붙는다) */
function PersonIcon({ plus }: { plus?: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {plus ? (
        <path d="M10 11.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM3.5 20a6.5 6.5 0 0113 0M19 8v6M16 11h6" />
      ) : (
        <path d="M12 11.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM5 20a7 7 0 0114 0" />
      )}
    </svg>
  )
}

const TILE = {
  newcomers: { chip: 'bg-accent-soft text-accent-soft-ink', plus: true },
  visitors: { chip: 'bg-brand-soft text-brand', plus: false },
} as const

/** [아이콘 새신자 2명 +] — 누르면 새신자·방문 창이 그 칸 자리로 열린다 */
function NoteTile({
  section,
  label,
  count,
  onOpen,
}: {
  section: NoteSection
  label: string
  count: number
  onOpen: (section: NoteSection) => void
}) {
  const t = TILE[section]
  return (
    <button
      type="button"
      onClick={() => onOpen(section)}
      aria-haspopup="dialog"
      className="flex h-[60px] min-w-0 items-center gap-2.5 rounded-2xl bg-surface pr-2.5 pl-3 text-left shadow-[var(--shadow-card)] transition hover:bg-hover active:scale-[0.98]"
    >
      {/* 아주 좁은 화면에서는 숫자가 잘리지 않게 아이콘을 뺀다 */}
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl max-[359px]:hidden ${t.chip}`}>
        <PersonIcon plus={t.plus} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-[12px] font-semibold text-ink-2">{label}</span>
        <span className="tabular shrink-0 text-[17px] font-bold whitespace-nowrap text-ink">{count}명</span>
      </span>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-white">
        <Icon name="plus" size={16} strokeWidth={2.6} />
      </span>
    </button>
  )
}
