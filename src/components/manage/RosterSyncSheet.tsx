import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useStore } from '../../store'
import { parseRosterWorkbook, type ParsedSheet } from '../../lib/excelRoster'
import { planRosterSync, roleLabel, type RosterSyncPlan } from '../../lib/rosterSync'
import { rosterChangeFrom } from '../../lib/roster'
import { addDays, currentSunday } from '../../lib/dates'
import { groupDayKey } from '../../store'
import { newId } from '../../lib/id'
import { Button, Sheet } from '../ui'
import { applyRosterSync, labelDay } from './lib'

/**
 * 엑셀 출석부 명단과 똑같이 맞추기 (목장 개편·목장원 조정 때).
 * 파일을 고르면 무엇이 바뀌는지 먼저 보여 주고, '맞추기'를 누르면 한 번에 바꿔요.
 * 같은 이름의 사람은 그대로 이어서 지난 출석 기록이 남아요.
 */
export function RosterSyncSheet({ onClose }: { onClose: () => void }) {
  const toast = useStore((s) => s.toast)
  const date = useStore((s) => s.date)
  const groups = useStore((s) => s.groups)
  const members = useStore((s) => s.members)
  const recordMap = useStore((s) => s.records)
  const fileRef = useRef<HTMLInputElement>(null)
  const [sheets, setSheets] = useState<ParsedSheet[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [picked, setPicked] = useState(0)
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState(false)

  const groupDays = useStore((s) => s.groupDays)
  // 그 주일 출석부를 이미 완료했거나 고치는 중인 목장이 있으면, 보고한 숫자가 바뀌지 않게 다음 주일부터 바꿔요
  // 지난 주일 출석부를 열어 두었어도 이번 주 기준으로 해요 (이미 보고한 지난 출석부는 바꾸지 않게)
  const thisSunday = currentSunday()
  const base = rosterChangeFrom(date < thisSunday ? thisSunday : date)
  const started = groups.some((g) => !g.archived && groupDays[groupDayKey(base, g.id)])
  const from = started ? addDays(base, 7) : base
  const sheet = sheets?.[picked]
  const plan = useMemo<RosterSyncPlan | null>(
    () => (sheet ? planRosterSync(sheet.groups, groups, members, Object.values(recordMap), from, newId) : null),
    [sheet, groups, members, recordMap, from],
  )

  async function onFile(f: File | undefined) {
    if (!f) return
    setReading(true)
    setFileName(f.name)
    try {
      const parsed = await parseRosterWorkbook(f)
      if (parsed.length === 0) {
        toast("이 파일에서 명단을 찾지 못했어요. '목장명' 머리글이 있는 출석부 파일인지 확인해 주세요.", 'error')
        setSheets(null)
      } else {
        setSheets(parsed)
        setPicked(0)
      }
    } catch (e) {
      console.error(e)
      toast('파일을 읽지 못했어요. 엑셀(.xlsx) 파일인지 확인해 주세요.', 'error')
      setSheets(null)
    } finally {
      setReading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function run() {
    if (!plan || plan.same || busy) return
    setBusy(true)
    try {
      const { failedRecords } = await applyRosterSync(plan)
      if (failedRecords > 0)
        toast(`명단은 맞췄는데, 출석 기록 ${failedRecords}건은 새 목장으로 옮기지 못했어요 (완료한 목장 기록 등). 한 번 더 하면 남은 것만 옮겨요`, 'info')
      else toast(`명단을 엑셀과 똑같이 맞췄어요 (목장 ${plan.groupCount}개, ${plan.memberCount}명)`, 'success')
      onClose()
    } catch (e) {
      console.error(e)
      toast('명단을 다 바꾸지 못했어요. 인터넷 연결을 확인하고 한 번 더 해 주세요 (다시 하면 남은 것만 바꿔요)', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={busy ? () => undefined : onClose} title="엑셀 명단과 똑같이 맞추기">
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      {!sheets ? (
        <>
          <p className="mb-4 text-[15px] leading-relaxed text-ink-2">
            목장 개편이나 목장원 조정을 한 엑셀 출석부(.xlsx)를 고르면, 앱의 목장·목장원·목자/총무를 그 파일과 똑같이 맞춰요. 바꾸기 전에 무엇이
            바뀌는지 먼저 보여 드려요.
          </p>
          <Button size="lg" className="w-full" icon="sheet" disabled={reading} onClick={() => fileRef.current?.click()}>
            {reading ? '파일 읽는 중…' : '엑셀 파일 고르기'}
          </Button>
        </>
      ) : (
        <>
          <p className="truncate text-[13px] font-semibold text-ink-3">{fileName}</p>
          {sheets.length > 1 && (
            <label className="mt-2 block">
              <span className="mb-1.5 block text-sm font-medium text-ink-2">어느 시트의 명단으로 맞출까요? (보통 맨 앞 = 가장 최근)</span>
              <select
                className="h-12 w-full rounded-2xl border border-line bg-hover px-4 font-semibold outline-none transition focus:border-brand focus:bg-surface"
                value={picked}
                disabled={busy}
                onChange={(e) => setPicked(Number(e.target.value))}
              >
                {sheets.map((s, i) => (
                  <option key={`${s.name}-${i}`} value={i}>
                    {s.name} · 목장 {s.groups.length}개 · {s.memberCount}명
                  </option>
                ))}
              </select>
            </label>
          )}
          {plan && <PlanView plan={plan} />}
          {plan && !plan.same && started && (
            <p className="mt-3 text-[13px] leading-snug text-ink-3">
              {labelDay(base)} 출석부는 이미 완료했거나 고치는 중인 목장이 있어서, 보고한 숫자가 바뀌지 않게 {labelDay(from)} 출석부부터 바꿔요.
            </p>
          )}
          <div className="mt-5 flex gap-2">
            <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => fileRef.current?.click()}>
              다른 파일
            </Button>
            <Button className="flex-1" disabled={busy || !plan || plan.same} onClick={() => void run()}>
              {busy ? '맞추는 중…' : plan?.same ? '이미 똑같아요' : '이대로 맞추기'}
            </Button>
          </div>
        </>
      )}
    </Sheet>
  )
}

function PlanView({ plan }: { plan: RosterSyncPlan }) {
  if (plan.same) {
    return (
      <p className="mt-4 rounded-2xl bg-muted px-4 py-3 text-[15px] text-ink-2">
        앱 명단이 이미 이 시트와 똑같아요 (목장 {plan.groupCount}개, {plan.memberCount}명).
      </p>
    )
  }
  return (
    <div className="mt-4 space-y-3">
      <p className="text-[15px] leading-relaxed text-ink-2">
        맞추면 목장 <b>{plan.groupCount}개</b>, 목장원 <b>{plan.memberCount}명</b>이 돼요. <b>{labelDay(plan.from)}</b> 출석부부터 바뀌고, 그 전
        출석부와 지난 기록은 그대로예요.
      </p>
      <Block title="새로 생기는 목장" items={plan.newGroups} />
      <Block title="다시 쓰는 목장 (삭제했던 목장)" items={plan.revivedGroups} />
      <Block title="삭제되는 목장 (지난 기록은 남아요)" items={plan.archive.map((g) => g.name)} tone="warn" />
      <Block title="목장 이동" items={plan.moved.map((m) => `${m.member.name}: ${m.fromGroup} → ${m.toGroup}`)} />
      <Block title="새로 들어오는 사람" items={plan.added.map((a) => `${a.name} (${a.group})`)} />
      <Block title="다시 명단에 넣는 사람" items={plan.revived.map((a) => `${a.name} (${a.group})`)} />
      <Block title="이름이 바뀌는 사람" items={plan.renamed.map((r) => `${r.member.name} → ${r.newName}`)} />
      <Block title="목자·총무 바뀜" items={plan.roles.map((r) => `${r.member.name} (${r.group}): ${roleLabel(r.from)} → ${roleLabel(r.to)}`)} />
      <Block title="명단에서 빠지는 사람 (지난 기록은 남아요)" items={plan.removed.map((r) => `${r.name} (${r.group})`)} tone="warn" />
    </div>
  )
}

function Block({ title, items, tone }: { title: ReactNode; items: string[]; tone?: 'warn' }) {
  if (items.length === 0) return null
  return (
    <div className={`rounded-2xl px-4 py-3 ${tone === 'warn' ? 'bg-danger-soft' : 'bg-muted'}`}>
      <p className={`text-[13px] font-bold ${tone === 'warn' ? 'text-danger' : 'text-ink-2'}`}>
        {title} {items.length}
      </p>
      <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{items.join(', ')}</p>
    </div>
  )
}
