import { useRef, useState } from 'react'
import { useStore } from '../../store'
import { labelFull, sundayOnOrBefore } from '../../lib/dates'
import { parseRosterWorkbook, type ParsedSheet } from '../../lib/excelRoster'
import { Button, Card, Confirm, Icon } from '../ui'
import { importParsedRoster } from './lib'

/**
 * 처음 쓸 때(쓰는 목장도 명단에 있는 사람도 없을 때): 지금 쓰는 엑셀 출석부 파일에서 명단 불러오기.
 * 명단은 앱 코드에 넣지 않고, 회장이 고른 파일에서만 읽는다 (개인정보 보호).
 */
export function SeedImportCard({ onStartEmpty }: { onStartEmpty: () => void }) {
  const mode = useStore((s) => s.backend.mode)
  const date = useStore((s) => s.date)
  const toast = useStore((s) => s.toast)
  const fileRef = useRef<HTMLInputElement>(null)
  const [sheets, setSheets] = useState<ParsedSheet[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [picked, setPicked] = useState(0)
  const [reading, setReading] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  const sheet = sheets?.[picked]
  const joinedOn = sundayOnOrBefore(date)

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
    if (!sheet) return
    setBusy(true)
    try {
      const res = await importParsedRoster(sheet.groups, joinedOn)
      if (res.result === 'exists') {
        // 서버에 목장이 하나라도 있으면(삭제한 목장 포함) 넣지 않는다
        const hasActive = useStore.getState().groups.some((g) => !g.archived)
        toast(
          hasActive
            ? '다른 분이 먼저 명단을 넣어 두었어요. 그 명단을 보여 드릴게요'
            : '이미 저장된 목장이 있어서 불러오지 않았어요. 아래 ‘삭제한 목장’에서 되살리거나, 빈 상태로 시작해 주세요',
          'info',
        )
      } else toast(`목장 ${res.groups}개, ${res.members}명을 불러왔어요`, 'success')
    } catch (e) {
      console.error(e)
      toast('명단을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Card className="anim-pop overflow-hidden">
        <div className="bg-brand px-5 pt-6 pb-5 text-white">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface text-brand shadow-[0_2px_6px_rgb(4_40_66/0.18)]">
            <Icon name="sheet" size={24} />
          </span>
          <p className="mt-4 text-[13px] font-bold text-white">처음 오셨네요! 명단부터 넣어 볼까요?</p>
          <h2 className="mt-1 text-[21px] leading-snug font-bold tracking-tight">
            엑셀 출석부에서
            <br />
            명단 불러오기
          </h2>
          <p className="mt-1.5 text-[14px] leading-relaxed text-white">
            지금 쓰는 출석부 파일(.xlsx)을 고르면 목장, 목자·총무, 목장 가족을 한 번에 넣어요.
          </p>
        </div>
        <div className="px-5 pt-4 pb-5">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />

          {!sheets ? (
            <Button size="lg" className="w-full" icon="sheet" disabled={reading} onClick={() => fileRef.current?.click()}>
              {reading ? '파일 읽는 중…' : '엑셀 파일 고르기'}
            </Button>
          ) : (
            <>
              <p className="truncate text-[13px] font-semibold text-ink-3">{fileName}</p>
              {sheets.length > 1 && (
                <label className="mt-3 block">
                  <span className="mb-1.5 block text-sm font-medium text-ink-2">어느 시트의 명단을 쓸까요? (보통 맨 앞 = 가장 최근)</span>
                  <select
                    className="h-12 w-full rounded-2xl border border-line bg-hover px-4 font-semibold outline-none transition focus:border-brand focus:bg-surface"
                    value={picked}
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
              {sheet && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {sheet.groups.map((g) => (
                    <span key={g.name} className="inline-flex h-8 items-center gap-1 rounded-full bg-muted px-3 text-[13px] font-semibold text-ink-2">
                      {g.name}
                      <span className="font-medium text-ink-3">{g.members.length}</span>
                    </span>
                  ))}
                </div>
              )}
              <Button size="lg" className="mt-5 w-full" icon="download" disabled={busy || !sheet} onClick={() => setConfirm(true)}>
                {busy ? '불러오는 중…' : `${sheet?.memberCount ?? 0}명 불러오기`}
              </Button>
              <Button variant="ghost" className="mt-2 w-full" disabled={busy} onClick={() => fileRef.current?.click()}>
                다른 파일 고르기
              </Button>
            </>
          )}
          <Button variant="ghost" className="mt-2 w-full" disabled={busy} onClick={onStartEmpty}>
            빈 상태로 시작하기
          </Button>
          <p className="mt-1 text-center text-[13px] text-ink-3">빈 상태로 시작하면 목장과 목장원을 직접 넣어요.</p>
        </div>
      </Card>

      <Confirm
        open={confirm}
        title="명단을 불러올까요?"
        confirmLabel="불러오기"
        message={
          <>
            목장 {sheet?.groups.length ?? 0}개와 목장원 {sheet?.memberCount ?? 0}명이 들어가요.{' '}
            {mode === 'cloud' ? '모든 목자·총무 화면에 바로 보여요.' : '이 기기에만 저장돼요.'}
            <br />
            <span className="text-[13px] text-ink-3">
              모두 {labelFull(joinedOn)} 출석부부터 명단에 나와요. 불러온 뒤에도 이름·목장은 언제든 고칠 수 있어요.
            </span>
          </>
        }
        onConfirm={() => void run()}
        onClose={() => setConfirm(false)}
      />
    </>
  )
}
