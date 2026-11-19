import { useEffect, useMemo, useState } from 'react'
import type { GroupWeek, WeekTotals } from '../../lib/compute'
import type { ISODate, WeekNote } from '../../lib/types'
import {
  ABSENCE_CATEGORIES,
  ABSENCE_LABEL,
  allReportText,
  groupReportText,
  presentOfTotal,
  serviceSplitText,
  type AbsenceCategory,
  type AbsenceGroup,
  type AbsencePerson,
  type AbsenceReport,
} from '../../lib/report'
import { useStore } from '../../store'
import { Button, Card, Empty, Icon, STATUS_STYLE } from '../ui'
import { ActionTile } from './ActionTile'
import { ServiceCounts } from './ServiceBits'
import { canShare, copyText, shareText } from './share'
import type { PrintLayout } from './PrintView'

export const ALL = 'all'

type Busy = 'xlsx' | 'docx' | null

/**
 * 결석 심방보고: 목장별로 타지 / 기타(사유) / 연락두절
 * - 엑셀·Word 받기, 인쇄(PDF) — 항상 전체 목장
 * - 글 복사하기 — 고른 목장(또는 전체)의 보고 글을 임원 단톡방에 붙여 넣기
 */
export function AbsencePanel({
  date,
  week,
  totals,
  note,
  report,
  scope,
  onScope,
  onPrint,
}: {
  date: ISODate
  week: GroupWeek[]
  totals: WeekTotals
  note: WeekNote | undefined
  report: AbsenceReport
  scope: string
  onScope: (s: string) => void
  onPrint: (layout: PrintLayout) => void
}) {
  const toast = useStore((s) => s.toast)
  const setTab = useStore((s) => s.setTab)
  const openGroup = useStore((s) => s.openGroup)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)

  const groups = report.groups
  const selected = scope === ALL ? null : (groups.find((g) => g.group.id === scope) ?? null)
  // 고른 목장이 이 주일 출석부에 없으면 전체로
  useEffect(() => {
    if (scope !== ALL && !selected) onScope(ALL)
  }, [scope, selected, onScope])

  const text = useMemo(() => {
    if (!selected) return allReportText(date, week, totals, note)
    const gw = week.find((w) => w.group.id === selected.group.id)
    return gw ? groupReportText(date, gw) : ''
  }, [selected, date, week, totals, note])

  const counts = selected ? selected.summary : report.totals
  const nothingYet = counts.total > 0 && counts.unchecked === counts.total

  useEffect(() => setCopied(false), [text])

  async function onCopy() {
    if (await copyText(text)) {
      setCopied(true)
      toast('복사했어요. 단톡방에 붙여 넣으세요', 'success')
      window.setTimeout(() => setCopied(false), 2500)
    } else {
      toast('복사하지 못했어요. 다시 눌러 주세요.', 'error')
    }
  }

  async function onShare() {
    const r = await shareText(text)
    if (r === 'failed') toast('공유하지 못했어요. 글 복사하기를 눌러 주세요.', 'error')
  }

  async function download(kind: 'xlsx' | 'docx') {
    if (busy) return
    setBusy(kind)
    try {
      if (kind === 'xlsx') {
        const { exportAbsenceXlsx } = await import('../../lib/exportAbsenceXlsx')
        await exportAbsenceXlsx(report)
        toast('엑셀 파일을 만들었어요', 'success')
      } else {
        const { exportAbsenceDocx } = await import('../../lib/exportAbsenceDocx')
        await exportAbsenceDocx(report)
        toast('Word 파일을 만들었어요', 'success')
      }
    } catch (e) {
      console.error(e)
      toast('파일을 만들지 못했어요. 잠시 뒤 다시 해 주세요.', 'error')
    } finally {
      setBusy(null)
    }
  }

  function goCheck() {
    setTab('attend')
    openGroup(selected ? selected.group.id : null)
  }

  if (groups.length === 0) {
    return (
      <Card>
        <Empty title="아직 목장원이 없어요">관리 탭에서 명단을 넣어 주세요</Empty>
      </Card>
    )
  }

  const shown = selected ? [selected] : groups

  return (
    <div>
      {/* 받기·인쇄 (전체 목장) */}
      <div className="mb-4 grid grid-cols-3 gap-2">
        <ActionTile icon="sheet" label="엑셀로 받기" loading={busy === 'xlsx'} disabled={!!busy} onClick={() => download('xlsx')} />
        <ActionTile icon="word" label="Word로 받기" loading={busy === 'docx'} disabled={!!busy} onClick={() => download('docx')} />
        <ActionTile icon="print" label="인쇄 / PDF" onClick={() => onPrint({ kind: 'absence' })} />
      </div>

      {/* 전체 / 목장 고르기 */}
      <div className="mb-3 flex flex-wrap gap-2" role="radiogroup" aria-label="볼 목장">
        <ScopeChip
          active={scope === ALL}
          onClick={() => onScope(ALL)}
          label="전체"
          sub={presentOfTotal(report.totals)}
          hint={`출석 ${report.totals.present}명 (${serviceSplitText(report.totals, '명')})`}
        />
        {groups.map((g) => (
          <ScopeChip
            key={g.group.id}
            active={scope === g.group.id}
            onClick={() => onScope(g.group.id)}
            label={g.group.name}
            sub={presentOfTotal(g.summary)}
            hint={`출석 ${g.summary.present}명 (${serviceSplitText(g.summary, '명')})`}
            dot={g.summary.unchecked > 0}
          />
        ))}
      </div>

      {counts.unchecked > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-2xl bg-present-soft px-4 py-3">
          <p className="min-w-0 flex-1 text-[14px] leading-snug text-present-ink">
            {nothingYet ? (
              <>아직 출석 체크를 하지 않았어요.</>
            ) : (
              <>
                아직 확인 안 한 사람이 <b>{counts.unchecked}명</b> 있어요.
              </>
            )}
          </p>
          <button
            type="button"
            onClick={goCheck}
            className="inline-flex h-11 shrink-0 items-center gap-0.5 rounded-xl bg-surface px-3 text-[13px] font-bold text-ink shadow-sm"
          >
            체크하러 가기
            <Icon name="chevronRight" size={15} />
          </button>
        </div>
      )}

      {!selected && <CategoryTotals report={report} />}

      <div className="flex flex-col gap-3">
        {shown.map((g) => (
          <GroupCard key={g.group.id} g={g} />
        ))}
      </div>

      {/* 글 복사·공유 (휴대폰: 아래 탭 바로 위에 꽉 차게, PC: 오른쪽 아래에 알맞은 크기로) */}
      <div className="kb-hide pointer-events-none sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-10 mt-3 flex gap-2 md:bottom-6 md:justify-end">
        <Button
          variant="yellow"
          size="lg"
          icon={copied ? 'check' : 'copy'}
          className="pointer-events-auto flex-1 shadow-[var(--shadow-pop)] md:min-w-64 md:flex-none"
          onClick={onCopy}
          title={selected ? `${selected.group.name} 목장 보고 글 복사` : '전체 보고 글 복사'}
        >
          {copied ? '복사했어요' : '글 복사하기'}
        </Button>
        {canShare() && (
          <Button variant="secondary" size="lg" icon="share" className="pointer-events-auto shadow-[var(--shadow-card)]" onClick={onShare}>
            공유
          </Button>
        )}
      </div>
    </div>
  )
}

/* ───────────── 전체 합계 ───────────── */

function CategoryTotals({ report }: { report: AbsenceReport }) {
  return (
    <div className="mb-3 grid grid-cols-3 gap-2">
      {ABSENCE_CATEGORIES.map((c) => {
        const st = STATUS_STYLE[c]
        const n = report.totals[c]
        return (
          <div key={c} className={`rounded-2xl px-3.5 py-3 ${st.soft}`}>
            <p className={`text-[13px] font-bold ${st.ink}`}>{ABSENCE_LABEL[c]}</p>
            <p className="tabular mt-0.5 text-[24px] leading-tight font-extrabold text-ink">
              {n}
              <span className="ml-0.5 text-[13px] font-semibold text-ink-3">명</span>
            </p>
          </div>
        )
      })}
    </div>
  )
}

/* ───────────── 목장 카드 ───────────── */

/**
 * 카드 폭(@container)에 맞춰 바뀐다: 좁으면(휴대폰·태블릿) 줄마다 한 칸, 넓으면(PC) 세 칸 나란히.
 * 화면 폭(md)이 아니라 카드 폭을 보므로, 왼쪽 메뉴 때문에 좁아진 태블릿에서도 칸이 비좁아지지 않는다.
 */
function GroupCard({ g }: { g: AbsenceGroup }) {
  const s = g.summary
  return (
    <Card className="@container p-4 md:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <h3 className="min-w-0 text-[17px] font-extrabold tracking-tight break-words">{g.group.name}</h3>
        <span className="tabular text-[13px] font-medium text-ink-3">출석 {presentOfTotal(s)}</span>
        <ServiceCounts service1={s.service1} service2={s.service2} className="ml-auto" />
      </div>
      <div className="flex flex-col divide-y divide-line @xl:grid @xl:grid-cols-3 @xl:gap-2 @xl:divide-y-0">
        {ABSENCE_CATEGORIES.map((c) => (
          <CategoryRow key={c} category={c} people={g[c]} />
        ))}
        {g.unchecked.length > 0 && <CategoryRow category="unchecked" people={g.unchecked} />}
      </div>
    </Card>
  )
}

/** 한 칸: [타지 2]  최지훈 안산 · 정하나 (좁은 카드: 옆으로, 넓은 카드: 세 칸 나란히) */
function CategoryRow({ category, people }: { category: AbsenceCategory | 'unchecked'; people: AbsencePerson[] }) {
  const st = STATUS_STYLE[category]
  const label = category === 'unchecked' ? '미확인' : ABSENCE_LABEL[category]
  const n = people.length
  const unchecked = category === 'unchecked'
  return (
    <div
      className={`flex items-start gap-3 py-2.5 first:pt-0 last:pb-0 @xl:rounded-2xl @xl:bg-bg @xl:p-3 @xl:first:pt-3 @xl:last:pb-3 ${
        unchecked ? '@xl:col-span-3' : '@xl:flex-col @xl:gap-2'
      }`}
    >
      <span
        className={`tabular inline-flex h-7 w-[96px] shrink-0 items-center justify-between gap-1.5 rounded-full px-2.5 text-[13px] font-bold @xl:w-auto @xl:justify-start ${st.soft} ${st.ink} ${
          n === 0 ? 'opacity-55' : ''
        }`}
      >
        {label}
        <span>{n}</span>
      </span>
      {n === 0 ? (
        <span className="pt-[3px] text-[14px] text-ink-3/80">없음</span>
      ) : (
        // 미확인 줄은 넓은 카드에서도 옆으로 놓이므로 남은 폭(flex-1) 안에서 줄바꿈해야 카드 밖으로 넘치지 않는다
        <ul className={`flex min-w-0 flex-1 flex-wrap content-start items-start gap-1.5 ${unchecked ? '' : '@xl:w-full @xl:flex-none'}`}>
          {people.map((p) => (
            <li
              key={p.memberId}
              className="inline-flex max-w-full items-baseline gap-1 rounded-lg bg-bg px-2 py-1 text-[14px] leading-snug @xl:bg-surface"
            >
              <span className="shrink-0 font-semibold text-ink">{p.name}</span>
              {p.memo && <span className="min-w-0 text-[13px] break-words text-ink-3">{p.memo}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ScopeChip({
  active,
  onClick,
  label,
  sub,
  hint,
  dot,
}: {
  active: boolean
  onClick: () => void
  label: string
  sub: string
  /** 마우스를 올리면 보이는 1부·2부 인원 */
  hint?: string
  dot?: boolean
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      title={hint}
      onClick={onClick}
      className={`relative inline-flex h-11 items-center gap-1.5 rounded-2xl px-3.5 text-[14px] font-semibold transition ${
        active ? 'bg-ink text-white' : 'bg-surface text-ink-2 shadow-[var(--shadow-card)] hover:text-ink'
      }`}
    >
      {label}
      <span className={`tabular text-[13px] font-medium ${active ? 'text-white/60' : 'text-ink-3'}`}>{sub}</span>
      {dot && <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-danger" title="아직 확인 안 한 사람이 있어요" />}
    </button>
  )
}
