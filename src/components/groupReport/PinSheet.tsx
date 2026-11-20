import { useRef, useState, type ReactNode } from 'react'
import { Button, Icon, Sheet, isTouchDevice, useSmoothHeight } from '../ui'
import { useGroupReports } from './useGroupReports'

const PIN_MIN = 4
const PIN_MAX = 8

/** 비밀번호가 맞은 뒤 같은 창 안에서 한 번 더 묻는 확인 (창이 바뀌며 엇갈려 움직이지 않게) */
export interface PinConfirmStep {
  message: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
}

/**
 * 보고서 담당 비밀번호 넣기 (마감·마감 풀기·합친 PDF·남의 보고서 지우기 전에).
 * 서버에 맞는지 확인하고, 맞으면 이 앱을 켜 둔 동안만 기억해요.
 * - next 가 있으면: 맞은 뒤 같은 창의 내용이 확인 단계로 부드럽게 바뀌고, 누르면 next.onConfirm
 * - 없으면: 맞자마자 onVerified
 * 틀렸거나 여러 번 틀려 막혔거나 아직 정하지 않았으면 창 안에 알려요.
 */
export function PinSheet({
  open,
  title,
  message,
  confirmLabel = '확인',
  onClose,
  onVerified,
  next,
}: {
  open: boolean
  title: string
  message?: ReactNode
  confirmLabel?: string
  onClose: () => void
  onVerified?: () => void
  next?: PinConfirmStep
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {open && <PinForm message={message} confirmLabel={confirmLabel} onClose={onClose} onVerified={onVerified} next={next} />}
    </Sheet>
  )
}

function PinForm({
  message,
  confirmLabel,
  onClose,
  onVerified,
  next,
}: {
  message?: ReactNode
  confirmLabel: string
  onClose: () => void
  onVerified?: () => void
  next?: PinConfirmStep
}) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [verified, setVerified] = useState(false)
  // 휴대폰에서는 창이 올라오는 중에 키보드가 튀어나오지 않게, 칸을 누를 때 키보드가 올라와요
  const [autoFocus] = useState(() => !isTouchDevice())
  const input = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLDivElement>(null)
  useSmoothHeight(box, verified)

  const submit = async () => {
    if (busy) return
    if (pin.length < PIN_MIN) {
      setError(`담당 비밀번호는 숫자 ${PIN_MIN}~${PIN_MAX}자리예요`)
      return
    }
    setBusy(true)
    setError('')
    const res = await useGroupReports.getState().verifyPin(pin)
    setBusy(false)
    if (res.ok) {
      if (next) {
        // 키보드를 먼저 내리고 같은 창에서 확인 단계로
        input.current?.blur()
        setVerified(true)
      } else onVerified?.()
      return
    }
    setError(res.message)
    setPin('')
    // 바로 다시 넣을 수 있게 (휴대폰 키보드가 내려가 있으면 다시 올라와요)
    input.current?.focus({ preventScroll: true })
  }

  if (verified && next)
    return (
      <div ref={box}>
        <div key="confirm" className="anim-fade">
          <p className="mb-3 flex items-center gap-1.5 text-[14px] font-semibold text-ok">
            <Icon name="check" size={16} className="shrink-0" />
            담당 비밀번호가 맞아요
          </p>
          <div className="mb-5 text-[15px] leading-relaxed text-ink-2">{next.message}</div>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onClose}>
              취소
            </Button>
            <Button
              variant={next.danger ? 'danger' : 'primary'}
              className="flex-1"
              onClick={() => {
                next.onConfirm()
                onClose()
              }}
            >
              {next.confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    )

  return (
    <div ref={box}>
      <form
        key="pin"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {message && <div className="mb-4 text-[15px] leading-relaxed text-ink-2">{message}</div>}
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">보고서 담당 비밀번호</span>
          <input
            ref={input}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={PIN_MAX}
            autoFocus={autoFocus}
            value={pin}
            aria-invalid={error ? true : undefined}
            aria-describedby="report-pin-error"
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_MAX))
              if (error) setError('')
            }}
            className={`tabular h-12 w-full rounded-2xl border bg-hover px-4 text-[18px] tracking-[0.3em] outline-none transition placeholder:tracking-normal placeholder:text-ink-3 focus:bg-surface ${
              error ? 'border-danger focus:border-danger' : 'border-line focus:border-brand'
            }`}
            placeholder={`숫자 ${PIN_MIN}~${PIN_MAX}자리`}
          />
        </label>
        <p id="report-pin-error" className="mt-2 min-h-5 px-1 text-sm leading-snug font-semibold text-danger" role="alert">
          {error}
        </p>
        <p className="mt-1 flex items-start gap-1.5 px-1 text-[13px] leading-relaxed text-ink-3">
          <Icon name="lock" size={14} className="mt-[3px] shrink-0" />
          마감·합친 PDF는 보고서 담당만 할 수 있어요. 한 번 맞게 넣으면 앱을 다시 열 때까지 기억해요.
        </p>
        <div className="mt-5 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" className="flex-1" disabled={busy || pin.length < PIN_MIN} aria-busy={busy}>
            {busy ? '확인하는 중…' : confirmLabel}
          </Button>
        </div>
      </form>
    </div>
  )
}
