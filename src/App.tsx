import { useEffect } from 'react'
import { useStore, type Tab } from './store'
import { Icon, SyncBadge, Toasts, type IconName } from './components/ui'
import { LoginPage } from './pages/LoginPage'
import { AttendPage } from './pages/AttendPage'
import { ReportPage } from './pages/ReportPage'
import { StatsPage } from './pages/StatsPage'
import { ManagePage } from './pages/ManagePage'
import { CompletionAlerts } from './components/notify/CompletionAlerts'
import { NotifyGate } from './components/notify/NotifyGate'

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'attend', label: '출석', icon: 'users' },
  { id: 'report', label: '보고서', icon: 'doc' },
  { id: 'stats', label: '통계', icon: 'chart' },
  { id: 'manage', label: '관리', icon: 'settings' },
]

export default function App() {
  const authed = useStore((s) => s.authed)
  const booting = useStore((s) => s.booting)
  const bootError = useStore((s) => s.bootError)
  const tab = useStore((s) => s.tab)
  const setTab = useStore((s) => s.setTab)
  const groupId = useStore((s) => s.groupId)
  const openGroup = useStore((s) => s.openGroup)
  const checkSundayRollover = useStore((s) => s.checkSundayRollover)
  const refresh = useStore((s) => s.refresh)

  useEffect(() => {
    void useStore.getState().tryAutoLogin()
  }, [])

  // 주일이 바뀌면 새 출석부로, 앱으로 돌아오면 최신 내용으로
  useEffect(() => {
    if (!authed) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        checkSundayRollover()
        void refresh()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(checkSundayRollover, 60_000)
    // 실시간 알림을 놓쳐도 30초마다 최신 내용을 가져온다
    const poll = setInterval(() => document.visibilityState === 'visible' && void refresh(), 30_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
      clearInterval(poll)
    }
  }, [authed, checkSundayRollover, refresh])

  // 휴대폰 키보드가 올라와 있는 동안만 아래 막대를 숨긴다 (index.css 의 .kb-hide).
  // 입력칸에 초점이 있는지만 보면, 안드로이드에서 뒤로 가기로 키보드만 닫았을 때(초점은 남음) 막대가 계속 숨어 있어서
  // 보이는 화면 높이가 실제로 줄었는지도 함께 본다
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv || !window.matchMedia('(pointer: coarse)').matches) return
    const root = document.documentElement
    let base = vv.height
    let timer = 0
    const typing = () => {
      const el = document.activeElement
      return (
        el instanceof HTMLElement &&
        el.closest('main') !== null &&
        el.matches('textarea, input:not([type=checkbox], [type=radio], [type=file], [type=range], [type=button], [type=submit], [type=date], [type=month])')
      )
    }
    const update = () => {
      const t = typing()
      if (!t) base = Math.max(base, vv.height)
      root.toggleAttribute('data-kb', t && vv.height < base - 120)
    }
    // 초점이 옮겨 가는 중에는 activeElement 가 잠깐 body 라서 한 박자 뒤에 본다
    const later = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(update, 50)
    }
    const onRotate = () => {
      base = 0
      window.setTimeout(() => {
        if (!typing()) base = vv.height
        update()
      }, 400)
    }
    vv.addEventListener('resize', update)
    document.addEventListener('focusin', later)
    document.addEventListener('focusout', later)
    window.addEventListener('orientationchange', onRotate)
    return () => {
      window.clearTimeout(timer)
      vv.removeEventListener('resize', update)
      document.removeEventListener('focusin', later)
      document.removeEventListener('focusout', later)
      window.removeEventListener('orientationchange', onRotate)
      root.removeAttribute('data-kb')
    }
  }, [])

  // 휴대폰 '뒤로 가기'로 목장 화면을 닫을 수 있게
  useEffect(() => {
    if (groupId) {
      // 이미 목장 화면 기록이 있으면(알림으로 다른 목장을 바로 연 경우) 새로 쌓지 않고 바꾼다.
      // 쌓으면 '뒤로'를 두 번 눌러야 목록으로 돌아간다
      if (history.state?.group) history.replaceState({ ...history.state, group: groupId }, '')
      else history.pushState({ group: groupId }, '')
      // 바텀시트를 닫느라 생긴 '뒤로 가기'는 무시하고, 목장 화면 기록이 빠졌을 때만 닫는다
      const onPop = () => {
        if (!history.state?.group) openGroup(null)
      }
      window.addEventListener('popstate', onPop)
      return () => window.removeEventListener('popstate', onPop)
    }
  }, [groupId, openGroup])

  /** 탭을 누를 때: 목장 화면이 열려 있으면 '뒤로 가기' 기록까지 정리하고 닫는다 */
  const goTab = (t: Tab) => {
    if (groupId && (t !== 'attend' || tab === 'attend')) {
      if (history.state?.group) history.back()
      else openGroup(null)
    }
    if (t !== tab) {
      setTab(t)
      // 다른 탭은 맨 위부터 보여 준다 (앞 탭의 스크롤 위치가 남으면 빈 화면처럼 보인다)
      window.scrollTo(0, 0)
    }
  }

  if (!authed)
    return (
      <NotifyGate early>
        <LoginPage />
      </NotifyGate>
    )

  if (booting)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-3">
        <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-line border-t-brand" />
        <p className="text-sm font-medium">출석부를 불러오는 중…</p>
      </div>
    )

  if (bootError)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <p className="font-semibold">{bootError}</p>
        <button className="h-11 rounded-2xl bg-brand px-5 font-semibold text-white" onClick={() => location.reload()}>
          새로고침
        </button>
      </div>
    )

  return (
    <NotifyGate>
      <div className="min-h-full md:flex">
        {/* PC: 왼쪽 메뉴 (태블릿 폭에서는 조금 좁게) */}
        <aside className="no-print sticky top-0 hidden h-dvh w-52 shrink-0 flex-col border-r border-line bg-surface px-3 py-6 md:flex lg:w-60 lg:px-4">
          <div className="mb-8 px-2">
            <img src="./logo-full.png" alt="AM청년회" width={112} height={40} className="h-10 w-auto" />
            <p className="mt-2 text-[13px] font-bold tracking-tight text-ink-3">출석부</p>
          </div>
          <nav className="flex flex-col gap-1" aria-label="메뉴">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => goTab(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
                className={`flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-semibold transition ${
                  tab === t.id ? 'bg-brand text-white' : 'text-ink-2 hover:bg-brand-soft'
                }`}
              >
                <Icon name={t.icon} size={19} />
                {t.label}
              </button>
            ))}
          </nav>
          <div className="mt-auto px-2">
            <SyncBadge />
          </div>
        </aside>

        {/* min-w-0: 넓은 표가 있어도 본문이 화면 밖으로 밀려나지 않게 (표는 자기 칸 안에서 가로 스크롤) */}
        <main className="mx-auto w-full max-w-3xl min-w-0 pt-3 xl:max-w-4xl pr-[max(1rem,env(safe-area-inset-right))] pb-[calc(6.5rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] md:px-8 md:pt-8 md:pb-12">
          {tab === 'attend' && <AttendPage />}
          {tab === 'report' && <ReportPage />}
          {tab === 'stats' && <StatsPage />}
          {tab === 'manage' && <ManagePage />}
        </main>

        {/* 휴대폰: 아래 탭 */}
        <nav
          aria-label="메뉴"
          className="kb-hide no-print safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 shadow-[0_-4px_16px_rgb(16_42_67/0.06)] backdrop-blur-xl md:hidden"
        >
          <div className="mx-auto flex max-w-lg">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => goTab(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
                className={`flex h-16 flex-1 flex-col items-center justify-center gap-1 text-[13px] leading-none transition ${
                  tab === t.id ? 'font-bold text-brand' : 'font-medium text-ink-3'
                }`}
              >
                <span className={`flex h-[30px] w-14 items-center justify-center rounded-full transition ${tab === t.id ? 'bg-brand-soft' : ''}`}>
                  <Icon name={t.icon} size={20} strokeWidth={tab === t.id ? 2.2 : 1.9} />
                </span>
                {t.label}
              </button>
            ))}
          </div>
        </nav>

        <Toasts />
        <CompletionAlerts />
      </div>
    </NotifyGate>
  )
}
