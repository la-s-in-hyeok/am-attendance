import { useState } from 'react'
import { enableNotifications, isIOS, notifyPermission, notifySupport, showSystemNotice, systemNotifyOn } from '../../lib/push'
import { currentSunday } from '../../lib/dates'
import { useStore } from '../../store'
import { Button, Sheet } from '../ui'

function Bell({ size = 18, filled = false }: { size?: number; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 01-3.46 0" fill="none" />
    </svg>
  )
}

type SheetKind = 'ios' | 'denied' | 'on' | 'unsupported' | null

/** 출석 화면 위쪽: 이 기기에서 목장 완료 알림(휴대폰 알림) 켜기 */
export function NotifyButton() {
  const backend = useStore((s) => s.backend)
  const toast = useStore((s) => s.toast)
  const [on, setOn] = useState(() => systemNotifyOn())
  const [sheet, setSheet] = useState<SheetKind>(null)
  const [busy, setBusy] = useState(false)

  const tap = async () => {
    if (busy) return
    const sup = notifySupport()
    if (sup === 'ios-home') return setSheet('ios')
    if (sup === 'unsupported') return setSheet(isIOS() ? 'ios' : 'unsupported')
    if (systemNotifyOn()) return setSheet('on')
    if (notifyPermission() === 'denied') return setSheet('denied')
    setBusy(true)
    try {
      const r = await enableNotifications(backend)
      if (r === 'on') {
        setOn(true)
        toast('알림을 켰어요', 'success')
      } else if (r === 'denied') {
        setSheet('denied')
      }
    } finally {
      setBusy(false)
    }
  }

  const test = () => {
    void showSystemNotice({ kind: 'done', group: '', groupId: 'test', date: currentSunday(), n: 0 }, '알림이 잘 와요')
  }

  return (
    <>
      {on ? (
        <button
          type="button"
          onClick={() => void tap()}
          aria-label="알림 켜짐"
          title="알림 켜짐"
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-full bg-present-soft text-present-ink transition before:absolute before:-inset-1 before:content-[''] active:scale-95"
        >
          <Bell size={17} filled />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void tap()}
          disabled={busy}
          className="relative inline-flex h-9 items-center gap-1.5 rounded-full bg-surface px-3 text-[13px] font-bold whitespace-nowrap text-ink shadow-[var(--shadow-card)] transition before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] active:scale-95 disabled:opacity-60"
        >
          <Bell size={16} />
          알림 켜기
        </button>
      )}

      <Sheet open={sheet === 'ios'} onClose={() => setSheet(null)} title="아이폰 알림 받기">
        <ol className="space-y-2.5">
          {['사파리 아래쪽 공유 버튼을 눌러요', '‘홈 화면에 추가’를 눌러요', '홈 화면의 출석부 아이콘으로 열고 ‘알림 켜기’를 눌러요'].map((s, i) => (
            <li key={s} className="flex gap-3 text-[15px] leading-relaxed text-ink-2">
              <span className="tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-present text-[13px] font-bold text-ink">
                {i + 1}
              </span>
              <span className="min-w-0">{s}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-[13px] text-ink-3">iOS 16.4 이상에서 돼요.</p>
        <Button variant="secondary" className="mt-4 w-full" onClick={() => setSheet(null)}>
          확인
        </Button>
      </Sheet>

      <Sheet open={sheet === 'denied'} onClose={() => setSheet(null)} title="알림이 막혀 있어요">
        <p className="text-[15px] leading-relaxed text-ink-2">휴대폰 설정이나 브라우저 주소창의 자물쇠 메뉴에서 이 사이트의 알림을 허용해 주세요.</p>
        <Button variant="secondary" className="mt-5 w-full" onClick={() => setSheet(null)}>
          확인
        </Button>
      </Sheet>

      <Sheet open={sheet === 'unsupported'} onClose={() => setSheet(null)} title="알림을 쓸 수 없어요">
        <p className="text-[15px] leading-relaxed text-ink-2">이 브라우저는 알림을 지원하지 않아요. 크롬이나 사파리로 열어 주세요.</p>
        <Button variant="secondary" className="mt-5 w-full" onClick={() => setSheet(null)}>
          확인
        </Button>
      </Sheet>

      <Sheet open={sheet === 'on'} onClose={() => setSheet(null)} title="알림이 켜져 있어요">
        <p className="text-[15px] leading-relaxed text-ink-2">목장이 완료하거나 수정하면 알려 드려요.</p>
        <div className="mt-5 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={test}>
            시험 알림
          </Button>
          <Button variant="secondary" className="flex-1" onClick={() => setSheet(null)}>
            확인
          </Button>
        </div>
      </Sheet>
    </>
  )
}
