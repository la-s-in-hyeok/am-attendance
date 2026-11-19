import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useWeek } from '../hooks'
import { pct, rate } from '../lib/compute'
import { buildAbsenceReport, buildSheet } from '../lib/report'
import { Card, PageHeader, Ring, Segmented, WeekSwitcher } from '../components/ui'
import { ALL, AbsencePanel } from '../components/report/AbsencePanel'
import { SheetPanel } from '../components/report/SheetPanel'
import { PrintView, type PrintJob, type PrintLayout } from '../components/report/PrintView'
import { ServiceCounts } from '../components/report/ServiceBits'

type View = 'absence' | 'sheet'

/** 휴대폰에서는 결석 심방보고, PC 에서는 출석부 표를 먼저 */
function initialView(): View {
  try {
    return window.matchMedia('(min-width: 768px)').matches ? 'sheet' : 'absence'
  } catch {
    return 'absence'
  }
}

export function ReportPage() {
  const { date, week, totals, note } = useWeek()
  const [view, setView] = useState<View>(initialView)
  const [scope, setScope] = useState<string>(ALL)
  const [job, setJob] = useState<PrintJob | null>(null)

  const sheet = useMemo(() => buildSheet(date, week, totals, note), [date, week, totals, note])
  const absence = useMemo(() => buildAbsenceReport(date, week), [date, week])
  const memberRate = rate(totals.present, totals.total)

  const print = useCallback((layout: PrintLayout) => setJob({ layout, auto: true }), [])
  const endPrint = useCallback(() => setJob(null), [])

  // 브라우저 메뉴(Ctrl+P)로 인쇄해도 보고 있는 탭의 표가 나오게
  const jobRef = useRef(job)
  const viewRef = useRef(view)
  useEffect(() => {
    jobRef.current = job
    viewRef.current = view
  }, [job, view])
  useEffect(() => {
    const before = () => {
      if (jobRef.current) return
      const layout: PrintLayout = viewRef.current === 'absence' ? { kind: 'absence' } : { kind: 'all' }
      flushSync(() => setJob({ layout, auto: false }))
    }
    window.addEventListener('beforeprint', before)
    return () => window.removeEventListener('beforeprint', before)
  }, [])

  return (
    <div>
      <div className="no-print">
        <PageHeader title="보고서" />

        <Card className="mb-4 px-2 pt-2 pb-4">
          <WeekSwitcher />
          <div className="mt-3 flex items-center gap-4 border-t border-line px-3 pt-4">
            <Ring value={memberRate ?? 0} size={58} stroke={6}>
              <span className="tabular text-[13px] font-extrabold">{pct(memberRate)}</span>
            </Ring>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink-3">총 출석</p>
              {/* 미확인은 숫자 옆에 두어 좁은 휴대폰에서도 아래 줄들이 한 줄에 들어가게 */}
              <div className="flex items-center justify-between gap-2">
                <p className="tabular text-[24px] leading-tight font-extrabold">{totals.grandTotal}명</p>
                {totals.unchecked > 0 && (
                  <span className="tabular shrink-0 rounded-full bg-[#f3f3ef] px-2.5 py-1 text-[13px] font-semibold text-ink-2">
                    미확인 {totals.unchecked}명
                  </span>
                )}
              </div>
              <p className="tabular text-[13px] leading-snug text-ink-3">
                목장원 {totals.present}/{totals.total}
                {totals.newcomers > 0 && ` · 새신자 ${totals.newcomers}`}
                {totals.visitors > 0 && ` · 방문 ${totals.visitors}`}
              </p>
              <ServiceCounts service1={totals.service1} service2={totals.service2} unit="명" className="mt-1.5" />
            </div>
          </div>
        </Card>

        <Segmented
          className="mb-4 w-full"
          value={view}
          onChange={setView}
          options={[
            { value: 'absence', label: '결석 심방보고' },
            { value: 'sheet', label: '출석부 표' },
          ]}
        />

        {view === 'absence' ? (
          <AbsencePanel
            date={date}
            week={week}
            totals={totals}
            note={note}
            report={absence}
            scope={scope}
            onScope={setScope}
            onPrint={print}
          />
        ) : (
          <SheetPanel date={date} week={week} totals={totals} note={note} sheet={sheet} onPrint={print} />
        )}
      </div>

      <PrintView job={job} date={date} sheet={sheet} week={week} absence={absence} onDone={endPrint} />
    </div>
  )
}
