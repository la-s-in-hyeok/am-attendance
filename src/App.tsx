import { useEffect } from 'react'
import { isAttendTab, useStore, type Tab } from './store'
import { Icon, SyncBadge, Toasts, type IconName } from './components/ui'
import { LoginPage } from './pages/LoginPage'
import { AttendPage } from './pages/AttendPage'
import { ReportPage } from './pages/ReportPage'
import { StatsPage } from './pages/StatsPage'
import { CalendarPage } from './pages/CalendarPage'
import { GroupReportPage } from './pages/GroupReportPage'
import { ManagePage } from './pages/ManagePage'
import { CompletionAlerts } from './components/notify/CompletionAlerts'
import { NotifyGate } from './components/notify/NotifyGate'

/** 큰 탭(아래 탭·PC 왼쪽 메뉴). 출석부 안에는 출석·출석보고·통계가 있어요 (AttendSectionTabs) */
type Section = Extract<Tab, 'attend' | 'calendar' | 'groupReport' | 'manage'>

const TABS: { id: Section; label: string; icon: IconName }[] = [
  { id: 'attend', label: '출석부', icon: 'users' },
  { id: 'calendar', label: '캘린더', icon: 'calendar' },
  { id: 'groupReport', label: '목장보고서', icon: 'folder' },
  { id: 'manage', label: '관리', icon: 'settings' },
]

export default function App() {
  const authed = useStore((s) => s.authed)
  const booting = useStore((s) => s.booting)
  const bootError = useStore((s) => s.bootError)
  const tab = useStore((s) => s.tab)
  const attendTab = useStore((s) => s.attendTab)
  const goTab = useStore((s) => s.goTab)
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
  // 보이는 화면 높이가 실제로 줄었는지도 함께 본다.
  // 회의록 에디터처럼 글을 바로 쓰는 칸(contenteditable)도 입력칸으로 친다
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
        (el.isContentEditable ||
          el.matches(
            'textarea, [contenteditable="true"], input:not([type=checkbox], [type=radio], [type=file], [type=range], [type=button], [type=submit], [type=date], [type=month])',
          ))
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

  /** 지금 켜져 있는 큰 탭 (출석·출석보고·통계는 모두 '출석부') */
  const section: Section = isAttendTab(tab) ? 'attend' : tab
  /**
   * 큰 탭을 누를 때: 출석부는 마지막으로 보던 안쪽 탭(출석·출석보고·통계)으로.
   * 목장 화면 닫기·'뒤로 가기' 기록 정리·맨 위로는 store 의 goTab 이 해요
   */
  const goSection = (id: Section) => goTab(id === 'attend' ? attendTab : id)

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
        <p className="text-sm font-medium">불러오는 중…</p>
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
          </div>
          <nav className="flex flex-col gap-1" aria-label="메뉴">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => goSection(t.id)}
                aria-current={section === t.id ? 'page' : undefined}
                className={`flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-semibold whitespace-nowrap transition ${
                  section === t.id ? 'bg-brand text-white' : 'text-ink-2 hover:bg-brand-soft'
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
          {tab === 'calendar' && <CalendarPage />}
          {tab === 'groupReport' && <GroupReportPage />}
          {tab === 'manage' && <ManagePage />}
        </main>

        {/* 휴대폰: 아래 탭 */}
        <nav
          aria-label="메뉴"
          className="kb-hide no-print safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 shadow-[0_-4px_16px_rgb(16_42_67/0.06)] backdrop-blur-xl md:hidden"
        >
          <div className="mx-auto flex max-w-lg">
            {TABS.map((t) => {
              const on = section === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => goSection(t.id)}
                  aria-current={on ? 'page' : undefined}
                  // 4칸이라 320px 폭에서 한 칸이 80px: '목장보고서'도 한 줄에 들어가게 줄바꿈을 막는다
                  className={`flex h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[13px] leading-none tracking-tight whitespace-nowrap transition ${
                    on ? 'font-bold text-brand' : 'font-medium text-ink-3'
                  }`}
                >
                  <span className={`flex h-[30px] w-14 items-center justify-center rounded-full transition ${on ? 'bg-brand-soft' : ''}`}>
                    <Icon name={t.icon} size={20} strokeWidth={on ? 2.2 : 1.9} />
                  </span>
                  {t.label}
                </button>
              )
            })}
          </div>
        </nav>

        <Toasts />
        <CompletionAlerts />
      </div>
    </NotifyGate>
  )
}
