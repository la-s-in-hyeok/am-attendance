import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { useActiveGroups } from '../hooks'
import { Button, Card, Confirm, Empty, Icon, PageHeader, WeekSwitcher } from '../components/ui'
import { mergeKey, useGroupReports, type MergePart, type MergeState } from '../components/groupReport/useGroupReports'
import { ReportTiles } from '../components/groupReport/ReportTiles'
import { GroupSheet } from '../components/groupReport/GroupSheet'
import { CloseBar, MergedBar } from '../components/groupReport/ReportBar'
import { PinSheet } from '../components/groupReport/PinSheet'
import { kstDateTime } from '../components/groupReport/format'

/** 목장보고서 탭: 이번 주 목장별 제출 현황 · 올리기 · 마감하고 한 PDF로 합치기 */
export function GroupReportPage() {
  const mode = useStore((s) => s.backend.mode)
  const date = useStore((s) => s.date)
  const allGroups = useStore((s) => s.groups)
  const setTab = useStore((s) => s.setTab)
  const groups = useActiveGroups()
  const week = useGroupReports((s) => s.weeks[date])
  const status = useGroupReports((s) => s.status[date])
  const error = useGroupReports((s) => (s.error?.date === date ? s.error : null))
  const merge = useGroupReports((s) => (s.merge?.date === date ? s.merge : null))
  const hasPin = useGroupReports((s) => s.hasPin)
  const [openId, setOpenId] = useState<string | null>(null)
  const [askReopen, setAskReopen] = useState(false)
  /** 마감 풀기 전에 담당 비밀번호 묻기 (아직 기억하지 않았을 때) */
  const [reopenPin, setReopenPin] = useState(false)

  // 화면이 보이는 동안: 실시간 알림 + 30초 새로고침
  useEffect(() => useGroupReports.getState().start(), [])
  // 보는 주일이 바뀌면 그 주 목록을 받아요
  useEffect(() => {
    void useGroupReports.getState().load(date)
  }, [date])

  const files = week?.files
  const fileMap = useMemo(() => new Map((files ?? []).map((f) => [f.groupId, f])), [files])
  const fileOf = useCallback((id: string) => fileMap.get(id), [fileMap])
  const closed = !!week?.closedAt

  // 합칠 순서 = 앱의 목장 순서 (보관한 목장의 보고서도 그 자리에)
  const parts = useMemo<MergePart[]>(() => {
    if (!files?.length) return []
    const sorted = [...allGroups].sort((a, b) => Number(a.archived) - Number(b.archived) || a.order - b.order)
    const out: MergePart[] = []
    const used = new Set<string>()
    for (const g of sorted) {
      const f = fileMap.get(g.id)
      if (!f) continue
      out.push({ groupId: f.groupId, label: g.name, stamp: f.uploadedAt })
      used.add(g.id)
    }
    for (const f of files) if (!used.has(f.groupId)) out.push({ groupId: f.groupId, label: '목장', stamp: f.uploadedAt })
    return out
  }, [files, fileMap, allGroups])

  // 마감된 주를 열면 미리 합쳐 둬요 (누르자마자 받을 수 있게). 담당 비밀번호를 기억하고 있을 때만
  const partsKey = mergeKey(parts)
  useEffect(() => {
    if (closed && hasPin && parts.length > 0) void useGroupReports.getState().prepareMerge(date, parts)
    // parts 는 partsKey 가 같으면 같은 내용이라 partsKey 만 봐요
  }, [closed, hasPin, date, partsKey])

  const submitted = groups.filter((g) => fileMap.has(g.id)).length
  const missing = groups.filter((g) => !fileMap.has(g.id))
  const openGroup = openId ? (allGroups.find((g) => g.id === openId) ?? null) : null
  const ready = status === 'ready' && !!week

  return (
    <div className="anim-fade">
      <PageHeader title="목장보고서" sub={mode === 'local' ? '체험 모드: 올린 파일은 이 기기에만 있어요' : undefined}>
        <WeekSwitcher noun="보고서" />
      </PageHeader>

      {error?.setup && (
        <div className="mb-3 rounded-[var(--radius-card)] border border-accent bg-accent-soft p-4" role="alert">
          <p className="font-bold text-accent-soft-ink">목장보고서를 쓰려면 서버 설정을 새로 해야 해요</p>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{error.message}</p>
        </div>
      )}
      {error && !error.setup && (
        <Card className="mb-3 flex items-center gap-3 p-4" role="alert">
          <p className="min-w-0 flex-1 text-[15px] font-semibold text-danger">{error.message}</p>
          <Button variant="secondary" size="sm" onClick={() => void useGroupReports.getState().load(date)}>
            다시 시도
          </Button>
        </Card>
      )}

      {groups.length === 0 ? (
        <Card>
          <Empty title="아직 목장이 없어요">
            관리 탭에서 목장을 먼저 추가해 주세요.
            <div className="mt-5">
              <Button icon="settings" onClick={() => setTab('manage')}>
                관리 탭으로 가기
              </Button>
            </div>
          </Empty>
        </Card>
      ) : !ready ? (
        status !== 'error' && <p className="py-10 text-center text-[14px] text-ink-3">보고서 목록을 불러오는 중…</p>
      ) : (
        <>
          <section aria-labelledby="gr-summary" className="space-y-2.5">
            <Summary
              submitted={submitted}
              total={groups.length}
              closedAt={week.closedAt}
              onReopen={() => (hasPin ? setAskReopen(true) : setReopenPin(true))}
            />
            <ReportTiles groups={groups} fileOf={fileOf} onOpen={setOpenId} />
          </section>
          {closed && hasPin && (
            <MergeNote merge={merge} count={parts.length} onRetry={() => void useGroupReports.getState().prepareMerge(date, parts, true)} />
          )}
          <p className="mt-3 flex items-start gap-1.5 px-1 text-[13px] leading-relaxed text-ink-3">
            <Icon name="lock" size={14} className="mt-[3px] shrink-0" />
            <span>
              보고서는 낸 사람(올린 휴대폰)만 열어 볼 수 있어요. 마감·합친 PDF는 보고서 담당만 할 수 있어요.
            </span>
          </p>
          {closed ? <MergedBar date={date} merge={merge} parts={parts} /> : <CloseBar date={date} groups={groups} missing={missing} submitted={parts.length} />}
        </>
      )}

      <GroupSheet
        date={date}
        group={openGroup}
        file={openGroup ? fileMap.get(openGroup.id) : undefined}
        closed={closed}
        onClose={() => setOpenId(null)}
      />
      <PinSheet
        open={reopenPin}
        title="마감 풀기"
        message="마감을 풀면 목장들이 다시 올리거나 지울 수 있어요. 보고서 담당 비밀번호를 넣어 주세요."
        confirmLabel="마감 풀기"
        onClose={() => setReopenPin(false)}
        onVerified={() => {
          setReopenPin(false)
          void useGroupReports
            .getState()
            .reopen(date)
            .then((ok) => ok && useStore.getState().toast('마감을 풀었어요', 'info'))
        }}
      />
      <Confirm
        open={askReopen}
        title="마감 풀기"
        message="마감을 풀면 목장들이 다시 올리거나 지울 수 있어요. 다 되면 다시 마감해 주세요."
        confirmLabel="마감 풀기"
        onClose={() => setAskReopen(false)}
        onConfirm={() => {
          void useGroupReports
            .getState()
            .reopen(date)
            .then((ok) => ok && useStore.getState().toast('마감을 풀었어요', 'info'))
        }}
      />
    </div>
  )
}

/** '제출 7 / 9' (+ 마감됐으면 '마감됨 · 11월 22일 오후 3:10' 과 작은 '마감 풀기') */
function Summary({ submitted, total, closedAt, onReopen }: { submitted: number; total: number; closedAt: string | null; onReopen: () => void }) {
  const when = kstDateTime(closedAt)
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-0.5">
      <h2 id="gr-summary" className="text-[16px] font-bold">
        제출 <span className="tabular text-ok">{submitted}</span> <span className="tabular font-medium text-ink-3">/ {total}</span>
      </h2>
      {closedAt && (
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-[13px] font-semibold text-ink-2">
          <span className="inline-flex items-center gap-1">
            <Icon name="lock" size={14} />
            마감됨{when && ` · ${when}`}
          </span>
          <button
            type="button"
            onClick={onReopen}
            className="relative h-8 rounded-full px-2 text-[13px] font-medium text-ink-3 underline underline-offset-2 after:absolute after:inset-x-0 after:-inset-y-1.5 hover:text-ink"
          >
            마감 풀기
          </button>
        </span>
      )}
    </div>
  )
}

/** 마감된 주: 합친 PDF 준비 상태 · 빠진 목장 */
function MergeNote({ merge, count, onRetry }: { merge: MergeState | null; count: number; onRetry: () => void }) {
  if (count === 0)
    return <p className="mt-3 rounded-2xl bg-muted px-4 py-3 text-[14px] leading-relaxed text-ink-2">낸 보고서가 없어서 합칠 게 없어요.</p>
  let text: string
  let tone = 'text-ink-2'
  if (!merge || merge.status === 'working') text = merge?.step === 'merge' ? '한 PDF로 합치는 중…' : `보고서 ${count}개를 받는 중…`
  else if (merge.status === 'error') {
    text = merge.message ?? '보고서를 합치지 못했어요.'
    tone = 'text-danger'
  } else text = `보고서 ${count - merge.skipped.length}개 · ${merge.pages}쪽을 목장 순서대로 한 PDF로 합쳐 두었어요.`
  return (
    <div className="mt-3 rounded-2xl bg-surface px-4 py-3 text-[14px] leading-relaxed shadow-[var(--shadow-card)]" role="status" aria-live="polite">
      <p className={`font-semibold ${tone}`}>{text}</p>
      {merge?.status === 'ready' && merge.skipped.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 font-semibold text-danger">{merge.skipped.join(', ')} 목장 보고서는 받지 못해서 빠졌어요.</p>
          <Button variant="secondary" size="sm" icon="undo" onClick={onRetry}>
            다시 합치기
          </Button>
        </div>
      )}
    </div>
  )
}
