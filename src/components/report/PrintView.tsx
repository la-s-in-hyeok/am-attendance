import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ISODate } from '../../lib/types'
import { labelFull } from '../../lib/dates'
import { absenceTitle, fileStamp, serviceSplitText, type AbsenceReport, type SheetData } from '../../lib/report'
import { AbsencePrint } from './AbsencePrint'
import { SheetTable } from './SheetTable'
import { ServiceLegend } from './ServiceBits'

/** 무엇을 인쇄할지: 전체 출석부 / 목장심방 현황 (둘 다 A4 가로) */
export type PrintLayout = { kind: 'all' } | { kind: 'absence' }

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
  absence,
  onDone,
}: {
  job: PrintJob | null
  date: ISODate
  sheet: SheetData
  absence: AbsenceReport
  onDone: () => void
}) {
  // 인쇄 중에 출석 내용이 새로 와도 인쇄 창을 다시 열지 않도록, 날짜는 효과의 조건에 넣지 않고 따로 들고 있는다
  const dateRef = useRef(date)
  useEffect(() => {
    dateRef.current = date
  })
  useEffect(() => {
    if (!job) return
    const after = () => onDone()
    window.addEventListener('afterprint', after)
    // 'PDF로 저장' 파일 이름은 페이지 제목을 따라가요: 종류와 날짜를 넣어 둔다 (인쇄가 끝나면 원래대로)
    const prevTitle = document.title
    if (job.auto) document.title = printTitle(job.layout, dateRef.current)
    // 화면에 다 그려진 뒤 인쇄 창 열기
    const timer = job.auto ? window.setTimeout(() => window.print(), 120) : undefined
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('afterprint', after)
      document.title = prevTitle
    }
  }, [job, onDone])

  if (!job) return null

  const css = `
@media print {
  @page { size: A4 landscape; margin: 9mm 10mm; }
  html, body { background: #fff !important; height: auto !important; }
  #root { display: none !important; }
}`

  return createPortal(
    <div className="print-only bg-white px-[0.4mm] text-black" style={{ fontFamily: "'Malgun Gothic', '맑은 고딕', var(--font-sans)" }}>
      <style>{css}</style>
      {job.layout.kind === 'all' ? <AllSheet sheet={sheet} date={date} /> : <AbsencePrint report={absence} date={date} />}
    </div>,
    document.body,
  )
}

/** 'AM청년회 출석부 2026.11.15', 'AM청년회 목장심방 현황 (26.11.15)' */
function printTitle(layout: PrintLayout, date: ISODate): string {
  return layout.kind === 'absence' ? absenceTitle(date) : `AM청년회 출석부 ${fileStamp(date)}`
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
