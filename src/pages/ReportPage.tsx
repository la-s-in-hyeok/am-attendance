import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useWeek } from '../hooks'
import { buildAbsenceReport, buildSheet } from '../lib/report'
import { PageHeader, Segmented, WeekSwitcher } from '../components/ui'
import { AttendSectionTabs } from '../components/AttendSectionTabs'
import { AbsencePanel } from '../components/report/AbsencePanel'
import { SheetPanel } from '../components/report/SheetPanel'
import { PrintView, type PrintJob, type PrintLayout } from '../components/report/PrintView'
import { isAndroid } from '../lib/push'
import { useStore } from '../store'

type View = 'sheet' | 'absence'

/** 마지막으로 본 보기 (이 기기에만 기억) */
const VIEW_KEY = 'am-attendance:report-view'

/** 처음에는 출석부 표. 이 기기에서 마지막으로 고른 보기가 있으면 그것 */
function initialView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'absence' ? 'absence' : 'sheet'
  } catch {
    return 'sheet'
  }
}

function saveView(v: View) {
  try {
    localStorage.setItem(VIEW_KEY, v)
  } catch {
    /* 저장이 막혀 있으면 기억만 못 한다 */
  }
}

export function ReportPage() {
  const { date, week, totals, note } = useWeek()
  const [view, setView] = useState<View>(initialView)
  const [job, setJob] = useState<PrintJob | null>(null)

  const sheet = useMemo(() => buildSheet(date, week, totals, note), [date, week, totals, note])
  const absence = useMemo(() => buildAbsenceReport(date, week), [date, week])

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
  const chooseView = useCallback((v: View) => {
    setView(v)
    saveView(v)
  }, [])

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
        <PageHeader title="출석보고" nav={<AttendSectionTabs />}>
          <WeekSwitcher />
        </PageHeader>

        <Segmented
          className="mb-3 w-full"
          value={view}
          onChange={chooseView}
          options={[
            { value: 'sheet', label: '출석부 표' },
            { value: 'absence', label: '결석 심방보고' },
          ]}
        />

        {view === 'absence' ? (
          <AbsencePanel
            date={date}
            week={week}
            totals={totals}
            note={note}
            report={absence}
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
