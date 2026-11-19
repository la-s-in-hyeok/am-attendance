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
import { isAndroid } from '../lib/push'
import { useStore } from '../store'

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

  const toast = useStore((s) => s.toast)
  const print = useCallback(
    (layout: PrintLayout) => {
      // 안드로이드 인쇄 창은 늘 세로로 열리고, 열리면 화면 전체를 덮어서 그 뒤에는 안내가 안 보여요.
      // 그래서 먼저 안내하고, '인쇄'를 누르면 연다
      if (isAndroid()) toast('인쇄 창 위쪽 ▼를 눌러 용지 방향을 ‘가로’로 바꿔 주세요', 'info', { label: '인쇄', run: () => setJob({ layout, auto: true }) })
      else setJob({ layout, auto: true })
    },
    [toast],
  )

  // 엑셀·Word 만드는 도구를 미리 받아 둔다. 처음 누를 때 받느라 몇 초 걸리면
  // 삼성 인터넷은 '누른 지 오래된 다운로드'로 보고 파일 저장을 조용히 막아요
  useEffect(() => {
    const t = setTimeout(() => {
      void import('../lib/exportXlsx').then((m) => m.loadExcel()).catch(() => undefined)
      void import('../lib/exportDocx').catch(() => undefined)
      void import('../lib/exportAbsenceXlsx').catch(() => undefined)
      void import('../lib/exportAbsenceDocx').catch(() => undefined)
    }, 1500)
    return () => clearTimeout(t)
  }, [])
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

      <PrintView job={job} date={date} sheet={sheet} absence={absence} onDone={endPrint} />
    </div>
  )
}
