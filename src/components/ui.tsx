import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes } from 'react'
import type { Service, Status } from '../lib/types'
import { STATUS_LABEL } from '../lib/types'
import { useStore } from '../store'
import { addDays, currentSunday, labelFull } from '../lib/dates'

/* ───────────── 아이콘 (선 아이콘, 24px 그리드) ───────────── */

const ICONS = {
  check: 'M5 12.5l4.2 4.2L19 7',
  x: 'M6 6l12 12M18 6L6 18',
  chevronLeft: 'M15 5l-7 7 7 7',
  chevronRight: 'M9 5l7 7-7 7',
  chevronDown: 'M5 9l7 7 7-7',
  users: 'M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 19v-1a4 4 0 00-3-3.87M16 3.13a3.5 3.5 0 010 6.75',
  doc: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zM14 3v5h5M9 13h6M9 17h6',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  settings:
    'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z',
  plus: 'M12 5v14M5 12h14',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  print: 'M6 9V3h12v6M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v7H6z',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z',
  edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z',
  trash: 'M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6',
  move: 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 118 0v4',
  logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9',
  cloud: 'M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z',
  cloudOff: 'M22.61 16.95A5 5 0 0018 10h-1.26a8 8 0 00-7.05-6M5 5a8 8 0 004 15h9a5 5 0 001.7-.3M1 1l22 22',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M19 12l-7 7-7-7',
  more: 'M12 13a1 1 0 100-2 1 1 0 000 2zM19 13a1 1 0 100-2 1 1 0 000 2zM5 13a1 1 0 100-2 1 1 0 000 2z',
  undo: 'M3 7v6h6M21 17a9 9 0 00-15-6.7L3 13',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z',
  note: 'M4 4h16v12H8l-4 4V4z',
  word: 'M4 4h16v16H4zM7 8l2 8 3-6 3 6 2-8',
  sheet: 'M4 4h16v16H4zM4 10h16M4 15h16M10 4v16',
  share: 'M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M16 6l-4-4-4 4M12 2v13',
  kakao: 'M12 4C7 4 3 7.1 3 11c0 2.5 1.7 4.7 4.2 5.9L6.5 20l3.7-2.4c.6.1 1.2.1 1.8.1 5 0 9-3.1 9-7s-4-6.7-9-6.7z',
  /** 목장보고서: 폴더에 올리기 화살표 */
  folder: 'M3 7a2 2 0 012-2h4l2 2.5h8a2 2 0 012 2V18a2 2 0 01-2 2H5a2 2 0 01-2-2V7zM12 17v-5M9.5 14l2.5-2.5 2.5 2.5',
} as const

export type IconName = keyof typeof ICONS

export function Icon({ name, size = 20, className = '', strokeWidth = 1.9 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={ICONS[name]} />
    </svg>
  )
}

/* ───────────── 버튼 ───────────── */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'yellow'

const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand text-white shadow-[0_4px_12px_rgb(10_114_180/0.25)] hover:bg-brand-deep active:bg-brand-deep disabled:bg-ink-3 disabled:shadow-none',
  secondary: 'bg-surface text-ink border border-line hover:bg-hover active:bg-muted',
  ghost: 'bg-transparent text-ink-2 hover:bg-black/5 active:bg-black/10',
  danger: 'bg-danger text-white hover:brightness-95 active:brightness-90',
  // 예전 이름 그대로 두고 대표 버튼(파랑)으로 그린다. 출석 표시(1부 노랑)는 버튼이 아니라 이름 칸에서 쓴다
  yellow: 'bg-brand text-white shadow-[0_4px_12px_rgb(10_114_180/0.25)] hover:bg-brand-deep active:bg-brand-deep disabled:shadow-none',
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: IconName }) {
  // 작은 버튼은 보이는 크기는 그대로 두고, 누르는 영역만 위아래로 넓혀 44px 를 맞춘다
  const sz =
    size === 'sm'
      ? 'relative h-9 px-3 text-sm gap-1.5 after:absolute after:inset-x-0 after:-inset-y-1'
      : size === 'lg'
        ? 'h-14 px-5 text-[17px] gap-2'
        : 'h-11 px-4 text-[15px] gap-2'
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-2xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${sz} ${VARIANT[variant]} ${className}`}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 16 : 18} />}
      {children}
    </button>
  )
}

export function IconButton({
  icon,
  label,
  className = '',
  size = 20,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; size?: number }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-2 transition after:absolute after:-inset-0.5 hover:bg-black/5 active:bg-black/10 ${className}`}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  )
}

/* ───────────── 카드 ───────────── */

export function Card({ children, className = '', ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] ${className}`} {...rest}>
      {children}
    </div>
  )
}

/* ───────────── 바텀시트 (휴대폰) / 가운데 모달 (PC) ───────────── */

let sheetSeq = 0
const newSheetToken = () => ++sheetSeq
/** 지금 열려 있는 창들 (먼저 열린 순서) */
const openSheets: number[] = []
/** 닫혔지만 '뒤로 가기' 기록을 아직 치우지 않은 창 */
const closingSheets = new Set<number>()

/** 여러 창이 겹쳐 열리고 닫혀도 화면 스크롤 잠금이 꼬이지 않도록 개수로 센다 */
let scrollLocks = 0
function lockScroll() {
  if (scrollLocks++ === 0) document.body.style.overflow = 'hidden'
}
function unlockScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1)
  if (scrollLocks === 0) document.body.style.overflow = ''
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  /** 휴대폰 키보드가 올라와 보이는 화면이 줄었을 때, 창을 그 안에 맞춘다 */
  const [fit, setFit] = useState<{ top: number; height: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const token = newSheetToken()
    // 여러 창이 겹쳐 있으면 Esc 는 맨 위 창만 닫는다
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openSheets[openSheets.length - 1] === token) onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    lockScroll()

    // 휴대폰 '뒤로 가기'를 누르면 화면 전체가 아니라 이 창만 닫히도록 기록을 하나 쌓는다
    const top = history.state?.amSheet
    if (top !== undefined && closingSheets.has(top)) {
      // 방금 닫힌 창의 기록이 아직 치워지기 전이면, 새로 쌓지 않고 그 자리를 이어 쓴다
      closingSheets.delete(top)
      history.replaceState({ ...(history.state ?? {}), amSheet: token }, '')
    } else {
      history.pushState({ ...(history.state ?? {}), amSheet: token }, '')
    }
    let closedByBack = false
    const onPop = () => {
      if (closedByBack || history.state?.amSheet === token) return
      // 이 창보다 위에 쌓인 창이 닫힌 경우(기록에 아직 이 창이 남아 있음)는 무시
      if (openSheets.indexOf(token) < openSheets.indexOf(history.state?.amSheet)) return
      closedByBack = true
      onCloseRef.current()
    }
    openSheets.push(token)
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('popstate', onPop)
      openSheets.splice(openSheets.indexOf(token), 1)
      unlockScroll()
      if (closedByBack) return
      // X·바깥 누르기·저장으로 닫혔으면 쌓아 둔 기록을 치운다.
      // 바로 다른 창이 열리면 그 창이 이 자리를 이어 쓰므로, 한 박자 뒤에 확인하고 치운다
      closingSheets.add(token)
      setTimeout(() => {
        if (!closingSheets.delete(token)) return
        if (history.state?.amSheet === token) history.back()
      }, 0)
    }
  }, [open])

  // PC 키보드 사용: 열리면 창 안으로 초점을 옮기고, 닫히면 원래 자리로 돌려준다
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const panel = ref.current
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true })
    return () => {
      // 입력칸으로 돌아가면 휴대폰 키보드가 다시 튀어나오므로 버튼일 때만 돌려준다
      if (prev?.isConnected && !prev.matches('input, textarea, select, [contenteditable]')) prev.focus({ preventScroll: true })
    }
  }, [open])

  // 휴대폰 키보드: 보이는 영역(visualViewport)에 맞춰 창을 올리고, 입력칸이 가려지지 않게 한다
  useEffect(() => {
    if (!open) return
    const vv = window.visualViewport
    if (!vv) return
    let raf = 0
    let lastHeight = -1
    const update = () => {
      raf = 0
      const covered = window.innerHeight - vv.height
      if (vv.scale > 1.01 || covered < 80) {
        lastHeight = -1
        setFit(null)
        return
      }
      setFit({ top: vv.offsetTop, height: vv.height })
      // 키보드가 막 올라왔을 때만(높이가 바뀔 때만) 입력칸을 보이게 당긴다. 사용자가 스크롤하는 중에는 건드리지 않는다
      if (Math.abs(vv.height - lastHeight) < 1) return
      lastHeight = vv.height
      const a = document.activeElement
      if (a instanceof HTMLElement && ref.current?.contains(a) && a.matches('input, textarea, select')) {
        requestAnimationFrame(() => a.scrollIntoView({ block: 'nearest' }))
      }
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule)
    return () => {
      cancelAnimationFrame(raf)
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      setFit(null)
    }
  }, [open])

  if (!open) return null
  // 파란 띠 안에서 열어도(예: 띠의 알림 버튼) 창 안은 띠 모양·흰 글씨를 물려받지 않게
  return (
    <OnBandContext.Provider value={false}>
    <div
      className="no-print fixed inset-0 z-50 flex items-end justify-center text-ink sm:items-center sm:p-6"
      style={fit ? { top: fit.top, height: fit.height, bottom: 'auto' } : undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
    >
      <div className="anim-fade absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        style={fit ? { paddingBottom: 0 } : undefined}
        className={`anim-sheet safe-bottom relative flex w-full flex-col rounded-t-[28px] bg-surface shadow-[var(--shadow-pop)] outline-none sm:max-w-md sm:rounded-[28px] ${
          fit ? 'max-h-[calc(100%-0.75rem)]' : 'max-h-[88%] sm:max-h-full'
        }`}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-line sm:hidden" />
        {title && (
          <div className="flex shrink-0 items-center justify-between gap-2 px-5 pt-3 pb-1 sm:pt-5">
            <h2 id={titleId} className="min-w-0 text-lg leading-snug font-bold [overflow-wrap:anywhere]">
              {title}
            </h2>
            <IconButton icon="x" label="닫기" onClick={onClose} className="-mr-2" />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-2 pb-5">{children}</div>
        {footer && <div className="shrink-0 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
    </OnBandContext.Provider>
  )
}

/** 확인 창 (삭제 등) */
export function Confirm({
  open,
  title,
  message,
  confirmLabel = '확인',
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  message?: ReactNode
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {message && <div className="mb-5 text-[15px] leading-relaxed text-ink-2">{message}</div>}
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>
          취소
        </Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          className="flex-1"
          onClick={() => {
            onConfirm()
            onClose()
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Sheet>
  )
}

/* ───────────── 입력 ───────────── */

export function TextField({
  label,
  className = '',
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="mb-1.5 block text-sm font-medium text-ink-2">{label}</span>}
      <input
        className="h-12 w-full rounded-2xl border border-line bg-hover px-4 outline-none transition placeholder:text-ink-3 focus:border-brand focus:bg-surface"
        {...rest}
      />
    </label>
  )
}

export function TextArea({
  label,
  className = '',
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="mb-1.5 block text-sm font-medium text-ink-2">{label}</span>}
      <textarea
        className="min-h-24 w-full resize-y rounded-2xl border border-line bg-hover px-4 py-3 leading-relaxed outline-none transition placeholder:text-ink-3 focus:border-brand focus:bg-surface"
        {...rest}
      />
    </label>
  )
}

/* ───────────── 상태 표시 ───────────── */

export const STATUS_STYLE: Record<Status | 'unchecked', { bg: string; soft: string; ink: string; dot: string }> = {
  present: { bg: 'bg-present', soft: 'bg-present-soft', ink: 'text-present-ink', dot: 'bg-present' },
  away: { bg: 'bg-away', soft: 'bg-away-soft', ink: 'text-away-ink', dot: 'bg-away' },
  nocontact: { bg: 'bg-nocontact', soft: 'bg-nocontact-soft', ink: 'text-nocontact-ink', dot: 'bg-nocontact' },
  other: { bg: 'bg-other', soft: 'bg-other-soft', ink: 'text-other-ink', dot: 'bg-other' },
  unchecked: { bg: 'bg-line', soft: 'bg-muted', ink: 'text-ink-3', dot: 'bg-line' },
}

/** 예배별 출석 색: 1부 = 노랑, 2부 = 민트 */
export const SERVICE_STYLE: Record<Service, { bg: string; soft: string; ink: string; label: string }> = {
  1: { bg: 'bg-present', soft: 'bg-present-soft', ink: 'text-present-ink', label: '1부' },
  2: { bg: 'bg-present2', soft: 'bg-present2-soft', ink: 'text-present2-ink', label: '2부' },
}

/** 출석 기록의 표시용 스타일 (출석이면 1부/2부 색, 아니면 상태 색) */
export function recordStyle(status: Status | 'unchecked', service: Service | null) {
  if (status === 'present' && service === 2) return { ...STATUS_STYLE.present, bg: 'bg-present2', soft: 'bg-present2-soft', ink: 'text-present2-ink', dot: 'bg-present2' }
  return STATUS_STYLE[status]
}

export function ServicePill({ service, className = '' }: { service: Service; className?: string }) {
  const s = SERVICE_STYLE[service]
  return <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-[13px] font-bold ${s.soft} ${s.ink} ${className}`}>{s.label}</span>
}

export function StatusPill({ status, className = '' }: { status: Status | 'unchecked'; className?: string }) {
  const s = STATUS_STYLE[status]
  const label = status === 'unchecked' ? '미확인' : STATUS_LABEL[status]
  return (
    <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-[13px] font-semibold ${s.soft} ${s.ink} ${className}`}>{label}</span>
  )
}

/**
 * 출석 진행 막대: 1부(노랑) / 2부(민트) / 타지 / 연락두절 / 기타 / 미확인 비율
 * service2 를 주면 present 중 그만큼을 민트로 보여 준다.
 */
export function StackBar({
  present,
  service2 = 0,
  away,
  nocontact,
  other,
  total,
  className = '',
}: {
  present: number
  service2?: number
  away: number
  nocontact: number
  other: number
  total: number
  className?: string
}) {
  const w = (n: number) => (total > 0 ? `${(n / total) * 100}%` : '0%')
  return (
    <div className={`flex h-2 w-full overflow-hidden rounded-full bg-track ${className}`}>
      <div className="bg-present transition-all" style={{ width: w(present - service2) }} />
      <div className="bg-present2 transition-all" style={{ width: w(service2) }} />
      <div className="bg-away transition-all" style={{ width: w(away) }} />
      <div className="bg-nocontact transition-all" style={{ width: w(nocontact) }} />
      <div className="bg-other transition-all" style={{ width: w(other) }} />
    </div>
  )
}

/** 원형 진행률 */
export function Ring({ value, size = 44, stroke = 5, children }: { value: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, value))
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--color-brand-soft)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="var(--color-brand)"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ transition: 'stroke-dashoffset .4s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  )
}

/* ───────────── 주일 선택 ───────────── */

/**
 * ‹ 2026년 11월 15일 (주일) › — 지난 주일/다음 주일로 이동.
 * 파란 띠(PageHeader) 안에 두면 띠에 맞는 모양(진한 파랑 알약)으로 그린다.
 * noun: '지난 ○○ / 다음 주 ○○ / 이번 주 ○○' 의 낱말 (기본 '출석부', 목장보고서 탭은 '보고서')
 */
export function WeekSwitcher({ className = '', noun = '출석부' }: { className?: string; noun?: string }) {
  const date = useStore((s) => s.date)
  const setDate = useStore((s) => s.setDate)
  const onBand = useOnBand()
  const thisSunday = currentSunday()
  const isThisWeek = date === thisSunday
  // 다음 주일까지만 미리 열 수 있다
  const canNext = date < addDays(thisSunday, 7)
  const full = labelFull(date)
  const state = isThisWeek ? `이번 주 ${noun}` : date < thisSunday ? `지난 ${noun}` : `다음 주 ${noun}`
  const arrow = onBand ? 'text-white hover:bg-white/10 active:bg-white/15 disabled:opacity-40' : 'disabled:opacity-30'
  return (
    <div className={`flex items-center gap-1 ${onBand ? 'min-h-12 rounded-full bg-brand-deep p-0.5 text-white' : ''} ${className}`}>
      <IconButton icon="chevronLeft" label="지난 주일" className={onBand ? arrow : ''} onClick={() => setDate(addDays(date, -7))} />
      <label
        className={`relative flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-xl has-[input:focus-visible]:ring-2 ${
          onBand ? 'flex-row flex-wrap gap-x-2 has-[input:focus-visible]:ring-white' : 'flex-col has-[input:focus-visible]:ring-ink'
        }`}
      >
        <span className={`tabular max-w-full truncate font-bold ${onBand ? 'text-[16px]' : 'text-[15px]'}`}>
          {(() => {
            // 좁은 휴대폰에서 '이번 주' 버튼이 붙으면 '(주일)'을 빼서 날짜가 잘리지 않게 한다
            const text = onBand ? labelMDW(full) : full
            const at = text.lastIndexOf(' (')
            if (at < 0) return text
            return (
              <>
                {text.slice(0, at)}
                <span className={isThisWeek ? '' : 'max-[419px]:hidden'}>{text.slice(at)}</span>
              </>
            )
          })()}
        </span>
        {onBand ? (
          isThisWeek ? (
            <span className="inline-flex h-[22px] shrink-0 items-center rounded-full bg-accent px-2 text-[12px] font-bold text-accent-ink">이번 주</span>
          ) : (
            <span className="shrink-0 text-[12px] font-semibold text-white/85">{state}</span>
          )
        ) : (
          <span className={`text-[13px] leading-snug font-medium ${isThisWeek ? 'text-brand-ink' : 'text-ink-3'}`}>
            {state}
          </span>
        )}
        <input
          type="date"
          aria-label="날짜 고르기"
          className="absolute inset-0 cursor-pointer opacity-0"
          value={date}
          max={addDays(thisSunday, 7)}
          onChange={(e) => {
            // 고른 날짜가 속한 주의 주일로 맞추고, 너무 먼 날짜는 store 가 막는다
            if (e.target.value) setDate(e.target.value)
          }}
        />
      </label>
      <IconButton
        icon="chevronRight"
        label="다음 주일"
        disabled={!canNext}
        className={onBand ? arrow : 'disabled:opacity-30'}
        onClick={() => canNext && setDate(addDays(date, 7))}
      />
      {!isThisWeek && (
        <button
          type="button"
          onClick={() => setDate(thisSunday)}
          className={`relative ml-1 h-9 shrink-0 rounded-full px-3 text-[13px] font-semibold whitespace-nowrap after:absolute after:inset-x-0 after:-inset-y-1 ${
            onBand ? 'mr-1 bg-white text-brand' : 'bg-brand text-white'
          }`}
        >
          이번 주
        </button>
      )}
    </div>
  )
}

/** '2026년 11월 15일 (주일)' → '11월 15일 (주일)' (띠 안에서는 올해 연도를 뺀다) */
function labelMDW(full: string): string {
  const y = `${currentSunday().slice(0, 4)}년 `
  return full.startsWith(y) ? full.slice(y.length) : full
}

/* ───────────── 저장 상태 ───────────── */

export function SyncBadge() {
  const sync = useStore((s) => s.sync)
  const mode = useStore((s) => s.backend.mode)
  const onBand = useOnBand()
  const quiet = onBand ? 'text-white' : 'text-ink-3'
  if (sync === 'saving')
    return (
      <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium whitespace-nowrap ${quiet}`}>
        <span className={`h-1.5 w-1.5 animate-pulse rounded-full ${onBand ? 'bg-white' : 'bg-ink-3'}`} />
        {/* 아주 좁은 휴대폰(320px)의 띠 안에서는 점만 (출석부 안쪽 탭 제목과 겹치지 않게) */}
        <span className={onBand ? 'max-[359px]:sr-only' : ''}>저장 중</span>
      </span>
    )
  if (sync === 'error')
    return (
      <span
        className={`inline-flex items-center gap-1.5 text-[13px] font-semibold whitespace-nowrap text-danger ${onBand ? 'h-7 rounded-full bg-white px-2.5' : ''}`}
      >
        <Icon name="cloudOff" size={14} /> 저장 실패
      </span>
    )
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium whitespace-nowrap ${quiet}`}>
      <Icon name="cloud" size={14} />
      {/* 띠 안 휴대폰에서는 아이콘만 (제목 줄이 두 줄로 밀리지 않게) */}
      <span className={onBand ? 'max-md:sr-only' : ''}>{mode === 'cloud' ? '실시간 저장됨' : '체험 모드'}</span>
    </span>
  )
}

/* ───────────── 토스트 ───────────── */

/**
 * 화면 아래에 붙어 있는 막대(휴대폰 아래 탭, 목장 '완료' 막대, 보고서 '글 복사' 막대 등) 중
 * 가장 높이 올라온 것의 윗변까지 거리. 토스트를 그 위에 띄워 버튼을 가리지 않게 한다.
 */
function useDockedBottom(active: boolean, watch: string) {
  const [bottom, setBottom] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (!active) return
    let raf = 0
    const measure = () => {
      raf = 0
      const vh = window.innerHeight
      let top = vh
      document.querySelectorAll<HTMLElement>('.sticky, .fixed').forEach((el) => {
        if (el.closest('[data-toasts], [role="dialog"]')) return
        const cs = getComputedStyle(el)
        if (cs.bottom === 'auto' || (cs.position === 'fixed' && cs.top !== 'auto')) return
        if (cs.position !== 'sticky' && cs.position !== 'fixed') return
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0 || r.top < vh * 0.4 || r.top >= vh) return
        top = Math.min(top, r.top)
      })
      setBottom(vh - top)
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [active, watch])
  return bottom
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  const tab = useStore((s) => s.tab)
  const groupId = useStore((s) => s.groupId)
  const docked = useDockedBottom(toasts.length > 0, `${toasts.map((t) => t.id).join()}|${tab}|${groupId}`)
  return (
    <div
      data-toasts
      className="no-print pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-8 md:left-52 lg:left-60"
      style={docked ? { bottom: docked + 12 } : undefined}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className={`anim-pop pointer-events-auto flex max-w-sm items-center gap-2 rounded-2xl py-1.5 pr-1.5 pl-4 text-[15px] leading-snug font-semibold shadow-[var(--shadow-pop)] md:max-w-md ${
            t.tone === 'error' ? 'bg-danger text-white' : 'bg-ink text-white'
          }`}
        >
          <button
            type="button"
            className={`min-h-11 min-w-0 flex-1 py-2 text-left [overflow-wrap:anywhere] ${t.action ? '' : 'pr-2.5'}`}
            onClick={() => dismiss(t.id)}
          >
            {t.text}
          </button>
          {t.action && (
            <button
              type="button"
              className="h-11 shrink-0 rounded-xl bg-white/15 px-3.5 font-bold whitespace-nowrap text-accent hover:bg-white/25"
              onClick={() => {
                t.action!.run()
                dismiss(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

/** 빈 상태 안내 */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brand-soft text-brand">
        <Icon name="sparkle" size={26} />
      </div>
      <p className="font-bold">{title}</p>
      {children && <div className="mt-1 text-sm text-ink-3">{children}</div>}
    </div>
  )
}

/** 파란 띠 안에 있는지 (띠 안의 글씨·버튼은 흰색 계열로 그린다) */
const OnBandContext = createContext(false)
export function useOnBand(): boolean {
  return useContext(OnBandContext)
}

/**
 * 페이지 위쪽 파란 띠: 로고 · 제목 · 오른쪽 버튼, 그 아래에 주일 고르기·작은 탭 같은 것(children).
 * 휴대폰에서는 화면 양옆과 맨 위까지 꽉 채우고, PC 에서는 둥근 카드로 보인다.
 * nav 를 주면(예: 출석부의 출석·출석보고·통계) 로고와 제목 대신 그것을 그린다. 제목은 화면 읽기 프로그램용으로만 남긴다
 */
export function PageHeader({
  title,
  sub,
  right,
  nav,
  children,
}: {
  title: ReactNode
  sub?: ReactNode
  right?: ReactNode
  nav?: ReactNode
  children?: ReactNode
}) {
  return (
    <OnBandContext.Provider value={true}>
      <header className="no-print -mt-3 mr-[calc(-1*max(1rem,env(safe-area-inset-right)))] mb-3 ml-[calc(-1*max(1rem,env(safe-area-inset-left)))] rounded-b-3xl bg-brand pt-[max(env(safe-area-inset-top),0.75rem)] pr-[max(1rem,env(safe-area-inset-right))] pb-4 pl-[max(1rem,env(safe-area-inset-left))] text-white md:mx-0 md:mt-0 md:mb-5 md:rounded-3xl md:px-5 md:pt-4">
        <div className="flex min-h-11 items-center justify-between gap-3">
          {nav ? (
            <div className="flex min-w-0 flex-1 items-center">
              <h1 className="sr-only">{title}</h1>
              {nav}
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-2.5">
              {/* 휴대폰: 로고 (PC 는 왼쪽 메뉴에 있음). 로고 글씨가 어두워서 흰 칩 위에 */}
              <span className="inline-flex h-9 shrink-0 items-center rounded-[10px] bg-white px-2 max-[359px]:hidden md:hidden">
                <img src="./logo-full.png" alt="AM청년회" width={73} height={26} className="h-[26px] w-auto" />
              </span>
              <div className="min-w-0">
                <h1 className="line-clamp-2 text-[22px] leading-tight font-bold tracking-tight [overflow-wrap:anywhere] md:text-[26px]">{title}</h1>
                {sub && <div className="mt-0.5 text-[13px] text-white">{sub}</div>}
              </div>
            </div>
          )}
          {right && <div className="shrink-0">{right}</div>}
        </div>
        {children && <div className="mt-3">{children}</div>}
      </header>
    </OnBandContext.Provider>
  )
}

/** 세그먼트 버튼 (탭 안의 작은 전환). 파란 띠 안에서는 흰 알약 모양으로 그린다 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className = '',
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode }[]
  className?: string
}) {
  const onBand = useOnBand()
  return (
    <div className={`inline-flex ${onBand ? 'gap-1.5' : 'rounded-2xl bg-track p-1'} ${className}`}>
      {options.map((o) => {
        const on = value === o.value
        const look = onBand
          ? on
            ? 'rounded-full border-[1.5px] border-white bg-white font-bold text-brand'
            : 'rounded-full border-[1.5px] border-white/55 font-medium text-white hover:bg-white/10'
          : on
            ? 'rounded-xl bg-brand font-bold text-white shadow-[0_2px_6px_rgb(10_114_180/0.28)]'
            : 'rounded-xl font-semibold text-ink-2 hover:text-ink'
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`h-11 flex-1 px-3 text-sm whitespace-nowrap transition md:h-10 ${look}`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
