import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../store'
import { Icon } from '../components/ui'

const MIN = 4
const MAX = 8
/** 이 기기에서 마지막으로 맞힌 비밀번호 자릿수 (다음부터는 그 자릿수가 차면 바로 확인) */
const LEN_KEY = 'am-attendance:passlen'

function readLen(): number | null {
  try {
    const n = Number(localStorage.getItem(LEN_KEY))
    return n >= MIN && n <= MAX ? n : null
  } catch {
    return null
  }
}
function writeLen(n: number) {
  try {
    localStorage.setItem(LEN_KEY, String(n))
  } catch {
    /* 무시 */
  }
}

/** 한글 안내가 담긴 오류면 그 문구를, 아니면 기본 문구를 */
function messageOf(e: unknown, fallback: string): string {
  const m = e instanceof Error ? e.message : ''
  return /[가-힣]/.test(m) ? m : fallback
}

/** 목자·총무 공용 비밀번호 입력 (숫자 4~8자리 키패드) */
export function LoginPage() {
  const login = useStore((s) => s.login)
  const booting = useStore((s) => s.booting)
  const mode = useStore((s) => s.backend.mode)
  const [code, setCode] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(false)
  const [knownLen, setKnownLen] = useState<number | null>(() => readLen() ?? (mode === 'local' ? 4 : null))

  const submit = useCallback(
    (value: string) => {
      if (busy || value.length < MIN) return
      setBusy(true)
      login(value, remember)
        .then((ok) => {
          if (ok) {
            writeLen(value.length)
            return
          }
          setError('비밀번호가 맞지 않아요')
          // 비밀번호 자릿수가 바뀌었을 수 있으니, 이제부터는 '확인'을 눌러서 확인
          setKnownLen(null)
          setShake(true)
          setTimeout(() => setShake(false), 400)
          setCode('')
        })
        .catch((e) => {
          setError(messageOf(e, '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.'))
          setCode('')
        })
        .finally(() => setBusy(false))
    },
    [busy, login, remember],
  )

  // 이 기기에서 쓰던 자릿수가 차면 '확인'을 누르지 않아도 바로 확인
  useEffect(() => {
    if (knownLen && code.length === knownLen) submit(code)
  }, [code, knownLen, submit])

  const press = useCallback(
    (d: string) => {
      if (busy) return
      setError('')
      setCode((c) => (c.length < MAX ? c + d : c))
    },
    [busy],
  )
  const back = useCallback(() => setCode((c) => c.slice(0, -1)), [])

  // PC 키보드로도 입력
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') back()
      else if (e.key === 'Enter') submit(code)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [press, back, submit, code])

  if (booting)
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-line border-t-brand" />
      </div>
    )

  const dots = Math.max(knownLen ?? MIN, code.length)
  const canSubmit = code.length >= MIN && !busy

  /*
   * 휴대폰: 위에 로고·점, 아래에 키패드 (엄지가 닿는 자리). 화면이 낮으면(360×640 등) 간격·키 높이가 줄어 스크롤 없이 다 보인다.
   * PC·태블릿: 가운데에 모아서.
   * (safe-top/safe-bottom 은 padding 을 덮어쓰므로 바깥 상자에만 두고, 안쪽 상자가 여백을 맡는다)
   */
  return (
    <div className="safe-top safe-bottom flex min-h-full flex-col bg-bg">
      <div className="flex flex-1 flex-col items-center justify-between px-6 py-8 supports-[height:1dvh]:py-[clamp(12px,3dvh,32px)] md:justify-center md:gap-12">
        <div className="flex flex-col items-center text-center">
          <img
            src="./logo-full.png"
            alt="AM청년회"
            className="mb-6 h-16 w-auto supports-[height:1dvh]:mb-[clamp(12px,3dvh,24px)] supports-[height:1dvh]:h-[clamp(44px,8dvh,64px)]"
          />
          <h1 className="text-2xl font-extrabold tracking-tight">AM청년회</h1>
          <p className="mt-1.5 text-sm text-ink-3">목자·총무 비밀번호를 입력해 주세요</p>

          <div
            className="mt-9 flex h-5 items-center gap-3.5 supports-[height:1dvh]:mt-[clamp(16px,4dvh,36px)]"
            style={shake ? { animation: 'shake .35s' } : undefined}
          >
            {Array.from({ length: dots }).map((_, i) => (
              <span key={i} className={`h-4 w-4 rounded-full transition ${i < code.length ? 'scale-110 bg-brand' : 'bg-line'}`} />
            ))}
          </div>
          <p className="mt-3 min-h-5 max-w-xs text-sm font-semibold text-danger" role="alert">
            {error}
          </p>
        </div>

        <div className="w-full max-w-xs">
          <div className="grid grid-cols-3 gap-3">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <Key key={d} onClick={() => press(d)}>
                {d}
              </Key>
            ))}
            <Key onClick={back} label="지우기">
              <Icon name="chevronLeft" size={24} />
            </Key>
            <Key onClick={() => press('0')}>0</Key>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => submit(code)}
              className={`${KEY_H} flex items-center justify-center rounded-2xl bg-brand text-[17px] font-bold text-white shadow-[0_4px_12px_rgb(10_114_180/0.25)] transition select-none active:scale-95 disabled:bg-line disabled:text-ink-3 disabled:shadow-none`}
            >
              {busy ? '…' : '확인'}
            </button>
          </div>
          <label className="mx-auto mt-2 flex h-11 w-fit cursor-pointer items-center justify-center gap-2 px-2 text-sm font-semibold text-ink-2 select-none">
            <input type="checkbox" className="h-5 w-5 accent-brand" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            이 기기에서 로그인 유지
          </label>
          {mode === 'local' && <p className="mt-1 text-center text-[13px] leading-relaxed text-ink-3">체험판 · 비밀번호 0000</p>}
        </div>
      </div>
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}`}</style>
    </div>
  )
}

/** 키 높이: 보통 64px, 낮은 휴대폰 화면에서는 48px 까지 줄어든다 */
const KEY_H = 'h-16 supports-[height:1dvh]:h-[clamp(48px,9dvh,64px)]'

function Key({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`${KEY_H} flex items-center justify-center rounded-2xl bg-surface text-2xl font-semibold shadow-[var(--shadow-card)] transition select-none active:scale-95 active:bg-brand-soft`}
    >
      {children}
    </button>
  )
}
