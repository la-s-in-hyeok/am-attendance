import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useStore } from '../../store'
import {
  enableNotifications,
  inAppBrowser,
  isAndroid,
  isDesktop,
  isIOS,
  isSamsungBrowser,
  isStandalone,
  notifyStatus,
  openInChromeHref,
  pushConfigured,
  syncPush,
  type NotifyStatus,
} from '../../lib/push'
import { Button } from '../ui'

/**
 * 알림을 켜야만 출석부를 쓸 수 있게 막는 화면.
 * - 서버 연결 버전에서만 (체험판은 알림이 없어서 막지 않아요)
 * - 앱을 열 때, 앱으로 돌아올 때마다 다시 검사해요 (휴대폰 설정에서 꺼도 다시 막혀요)
 * - 막혀 있는 동안에는 알림을 켜는 데 필요한 것 말고는 아무 버튼도 없어요
 * 휴대폰 설정에서 알림을 끄는 것 자체는 어떤 앱도 막을 수 없어서, 대신 앱을 쓰지 못하게 해요.
 *
 * early: 로그인 화면 앞에서 쓸 때. 로그인 없이도 알 수 있는 상태(카톡 안 화면, 아이폰 Safari)만 막아서
 * 로그인을 두 번 하지 않게 해요 (홈 화면 앱은 Safari 와 저장소가 따로라서).
 */
export function NotifyGate({ children, early = false }: { children: ReactNode; early?: boolean }) {
  const mode = useStore((s) => s.backend.mode)
  const backend = useStore((s) => s.backend)
  const [status, setStatus] = useState<NotifyStatus>(() => notifyStatus())
  const [pushOk, setPushOk] = useState<boolean | null>(null)

  const recheck = useCallback(() => setStatus(notifyStatus()), [])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') recheck()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', recheck)
    // 브라우저가 알려 주면 권한이 바뀌는 즉시 다시 검사
    let alive = true
    let perm: PermissionStatus | null = null
    navigator.permissions
      ?.query({ name: 'notifications' as PermissionName })
      .then((p) => {
        if (!alive) return
        perm = p
        p.onchange = recheck
      })
      .catch(() => undefined)
    // 그 밖의 경우를 위해 잠깐마다 한 번씩
    const timer = setInterval(recheck, 3000)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', recheck)
      if (perm) perm.onchange = null
      clearInterval(timer)
    }
  }, [recheck])

  // 알림이 켜져 있으면, 앱을 꺼 두어도 알림이 오도록 서버 등록이 됐는지 확인
  const register = useCallback(() => {
    if (early || mode !== 'cloud' || !pushConfigured) return
    void syncPush(backend)
      .then(setPushOk)
      .catch(() => setPushOk(false))
  }, [backend, early, mode])
  useEffect(() => {
    if (status === 'on') register()
  }, [status, register])

  if (mode !== 'cloud') return <>{children}</>
  if (early) {
    if (status === 'inapp' || status === 'ios-home') return <GateScreen status={status} onChanged={recheck} />
    return <>{children}</>
  }
  if (status !== 'on') return <GateScreen status={status} onChanged={recheck} />
  return (
    <>
      {pushOk === false && (
        <div className="no-print safe-top fixed inset-x-0 top-0 z-[70] bg-danger text-white">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-2.5 text-[14px] font-semibold">
            <span className="min-w-0 flex-1">알림 등록이 안 됐어요. 앱을 꺼 두면 알림이 안 올 수 있어요.</span>
            <button type="button" onClick={register} className="h-9 shrink-0 rounded-xl bg-white/20 px-3 font-bold">
              다시 등록
            </button>
          </div>
        </div>
      )}
      {children}
    </>
  )
}

export function GateScreen({ status, onChanged }: { status: NotifyStatus; onChanged: () => void }) {
  const backend = useStore((s) => s.backend)
  const [busy, setBusy] = useState(false)
  const [slow, setSlow] = useState(false)
  const [copy, setCopy] = useState<'idle' | 'done' | 'failed'>('idle')
  const address = location.origin + location.pathname

  const turnOn = async () => {
    setBusy(true)
    setSlow(false)
    // 크롬의 '조용한 권한 요청'처럼 창이 안 뜨고 기다리기만 하는 경우 안내
    const t = setTimeout(() => {
      setSlow(true)
      setBusy(false)
    }, 10_000)
    try {
      // 허용 창이 저절로 사라졌거나(크롬 155 이상 안드로이드) 휴대폰 창에서 거절해 '아직 안 정함'으로 끝나면 바로 안내
      const r = await enableNotifications(backend)
      if (r === 'default') setSlow(true)
    } finally {
      clearTimeout(t)
      setBusy(false)
      onChanged()
    }
  }

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopy('done')
      setTimeout(() => setCopy('idle'), 2000)
    } catch {
      setCopy('failed')
    }
  }

  const ios = isIOS()
  const desktop = isDesktop()
  const android = isAndroid()
  const samsung = isSamsungBrowser()
  const kakao = inAppBrowser() === 'kakao'
  const chromeHref = openInChromeHref(address)

  let title = '알림을 켜야 출석부를 쓸 수 있어요'
  let body: ReactNode = null
  let action: ReactNode = null

  if (status === 'default') {
    body = <p>목장이 출석체크를 완료하면 모두에게 알림이 가요. 알림을 켜면 바로 쓸 수 있어요.</p>
    action = (
      <div className="space-y-3">
        <Button variant="yellow" size="lg" className="w-full" disabled={busy} onClick={() => void turnOn()}>
          {busy ? '켜는 중…' : slow ? '🔔 다시 알림 켜기' : '🔔 알림 켜기'}
        </Button>
        {slow && (
          <p className="text-[14px] leading-relaxed text-ink-2">
            {android
              ? `허용 창이 안 보였거나 금방 사라졌으면 버튼을 다시 누르고 ‘허용’을 눌러 주세요. ‘○○에서 알림을 보내도록 허용’ 하는 휴대폰 창이 뜨면 그것도 ‘허용’을 눌러 주세요. 아래쪽에 ‘알림 차단됨’ 메시지만 뜨면 그 메시지의 ‘관리’를 눌러 ‘허용’을 골라 주세요.`
              : ios
                ? '허용 창이 뜨면 ‘허용’을 눌러 주세요. 창이 안 뜨면 버튼을 다시 눌러 주세요.'
                : '허용 창이 안 보이면 주소창 왼쪽의 종(🔔)이나 설정 아이콘을 눌러 알림을 ‘허용’으로 바꿔 주세요.'}
          </p>
        )}
      </div>
    )
  } else if (status === 'denied') {
    title = '알림이 꺼져 있어요'
    body = (
      <>
        <p>이 기기에서 알림을 막아 두었어요. 아래처럼 다시 허용한 뒤 이 화면으로 돌아오면 바로 열려요.</p>
        {ios ? (
          <>
            <Steps items={['설정 앱 열기', '알림 → AM 출석부', '‘알림 허용’ 켜기']} />
            <p className="text-[14px] text-ink-3">그래도 안 되면 홈 화면의 AM 출석부 아이콘을 지우고, Safari에서 다시 ‘홈 화면에 추가’ 해 주세요.</p>
          </>
        ) : desktop ? (
          <>
            <Steps items={['주소창 왼쪽의 자물쇠(또는 설정) 아이콘 누르기', '알림 → ‘허용’으로 바꾸기', '이 화면으로 돌아오기']} />
            <p className="text-[14px] text-ink-3">시크릿(비공개) 창에서는 알림을 켤 수 없어요. 일반 창으로 열어 주세요.</p>
          </>
        ) : samsung ? (
          <>
            <Steps
              items={[
                '휴대폰 설정 → 애플리케이션 → 삼성 인터넷 → 알림 → ‘알림 허용’ 켜기',
                '삼성 인터넷 아래쪽 ≡ → 설정 → 사이트 및 다운로드 → 사이트 알림에서 이 주소를 ‘허용’으로',
                '이 화면으로 돌아오기',
              ]}
            />
            <AndroidNote standalone={isStandalone()} />
          </>
        ) : android && isStandalone() ? (
          <>
            <Steps items={['홈 화면의 AM 출석부 아이콘을 길게 누르기', '앱 정보(ⓘ) → 알림 → ‘알림 허용’ 켜기', '이 화면으로 돌아오기']} />
            <AndroidNote standalone />
          </>
        ) : (
          <>
            <Steps
              items={[
                '휴대폰 설정 → 애플리케이션 → Chrome(쓰는 브라우저) → 알림 → ‘알림 허용’ 켜기',
                '크롬 주소창 왼쪽 아이콘 → 권한(또는 사이트 설정) → 알림 → ‘허용’',
                '이 화면으로 돌아오기',
              ]}
            />
            <AndroidNote standalone={false} />
          </>
        )}
      </>
    )
    action = (
      <Button variant="secondary" size="lg" className="w-full" onClick={onChanged}>
        다시 확인
      </Button>
    )
  } else if (status === 'inapp') {
    title = kakao ? '카카오톡 안에서 열렸어요' : '앱 안에서 열린 화면이에요'
    body = (
      <>
        <p>여기서는 알림을 받을 수 없어요. {ios ? 'Safari로' : '크롬이나 삼성 인터넷으로'} 다시 열어 주세요.</p>
        {ios && (
          <Steps
            items={[
              kakao ? '오른쪽 아래 공유(⬆︎) 또는 ··· 누르기' : '··· 또는 공유 버튼 누르기',
              '‘Safari로 열기’ 누르기',
              'Safari에서 공유(⬆︎) → 홈 화면에 추가',
            ]}
          />
        )}
      </>
    )
    action = (
      <div className="space-y-3">
        {chromeHref && (
          <a
            href={chromeHref}
            className="flex h-14 w-full items-center justify-center rounded-2xl bg-brand text-[17px] font-semibold text-white shadow-[0_4px_12px_rgb(10_114_180/0.25)] transition hover:bg-brand-deep active:bg-brand-deep"
          >
            {/* 카톡은 휴대폰의 기본 브라우저(갤럭시는 대개 삼성 인터넷)로 열어요 */}
            {kakao ? '다른 브라우저로 열기' : '크롬으로 열기'}
          </a>
        )}
        {!ios && (
          <>
            {chromeHref && <p className="pt-1 text-[14px] font-semibold text-ink-3">버튼이 안 되면</p>}
            <Steps
              items={[
                '오른쪽 위(또는 아래) ⋮ 누르기',
                kakao ? '‘다른 브라우저로 열기’ 누르기' : '‘다른 브라우저로 열기’ · ‘외부 브라우저로 열기’ · ‘Chrome으로 열기’ 같은 메뉴 누르기',
              ]}
            />
          </>
        )}
        <CopyAddress address={address} copy={copy} onCopy={() => void doCopy()} />
      </div>
    )
  } else if (status === 'ios-home') {
    title = '홈 화면에 추가해 주세요'
    body = (
      <>
        <p>아이폰은 홈 화면에 추가한 앱에서만 알림을 받을 수 있어요.</p>
        <Steps items={['아래쪽 공유(⬆︎) 누르기 (안 보이면 ··· 안에 있어요)', '‘홈 화면에 추가’ 누르기', '홈 화면의 AM 출석부 아이콘으로 열고 로그인']} />
      </>
    )
  } else if (status === 'ios-old') {
    title = '아이폰을 업데이트해 주세요'
    body = <p>알림은 iOS 16.4 이상에서 받을 수 있어요. 설정 → 일반 → 소프트웨어 업데이트에서 업데이트한 뒤 다시 열어 주세요.</p>
  } else {
    title = '이 브라우저는 알림을 받을 수 없어요'
    body = <p>{ios ? '아이폰은 Safari로' : desktop ? 'PC는 크롬이나 엣지로' : '휴대폰은 크롬이나 삼성 인터넷으로'} 열어 주세요.</p>
    action = <CopyAddress address={address} copy={copy} onCopy={() => void doCopy()} />
  }

  return (
    <div className="safe-top safe-bottom flex min-h-full flex-col items-center bg-bg px-5">
      <div className="flex w-full max-w-md flex-1 flex-col justify-center gap-6 py-10">
        <img src="./logo-full.png" alt="AM청년회" width={124} height={44} className="h-11 w-auto self-start" />
        <div className="space-y-3">
          <h1 className="text-[26px] leading-snug font-extrabold tracking-tight">{title}</h1>
          <div className="space-y-4 text-[16px] leading-relaxed text-ink-2">{body}</div>
        </div>
        {action}
      </div>
    </div>
  )
}

/** 안드로이드 알림 안내 끝에 붙는 말 */
function AndroidNote({ standalone }: { standalone: boolean }) {
  return (
    <p className="text-[14px] leading-relaxed text-ink-3">
      {standalone
        ? '켰는데도 안 열리면 최근 앱 화면에서 AM 출석부를 위로 밀어 완전히 닫고 다시 열어 주세요.'
        : '비밀 모드(시크릿 탭)에서는 알림을 켤 수 없어요. 일반 탭으로 열어 주세요.'}
    </p>
  )
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="space-y-2.5 rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]">
      {items.map((s, i) => (
        <li key={s} className="flex gap-3 text-[15px] leading-relaxed text-ink">
          <span className="tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-[13px] font-bold text-white">
            {i + 1}
          </span>
          <span className="min-w-0">{s}</span>
        </li>
      ))}
    </ol>
  )
}

function CopyAddress({ address, copy, onCopy }: { address: string; copy: 'idle' | 'done' | 'failed'; onCopy: () => void }) {
  return (
    <div className="space-y-2">
      <p className="rounded-2xl border border-line bg-surface px-4 py-3 font-mono text-[14px] break-all text-ink select-all">{address}</p>
      <Button variant="secondary" size="lg" className="w-full" onClick={onCopy}>
        {copy === 'done' ? '복사했어요' : '주소 복사'}
      </Button>
      {copy === 'failed' && <p className="text-[14px] text-ink-3">복사가 안 되면 위 주소를 길게 눌러 복사해 주세요.</p>}
    </div>
  )
}
