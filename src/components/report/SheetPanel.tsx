import { useState } from 'react'
import type { GroupWeek, WeekTotals } from '../../lib/compute'
import type { ISODate, WeekNote } from '../../lib/types'
import { cellStatusText, type SheetCell, type SheetData } from '../../lib/report'
import { useStore } from '../../store'
import { Card, Icon, Sheet, type IconName } from '../ui'
import { ActionTile } from './ActionTile'
import { SheetTable } from './SheetTable'
import { ServiceCounts, ServiceLegend } from './ServiceBits'
import type { PrintLayout } from './PrintView'

type Busy = 'docx' | 'xlsx' | null

/** 출석부 표: 엑셀 모양 표 + Word/엑셀 받기 + 인쇄 */
export function SheetPanel({
  date,
  week,
  totals,
  note,
  sheet,
  onPrint,
}: {
  date: ISODate
  week: GroupWeek[]
  totals: WeekTotals
  note: WeekNote | undefined
  sheet: SheetData
  onPrint: (layout: PrintLayout) => void
}) {
  const toast = useStore((s) => s.toast)
  const [busy, setBusy] = useState<Busy>(null)
  const [printOpen, setPrintOpen] = useState(false)

  async function download(kind: 'docx' | 'xlsx') {
    if (busy) return
    setBusy(kind)
    try {
      if (kind === 'docx') {
        const { exportDocx } = await import('../../lib/exportDocx')
        await exportDocx(date, week, totals, note)
        toast('Word 파일을 만들었어요', 'success')
      } else {
        const { exportXlsx } = await import('../../lib/exportXlsx')
        await exportXlsx(date, week, totals, note)
        toast('엑셀 파일을 만들었어요', 'success')
      }
    } catch (e) {
      console.error(e)
      toast('파일을 만들지 못했어요. 잠시 뒤 다시 해 주세요.', 'error')
    } finally {
      setBusy(null)
    }
  }

  function onCellClick(c: SheetCell) {
    const s = cellStatusText(c)
    toast(c.reason ? `${c.name} · ${s} (${c.reason})` : `${c.name} · ${s}`)
  }

  return (
    <div>
      {/* 받기·인쇄 */}
      <div className="mb-3 grid grid-cols-3 gap-2">
        <ActionTile icon="word" label="Word로 받기" loading={busy === 'docx'} disabled={!!busy} onClick={() => download('docx')} />
        <ActionTile icon="sheet" label="엑셀로 받기" loading={busy === 'xlsx'} disabled={!!busy} onClick={() => download('xlsx')} />
        <ActionTile icon="print" label="인쇄 / PDF" onClick={() => setPrintOpen(true)} />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-5 pt-5 pb-3">
          <h2 className="text-[17px] font-extrabold tracking-tight">{sheet.title}</h2>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <p className="tabular text-[13px] text-ink-3">
              목장원 {sheet.memberPresent}/{sheet.memberTotal}명 · 총 출석 <b className="text-ink">{sheet.grandTotal}명</b>
            </p>
            <ServiceCounts service1={sheet.memberService1} service2={sheet.memberService2} unit="명" />
          </div>
        </div>
        {/*
          표만 옆으로 민다.
          - w-0 min-w-full: 넓은 표가 화면 전체 폭을 밀어내지 않게 (PC 왼쪽 메뉴 옆에서 페이지가 옆으로 밀리던 문제)
          - 여백(px)은 스크롤 안쪽에 둔다: 바깥에 두면 고정된 '목장명' 칸 왼쪽 틈으로 밀린 이름이 비쳐 보인다
          - 표 최소 폭: 휴대폰 680px, PC 660px (PC 본문 폭 안에 옆 스크롤 없이 들어가게)
        */}
        <div className="w-0 min-w-full overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]">
          <div className="min-w-[720px] px-5 pb-4 md:min-w-[700px]">
            <SheetTable sheet={sheet} variant="screen" onCellClick={onCellClick} />
          </div>
        </div>
        <Legend />
      </Card>
      <p className="mt-2 px-1 text-[13px] text-ink-3 md:hidden">표를 옆으로 밀어서 볼 수 있어요. 이름을 누르면 사유가 보여요.</p>

      <PrintSheet
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        week={week}
        onPick={(layout) => {
          setPrintOpen(false)
          onPrint(layout)
        }}
      />
    </div>
  )
}

function Legend() {
  const items: { key: Exclude<SheetCell['status'], 'present'>; label: string; cls: string }[] = [
    { key: 'away', label: '타지역', cls: 'bg-away-soft ring-1 ring-away/40' },
    { key: 'nocontact', label: '연락두절', cls: 'bg-nocontact-soft ring-1 ring-nocontact/40' },
    { key: 'other', label: '기타', cls: 'bg-other-soft ring-1 ring-other/40' },
    { key: 'unchecked', label: '미확인', cls: 'bg-surface ring-1 ring-line' },
  ]
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line px-5 py-3 text-[13px] text-ink-3">
      <ServiceLegend className="font-semibold text-ink-2" />
      <span className="h-3 w-px bg-line" aria-hidden="true" />
      {items.map((it) => (
        <span key={it.key} className="inline-flex items-center gap-1.5">
          <span className={`h-3 w-3 rounded-[4px] ${it.cls}`} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

/** 인쇄 고르기: 전체 / 목장별로 한 장씩 / 한 목장만 */
function PrintSheet({
  open,
  onClose,
  week,
  onPick,
}: {
  open: boolean
  onClose: () => void
  week: GroupWeek[]
  onPick: (layout: PrintLayout) => void
}) {
  const groups = week.filter((gw) => gw.entries.length > 0)
  return (
    <Sheet open={open} onClose={onClose} title="인쇄 / PDF로 저장">
      <p className="mb-4 text-[14px] leading-relaxed text-ink-3">
        인쇄 창에서 프린터 대신 <b className="text-ink-2">‘PDF로 저장’</b>을 고르면 PDF 파일로 받을 수 있어요.
      </p>
      <div className="flex flex-col gap-2">
        <PrintOption
          icon="sheet"
          title="전체 출석부"
          desc={'모든 목장을 A4 가로 한 장에'}
          onClick={() => onPick({ kind: 'all' })}
        />
        <PrintOption
          icon="doc"
          title="목장별로 한 장씩"
          desc={'목장마다 표와 결석 사유를 한 장씩 (A4 세로)'}
          onClick={() => onPick({ kind: 'groups', groupIds: groups.map((g) => g.group.id) })}
        />
      </div>
      {groups.length > 0 && (
        <>
          <p className="mt-5 mb-2 text-[13px] font-semibold text-ink-2">한 목장만 인쇄</p>
          <div className="flex flex-wrap gap-2">
            {groups.map((gw) => (
              <button
                key={gw.group.id}
                type="button"
                onClick={() => onPick({ kind: 'groups', groupIds: [gw.group.id] })}
                className="h-11 rounded-2xl border border-line bg-surface px-4 text-[14px] font-semibold text-ink-2 transition hover:border-ink hover:text-ink"
              >
                {gw.group.name}
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  )
}

function PrintOption({ icon, title, desc, onClick }: { icon: IconName; title: string; desc: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 text-left transition hover:border-ink active:bg-[#f6f6f3]"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-present-soft text-present-ink">
        <Icon name={icon} size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold text-ink">{title}</span>
        <span className="block text-[13px] text-ink-3">{desc}</span>
      </span>
      <Icon name="print" size={18} className="text-ink-3" />
    </button>
  )
}
