import { create } from 'zustand'
import type { Service } from '../../lib/types'
import { SERVICE_LABEL } from '../../lib/types'

/**
 * 지금 체크하는 예배 (1부/2부). 이 기기에서만, 앱을 다시 열면 1부로 돌아간다.
 * (지난주에 2부로 두고 잊어버려도 다음 주에 전부 2부로 칠해지지 않도록)
 */
export const useServiceMode = create<{ service: Service; setService: (s: Service) => void }>((set) => ({
  service: 1,
  setService: (service) => set({ service }),
}))

const DOT: Record<Service, string> = { 1: 'bg-present', 2: 'bg-present2' }
const ACTIVE: Record<Service, string> = {
  1: 'bg-present text-ink shadow-sm',
  2: 'bg-present2 text-ink shadow-sm',
}

/** [● 1부 예배 | ● 2부 예배] — 이름을 누르면 고른 예배 색으로 칠해진다 */
export function ServiceSwitch({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  const service = useServiceMode((s) => s.service)
  const setService = useServiceMode((s) => s.setService)
  return (
    <div role="radiogroup" aria-label="출석 체크할 예배" className={`inline-flex rounded-2xl bg-[#ececE7] p-1 ${className}`}>
      {([1, 2] as Service[]).map((v) => {
        const on = service === v
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => setService(v)}
            className={`relative inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl font-bold transition before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] ${
              compact ? 'h-9 px-3 text-[14px]' : 'h-10 px-3 text-sm'
            } ${on ? ACTIVE[v] : 'text-ink-3 hover:text-ink-2'}`}
          >
            {!on && <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[v]}`} />}
            {SERVICE_LABEL[v]}
            {!compact && ' 예배'}
          </button>
        )
      })}
    </div>
  )
}
