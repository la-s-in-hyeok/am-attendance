import { useState } from 'react'
import { useStore } from '../../store'
import { Button, Sheet, TextField } from '../ui'
import { Callout } from './parts'
import { friendlyError, onEnter } from './lib'

/**
 * 비밀번호 자릿수.
 * 로그인 화면(LoginPage)은 숫자 4~8자리를 받는다.
 */
const PASS_MIN: number = 4
const PASS_MAX: number = 8

const digitsOnly = (s: string) => s.replace(/\D/g, '').slice(0, PASS_MAX)
const lengthText = PASS_MIN === PASS_MAX ? `숫자 ${PASS_MIN}자리` : `숫자 ${PASS_MIN}~${PASS_MAX}자리`

/** 공용 비밀번호 바꾸기 */
export function PasscodeSheet({ onClose }: { onClose: () => void }) {
  const mode = useStore((s) => s.backend.mode)
  const changePasscode = useStore((s) => s.changePasscode)
  const toast = useStore((s) => s.toast)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (busy) return
    setError('')
    if (!current) return setError('지금 비밀번호를 넣어 주세요')
    // 지금 비밀번호가 맞는지는 서버가 확인한다 (다른 휴대폰에서 이미 바꿨을 수도 있어서)
    if (next.length < PASS_MIN || next.length > PASS_MAX) return setError(`새 비밀번호는 ${lengthText}로 해 주세요`)
    if (next === current) return setError('지금과 다른 비밀번호로 해 주세요')
    if (next !== again) return setError('새 비밀번호가 서로 달라요. 한 번 더 확인해 주세요')
    setBusy(true)
    try {
      await changePasscode(current, next)
      toast(mode === 'cloud' ? '비밀번호를 바꿨어요. 단톡방에 새 비밀번호를 알려 주세요' : '비밀번호를 바꿨어요', 'success')
      onClose()
    } catch (e) {
      console.error(e)
      setError(friendlyError(e, '비밀번호를 바꾸지 못했어요. 지금 비밀번호와 인터넷 연결을 확인해 주세요'))
    } finally {
      setBusy(false)
    }
  }

  const common = {
    type: 'password',
    inputMode: 'numeric' as const,
    pattern: '[0-9]*',
    maxLength: PASS_MAX,
    autoComplete: 'off',
    onKeyDown: onEnter(() => void submit()),
  }

  return (
    <Sheet open onClose={onClose} title="비밀번호 바꾸기">
      <div className="space-y-4">
        <TextField {...common} label="지금 비밀번호" autoFocus value={current} onChange={(e) => setCurrent(digitsOnly(e.target.value))} />
        <TextField
          {...common}
          label={`새 비밀번호 (${lengthText})`}
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(digitsOnly(e.target.value))}
        />
        <TextField
          {...common}
          label="새 비밀번호 한 번 더"
          autoComplete="new-password"
          value={again}
          onChange={(e) => setAgain(digitsOnly(e.target.value))}
        />
      </div>

      <p className="mt-3 h-5 px-1 text-sm font-semibold text-danger" role="alert">
        {error}
      </p>

      <Callout className="mt-2" icon="lock">
        {mode === 'cloud'
          ? '목자·총무 모두가 함께 쓰는 비밀번호예요. 바꾸면 다른 휴대폰에서도 다음에 들어올 때 새 비밀번호를 넣어야 해요.'
          : '체험 모드라 이 기기의 비밀번호만 바뀌어요.'}
      </Callout>

      <div className="mt-5 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>
          취소
        </Button>
        <Button className="flex-1" disabled={busy || !current || !next || !again} onClick={() => void submit()}>
          {busy ? '바꾸는 중…' : '바꾸기'}
        </Button>
      </div>
    </Sheet>
  )
}
