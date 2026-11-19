import { useCallback, useEffect, useRef, useState } from 'react'
import type { CompletionNotice } from '../../lib/types'
import { currentSunday, labelMD } from '../../lib/dates'
import { noticeText, pushConfigured, showSystemNotice, syncPush, currentPushEndpoint } from '../../lib/push'
import { useStore } from '../../store'
import { Icon } from '../ui'
import { buzz, chime, unlockAudio } from './alertFx'

/** 화면 위 알림이 저절로 사라지는 시간 */
const SHOW_MS = 8000
/** 한 번에 보여 주는 알림 수 */
const MAX_BANNERS = 3
/** 서버 기록의 완료 시각이 이보다 오래됐으면 지난 알림으로 보고 보여 주지 않아요 (기기 시계가 조금 틀려도 괜찮게) */
const FRESH_MS = 30 * 60_000

interface Banner {
  id: string
  notice: CompletionNotice
  text: string
}

/** 이미 보여 준 알림 (같은 알림이 두 번 와도 한 번만) */
const seen = new Set<string>()

function noticeKey(n: CompletionNotice) {
  return `${n.date}|${n.groupId}|${n.n}`
}

/** 알림을 누르면: 출석 탭 → 그 주일 → 그 목장 */
function openNotice(n: { date: string; groupId: string }) {
  const s = useStore.getState()
  if (!s.groups.some((g) => g.id === n.groupId)) return
  if (s.tab !== 'attend') s.setTab('attend')
  s.setDate(n.date)
  if (s.groupId !== n.groupId) s.openGroup(n.groupId)
}

/**
 * 다른 사람이 목장 '완료' / '수정 완료'를 누르면 화면 위에 알림을 띄워요.
 * (소리·진동, 앱이 뒤에 있으면 휴대폰 알림도)
 * 로그인한 화면(App 의 Toasts 옆)에 한 번만 두면 돼요.
 */
export function CompletionAlerts() {
  const backend = useStore((s) => s.backend)
  const authed = useStore((s) => s.authed)
  const [banners, setBanners] = useState<Banner[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id)
    if (t) clearTimeout(t)
    timers.current.delete(id)
    setBanners((list) => list.filter((b) => b.id !== id))
  }, [])

  // 처음 누를 때 소리 장치 깨우기 (브라우저 규칙)
  useEffect(() => {
    const wake = () => unlockAudio()
    window.addEventListener('pointerdown', wake, { passive: true })
    window.addEventListener('keydown', wake)
    return () => {
      window.removeEventListener('pointerdown', wake)
      window.removeEventListener('keydown', wake)
    }
  }, [])

  // 다른 기기에서 온 알림 받기
  useEffect(() => {
    if (!authed) return
    let alive = true
    const handle = async (notice: CompletionNotice) => {
      const key = noticeKey(notice)
      if (seen.has(key)) return
      // 실시간 채널은 누구나 보낼 수 있어서, 서버 기록으로 진짜 완료인지 확인하고 보여 줘요
      let real = useStore.getState().groups.some((g) => g.id === notice.groupId)
      try {
        const days = await backend.fetchGroupDays(notice.date, notice.date)
        const day = days.find((d) => d.groupId === notice.groupId)
        const doneAt = day?.doneAt ? Date.parse(day.doneAt) : NaN
        real =
          !!day &&
          day.editCount === notice.n &&
          (notice.kind === 'edited') === notice.n > 0 &&
          Number.isFinite(doneAt) &&
          Math.abs(Date.now() - doneAt) < FRESH_MS
      } catch {
        /* 확인하지 못하면 내 명단에 있는 목장일 때만 보여 줘요 */
      }
      if (!alive || !real || seen.has(key)) return
      seen.add(key)

      const st = useStore.getState()
      const name = st.groups.find((g) => g.id === notice.groupId)?.name ?? notice.group
      const text = noticeText(notice.kind, name)
      const id = `${key}|${Date.now()}`
      setBanners((list) => [{ id, notice, text }, ...list].slice(0, MAX_BANNERS))
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), SHOW_MS),
      )
      buzz(notice.kind)
      chime(notice.kind)
      void st.refresh('status')

      // 앱이 뒤에 있으면 휴대폰 알림 (Web Push 를 받는 기기는 서버가 보내므로 건너뛰어요)
      if (document.visibilityState !== 'visible') {
        const push = pushConfigured && (await currentPushEndpoint()) !== null
        if (!push) void showSystemNotice(notice, text)
      }
    }
    const off = backend.onNotice((n) => void handle(n))
    return () => {
      alive = false
      off()
    }
  }, [authed, backend, dismiss])

  // 알림을 켠 기기는 앱을 열 때마다 Web Push 받는 목록에 올려 둬요 (설정돼 있을 때만)
  useEffect(() => {
    if (authed) void syncPush(backend).catch(() => false)
  }, [authed, backend])

  // 휴대폰 알림을 눌러 앱이 열렸을 때 (서비스 워커가 알려 줘요)
  useEffect(() => {
    if (!authed) return
    const params = new URLSearchParams(location.search)
    const gid = params.get('open')
    const date = params.get('date')
    if (gid && date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      params.delete('open')
      params.delete('date')
      const q = params.toString()
      history.replaceState(history.state, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`)
      openNotice({ groupId: gid, date })
    }
    const sw = 'serviceWorker' in navigator ? navigator.serviceWorker : null
    if (!sw) return
    const onMessage = (e: MessageEvent) => {
      const d: unknown = e.data
      if (typeof d !== 'object' || d === null) return
      const m = d as { type?: unknown; groupId?: unknown; date?: unknown }
      if (m.type === 'am-open' && typeof m.groupId === 'string' && typeof m.date === 'string') openNotice({ groupId: m.groupId, date: m.date })
    }
    sw.addEventListener('message', onMessage)
    return () => sw.removeEventListener('message', onMessage)
  }, [authed])

  useEffect(() => {
    const map = timers.current
    return () => {
      for (const t of map.values()) clearTimeout(t)
      map.clear()
    }
  }, [])

  if (!authed || banners.length === 0) return null

  // PC 에서는 왼쪽 메뉴(App 의 md:w-52 / lg:w-60)를 뺀 본문 가운데에 띄워요
  return (
    <div
      className="no-print pointer-events-none fixed inset-x-0 top-0 z-[70] flex flex-col items-center gap-2 px-3 pt-[max(env(safe-area-inset-top),0.5rem)] md:pt-4 md:pl-52 lg:pl-60"
      aria-live="assertive"
    >
      {banners.map((b, i) => {
        const edited = b.notice.kind === 'edited'
        // 휴대폰에서는 맨 위 막대(뒤로·1부/2부)를 덜 가리도록 가장 최근 알림 하나만 낮게 보여 줘요
        return (
          <div
            key={b.id}
            role="alert"
            className={`anim-pop pointer-events-auto flex w-full max-w-md items-center gap-0.5 rounded-[20px] bg-ink p-1 text-white shadow-[var(--shadow-pop)] ${
              i > 0 ? 'max-md:hidden' : ''
            }`}
          >
            <button
              type="button"
              onClick={() => {
                openNotice(b.notice)
                dismiss(b.id)
              }}
              className="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 rounded-2xl py-1 pr-1 pl-1.5 text-left active:bg-white/10"
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${edited ? 'bg-other text-white' : 'bg-present text-ink'}`}
              >
                <Icon name={edited ? 'edit' : 'check'} size={edited ? 17 : 20} strokeWidth={edited ? 2.2 : 3} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] leading-snug font-extrabold break-keep [overflow-wrap:anywhere]">{b.text}</span>
                {b.notice.date !== currentSunday() && (
                  <span className="block text-[13px] font-medium text-white/60">{labelMD(b.notice.date)}</span>
                )}
              </span>
              <Icon name="chevronRight" size={18} className="shrink-0 text-white/50" />
            </button>
            <button
              type="button"
              aria-label="알림 닫기"
              onClick={() => dismiss(b.id)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/60 hover:bg-white/10"
            >
              <Icon name="x" size={16} strokeWidth={2.4} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
