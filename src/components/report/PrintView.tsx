import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { GroupWeek } from '../../lib/compute'
import type { ISODate } from '../../lib/types'
import { labelFull } from '../../lib/dates'
import { groupReport, groupReportLines, serviceSplitText, type AbsenceReport, type ReportLine, type SheetData } from '../../lib/report'
import { AbsencePrint } from './AbsencePrint'
import { SheetTable } from './SheetTable'
import { ServiceLegend, ServiceSwatch } from './ServiceBits'

/** 무엇을 인쇄할지: 전체 출석부 / 목장별 출석부 / 결석 심방보고 */
export type PrintLayout = { kind: 'all' } | { kind: 'groups'; groupIds: string[] } | { kind: 'absence' }

export interface PrintJob {
  layout: PrintLayout
  /** true 면 그리자마자 인쇄 창을 연다 (false = 브라우저 메뉴로 인쇄한 경우) */
  auto: boolean
}

/**
 * 인쇄 전용 화면. body 바로 아래에 그려서 앱의 폭 제한(max-w)과 상관없이 A4 를 꽉 채운다.
 * 인쇄할 때는 앱(#root)을 숨기고 이것만 보인다.
 */
export function PrintView({
  job,
  date,
  sheet,
  week,
  absence,
  onDone,
}: {
  job: PrintJob | null
  date: ISODate
  sheet: SheetData
  week: GroupWeek[]
  absence: AbsenceReport
  onDone: () => void
}) {
  useEffect(() => {
    if (!job) return
    const after = () => onDone()
    window.addEventListener('afterprint', after)
    // 화면에 다 그려진 뒤 인쇄 창 열기
    const timer = job.auto ? window.setTimeout(() => window.print(), 120) : undefined
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('afterprint', after)
    }
  }, [job, onDone])

  if (!job) return null

  const landscape = job.layout.kind !== 'groups'
  const css = `
@media print {
  @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: ${landscape ? '9mm 10mm' : '12mm'}; }
  html, body { background: #fff !important; height: auto !important; }
  #root { display: none !important; }
}`

  return createPortal(
    <div className="print-only bg-white px-[0.4mm] text-black" style={{ fontFamily: "'Malgun Gothic', '맑은 고딕', var(--font-sans)" }}>
      <style>{css}</style>
      {job.layout.kind === 'all' ? (
        <AllSheet sheet={sheet} date={date} />
      ) : job.layout.kind === 'absence' ? (
        <AbsencePrint report={absence} date={date} />
      ) : (
        <GroupPages groupIds={job.layout.groupIds} sheet={sheet} week={week} date={date} />
      )}
    </div>,
    document.body,
  )
}

function AllSheet({ sheet, date }: { sheet: SheetData; date: ISODate }) {
  return (
    <div>
      <SheetTable sheet={sheet} variant="print" title={sheet.title} />
      <div className="mt-[2.5mm] flex items-center justify-between gap-[4mm] text-[8pt] text-[#444]">
        <span className="inline-flex flex-wrap items-center gap-x-[3mm]">
          <ServiceLegend variant="print" className="font-semibold text-black" />
          <span>
            {`목장원 ${sheet.memberPresent}/${sheet.memberTotal}명 출석 (${serviceSplitText({ service1: sheet.memberService1, service2: sheet.memberService2 }, '명')})`}
          </span>
        </span>
        <span className="shrink-0">{labelFull(date)} · AM청년회 출석부</span>
      </div>
    </div>
  )
}

function GroupPages({ groupIds, sheet, week, date }: { groupIds: string[]; sheet: SheetData; week: GroupWeek[]; date: ISODate }) {
  const ids = new Set(groupIds)
  const pages = week
    .map((gw, i) => ({ gw, block: sheet.blocks[i] }))
    .filter(({ gw }) => ids.has(gw.group.id))
  return (
    <>
      {pages.map(({ gw, block }, i) => {
        const r = groupReport(date, gw)
        const c = gw.summary
        return (
          <section key={gw.group.id} className={i < pages.length - 1 ? 'print-break' : ''}>
            <div className="mb-[4mm] flex items-end justify-between border-b-2 border-black pb-[2mm]">
              <div>
                <p className="text-[9pt] text-[#444]">{labelFull(date)}</p>
                <h1 className="text-[18pt] leading-tight font-extrabold">{gw.group.name} 목장</h1>
              </div>
              <div className="text-right text-[10pt]">
                <p>
                  총원 <b>{c.total}</b>명 · 출석 <b>{c.present}</b>명
                </p>
                <p className="text-[8.5pt] text-[#444]">{serviceSplitText(c, '명')}</p>
              </div>
            </div>

            <SheetTable sheet={sheet} blocks={[block]} variant="print" title={`${sheet.title} · ${gw.group.name}`} showFooter={false} />
            <ServiceLegend variant="print" className="mt-[1.8mm] text-[8pt] text-[#444]" />

            <div className="mt-[7mm]">
              <h2 className="mb-[2.5mm] text-[12pt] font-extrabold">{r.heading}</h2>
              <div className="space-y-[1.6mm] text-[10.5pt] leading-[1.55]">
                {groupReportLines(r).map((l, k) => (
                  <PrintLine key={k} l={l} />
                ))}
              </div>
              <p className="mt-[5mm] text-[9pt] text-[#444]">
                타지역 {c.away}명 · 연락두절 {c.nocontact}명 · 기타 {c.other}명{c.unchecked ? ` · 미확인 ${c.unchecked}명` : ''}
              </p>
            </div>
          </section>
        )
      })}
    </>
  )
}

/** 보고 글 한 줄 (1부·2부 줄은 들여 쓰고 예배 색 네모를 붙인다) */
function PrintLine({ l }: { l: ReportLine }) {
  const indent = l.service || l.label.startsWith('*')
  return (
    <p className={indent ? 'pl-[3mm]' : ''}>
      {l.service && <ServiceSwatch service={l.service} variant="print" className="mr-[1.5mm] h-[3mm] w-[3mm] translate-y-[0.4mm] outline outline-[0.2mm] outline-black/50" />}
      <b>{l.label}</b>
      {l.value !== null && (l.value ? ` : ${l.value}` : ' :')}
    </p>
  )
}
