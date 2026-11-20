import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import { useGroupReports } from '../groupReport/useGroupReports'
import { Button, Sheet, TextField, isTouchDevice, useSmoothHeight } from '../ui'
import { Callout } from './parts'
import { friendlyError, onEnter } from './lib'

const PIN_MIN = 4
const PIN_MAX = 8
const digitsOnly = (s: string) => s.replace(/\D/g, '').slice(0, PIN_MAX)

/**
 * 목장보고서 담당 비밀번호 정하기·바꾸기 (마감·마감 풀기·합친 PDF 에 쓰는 비밀번호).
 * 처음(임시) 값은 0000 이에요. 회장이 담당에게 알려 주고, 여기서 바꿔요. (값을 비운 서버에서만 '지금 비밀번호' 칸 없이 정해요)
 * 정한 뒤에는 지금 비밀번호를 알아야 바꿔요.
 */
export function ReportPinSheet({ onClose }: { onClose: () => void }) {
  const mode = useStore((s) => s.backend.mode)
  const toast = useStore((s) => s.toast)
  /** null = 확인하는 중 */
  const [isSet, setIsSet] = useState<boolean | null>(null)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [autoFocus] = useState(() => !isTouchDevice())
  const box = useRef<HTMLDivElement>(null)
  useSmoothHeight(box, isSet)

  useEffect(() => {
    let alive = true
    useStore
      .getState()
      .backend.reportPinIsSet()
      .then((v) => alive && setIsSet(v))
      .catch((e) => {
        console.error(e)
        if (!alive) return
        // 모르면 '바꾸기' 화면으로 (서버가 다시 확인해요)
        setIsSet(true)
        setError(friendlyError(e, '담당 비밀번호를 정했는지 확인하지 못했어요. 인터넷 연결을 확인해 주세요'))
      })
    return () => {
      alive = false
    }
  }, [])

  const first = isSet === false

  async function submit() {
    if (busy || isSet === null) return
    setError('')
    if (!first && current.length < PIN_MIN) return setError('지금 담당 비밀번호를 넣어 주세요')
    if (next.length < PIN_MIN || next.length > PIN_MAX) return setError(`새 비밀번호는 숫자 ${PIN_MIN}~${PIN_MAX}자리로 해 주세요`)
    if (/^0+$/.test(next)) return setError('0만 있는 비밀번호는 쓸 수 없어요')
    if (!first && next === current) return setError('지금과 다른 비밀번호로 해 주세요')
    if (next !== again) return setError('새 비밀번호가 서로 달라요. 한 번 더 확인해 주세요')
    setBusy(true)
    try {
      await useStore.getState().backend.changeReportPin(first ? null : current, next)
      // 정한 사람은 담당이니, 이 앱을 켜 둔 동안 새 비밀번호를 기억해요
      useGroupReports.getState().rememberPin(next)
      toast(first ? '담당 비밀번호를 정했어요. 보고서를 걷는 사람만 알고 있어 주세요' : '담당 비밀번호를 바꿨어요. 보고서를 걷는 사람에게만 알려 주세요', 'success')
      onClose()
    } catch (e) {
      const kind = (e as { kind?: string } | null)?.kind
      const code = (e as { code?: string } | null)?.code
      if (kind === 'auth') {
        // 공용 비밀번호가 바뀌었어요: 다시 로그인
        const s = useStore.getState()
        s.logout()
        s.toast('비밀번호가 바뀌었어요. 새 비밀번호로 다시 들어와 주세요.', 'error')
        return
      }
      // 틀린 비밀번호·잠김은 예상한 결과라 창 안에만 알려요
      if (code !== 'bad_pin' && code !== 'pin_locked' && code !== 'invalid_pin') console.error(e)
      // 그사이 다른 기기에서 먼저 정했으면 '바꾸기'로 바꿔서 지금 비밀번호를 묻게
      if (first && code === 'bad_pin') {
        setIsSet(true)
        setError('그사이 다른 기기에서 담당 비밀번호를 먼저 정했어요. 정한 사람에게 물어봐 주세요')
        return
      }
      setError(friendlyError(e, '담당 비밀번호를 바꾸지 못했어요. 지금 비밀번호와 인터넷 연결을 확인해 주세요'))
    } finally {
      setBusy(false)
    }
  }

  const common = {
    type: 'password',
    inputMode: 'numeric' as const,
    pattern: '[0-9]*',
    maxLength: PIN_MAX,
    autoComplete: 'off',
    onKeyDown: onEnter(() => void submit()),
  }

  return (
    <Sheet open onClose={onClose} title={first ? '목장보고서 담당 비밀번호 정하기' : '목장보고서 담당 비밀번호 바꾸기'}>
      <div ref={box}>
        {isSet === null ? (
          <p className="py-6 text-center text-[15px] text-ink-3">확인하는 중…</p>
        ) : (
          <div key={first ? 'first' : 'change'} className="space-y-4">
            {!first && (
              <TextField {...common} label="지금 담당 비밀번호" autoFocus={autoFocus} value={current} onChange={(e) => setCurrent(digitsOnly(e.target.value))} />
            )}
            <TextField
              {...common}
              label={`${first ? '' : '새 '}담당 비밀번호 (숫자 ${PIN_MIN}~${PIN_MAX}자리)`}
              autoFocus={first && autoFocus}
              value={next}
              onChange={(e) => setNext(digitsOnly(e.target.value))}
            />
            <TextField {...common} label={`${first ? '' : '새 '}담당 비밀번호 한 번 더`} value={again} onChange={(e) => setAgain(digitsOnly(e.target.value))} />
          </div>
        )}
      </div>

      <p className="mt-3 min-h-5 px-1 text-sm font-semibold text-danger" role="alert">
        {error}
      </p>

      <Callout className="mt-2" icon="lock">
        {first ? '아직 정하지 않았어요. 보고서를 걷는 사람이 정하고, 다른 사람에게는 알려 주지 마세요.' : '보고서를 걷는 사람에게만 알려 주세요.'}
        <span className="mt-1 block text-ink-3">
          {mode === 'cloud'
            ? '목장보고서 마감·마감 풀기·합친 PDF 받기는 이 비밀번호를 아는 사람만 할 수 있어요. 공용 비밀번호와는 따로예요.'
            : '체험 모드라 이 기기의 담당 비밀번호만 바뀌어요.'}
        </span>
      </Callout>

      <div className="mt-5 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>
          취소
        </Button>
        <Button className="flex-1" disabled={busy || isSet === null || (!first && !current) || !next || !again} onClick={() => void submit()}>
          {busy ? (first ? '정하는 중…' : '바꾸는 중…') : first ? '정하기' : '바꾸기'}
        </Button>
      </div>
    </Sheet>
  )
}
