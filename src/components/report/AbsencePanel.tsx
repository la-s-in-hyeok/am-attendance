import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { GroupWeek, WeekTotals } from '../../lib/compute'
import type { GroupDayState, ISODate, WeekNote } from '../../lib/types'
import { allReportText, groupReportText, type AbsenceReport } from '../../lib/report'
import { groupDayKey, useStore } from '../../store'
import { Card, Empty } from '../ui'
import { ActionTile } from './ActionTile'
import { CopyButton, ShareButton } from './CopyShareButtons'
import { GroupReportSheet } from './GroupReportSheet'
import { StatusGrid } from './StatusGrid'
import { canShare } from './share'
import { useCopyShare } from './useCopyShare'
import type { PrintLayout } from './PrintView'

type Busy = 'xlsx' | 'docx' | null

/** 지금 '뒤로 가기' 기록 맨 위가 바텀시트 기록인지 */
const onSheetEntry = () => (history.state as { amSheet?: number } | null)?.amSheet !== undefined

/**
 * 목장심방 현황: 목장별로 출석자 / 결석자 / 기타(사유: 타지역·연락두절·기타)
 * - 엑셀·Word 받기, 인쇄(PDF) — 항상 전체 목장
 * - 목장 칸: 출석체크 완료했는지 한눈에. 누르면 그 목장 보고 (글 복사·공유, 체크하러 가기)
 * - 글 복사하기 — 전체 보고 글을 임원 단톡방에 붙여 넣기
 */
export function AbsencePanel({
  date,
  week,
  totals,
  note,
  report,
  onPrint,
}: {
  date: ISODate
  week: GroupWeek[]
  totals: WeekTotals
  note: WeekNote | undefined
  report: AbsenceReport
  onPrint: (layout: PrintLayout) => void
}) {
  const toast = useStore((s) => s.toast)
  const setTab = useStore((s) => s.setTab)
  const openGroup = useStore((s) => s.openGroup)
  const groupDays = useStore((s) => s.groupDays)
  const [busy, setBusy] = useState<Busy>(null)
  /** 바텀시트로 연 목장 */
  const [openId, setOpenId] = useState<string | null>(null)

  const groups = report.groups
  const opened = openId ? (groups.find((g) => g.group.id === openId) ?? null) : null
  // 연 목장이 이 주일 출석부에서 빠지면 닫는다
  useEffect(() => {
    if (openId && !opened) setOpenId(null)
  }, [openId, opened])

  const stateOf = (groupId: string): GroupDayState | undefined => groupDays[groupDayKey(date, groupId)]?.state

  const text = useMemo(() => allReportText(date, week, totals, note), [date, week, totals, note])
  const groupText = useMemo(() => {
    const gw = openId ? week.find((w) => w.group.id === openId) : undefined
    return gw ? groupReportText(date, gw) : ''
  }, [openId, date, week])
  const { copied, copy, share } = useCopyShare(text)

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

  // 기다리는 사이 다른 탭으로 가 버리면(이 화면이 사라지면) 나중에 출석 탭이 저절로 열리지 않게 치운다
  const cancelCheck = useRef<(() => void) | null>(null)
  useEffect(() => () => cancelCheck.current?.(), [])

  /**
   * 출석 탭에서 그 목장을 연다.
   * 바텀시트를 먼저 닫고, 시트가 쌓아 둔 '뒤로 가기' 기록이 치워진 뒤에 연다.
   * 바로 열면 그 기록이 목장 화면 아래에 남아서 '뒤로'를 한 번 더 눌러야 해요.
   * 느린 휴대폰에서는 기록이 늦게 치워지므로 1.2초까지 기다리고,
   * 그때도 시트 기록이 남아 있으면 '뒤로'가 끝나기(popstate)를 한 번 더 기다린다
   */
  function goCheck(groupId: string) {
    cancelCheck.current?.()
    flushSync(() => setOpenId(null))
    const go = () => {
      setTab('attend')
      openGroup(groupId)
    }
    if (!onSheetEntry()) return go()
    let timer = 0
    const finish = () => {
      window.removeEventListener('popstate', finish)
      window.clearTimeout(timer)
      go()
    }
    window.addEventListener('popstate', finish)
    cancelCheck.current = () => {
      window.removeEventListener('popstate', finish)
      window.clearTimeout(timer)
    }
    timer = window.setTimeout(() => {
      if (!onSheetEntry()) return finish()
      // 끝내 popstate 가 안 오면 조금 더 기다렸다가 그냥 연다
      timer = window.setTimeout(finish, 2000)
    }, 1200)
  }

  if (groups.length === 0) {
    return (
      <Card>
        <Empty title="아직 목장원이 없어요">관리 탭에서 명단을 넣어 주세요</Empty>
      </Card>
    )
  }

  return (
    <div>
      {/* 받기·인쇄 (전체 목장) */}
      <div className="mb-4 grid grid-cols-3 gap-2">
        <ActionTile icon="sheet" label="엑셀" title="엑셀로 받기" loading={busy === 'xlsx'} disabled={!!busy} onClick={() => download('xlsx')} />
        <ActionTile icon="word" label="Word" title="Word로 받기" loading={busy === 'docx'} disabled={!!busy} onClick={() => download('docx')} />
        <ActionTile icon="print" label="인쇄·PDF" title="인쇄 또는 PDF로 저장" onClick={() => onPrint({ kind: 'absence' })} />
      </div>

      {/* 목장별 완료 현황 + 결석 합계 */}
      <StatusGrid report={report} stateOf={stateOf} onOpen={setOpenId} />

      <GroupReportSheet
        g={opened}
        state={opened ? stateOf(opened.group.id) : undefined}
        text={groupText}
        onClose={() => setOpenId(null)}
        onCheck={goCheck}
      />

      {/*
        글 복사·공유
        - 휴대폰: 아래 탭 바로 위에 화면 폭 가득한 띠 (양옆 여백은 본문 여백만큼 밖으로)
        - PC: 띠 없이 오른쪽 아래에 알맞은 크기로
      */}
      <div className="kb-hide sticky bottom-[calc(65px+env(safe-area-inset-bottom))] z-10 mt-4 mr-[calc(-1*max(1rem,env(safe-area-inset-right)))] ml-[calc(-1*max(1rem,env(safe-area-inset-left)))] flex gap-2.5 border-t border-line bg-bg/95 py-3 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] backdrop-blur-xl md:pointer-events-none md:bottom-6 md:mx-0 md:justify-end md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        <CopyButton
          copied={copied}
          className="pointer-events-auto flex-1 md:min-w-64 md:flex-none"
          onClick={() => void copy()}
          title="전체 보고 글 복사"
        />
        {canShare() && <ShareButton className="pointer-events-auto md:shadow-[var(--shadow-card)]" onClick={() => void share()} />}
      </div>
    </div>
  )
}
