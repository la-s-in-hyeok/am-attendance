import type { CompletionNotice, NoticeKind } from './types'
import type { Backend } from '../backend/types'

/**
 * 목장 완료 알림
 * - 문구: "믿음목장 출석체크 완료했습니다" / "믿음목장 수정있어요!!!!!!"
 * - 휴대폰 알림(시스템 알림): 알림을 허용한 기기에서, 앱이 뒤로 가 있을 때
 * - Web Push (기본 설치 단계): VITE_VAPID_PUBLIC_KEY 가 있을 때 켜져요. 앱을 꺼 두어도 서버(supabase/functions/am-notify)가 보내요
 */

export const NOTICE_TITLE = 'AM청년회 출석부'

/** '믿음' → '믿음목장', '믿음목장' → '믿음목장' (두 번 붙이지 않아요), 'Living hope' → 'Living hope 목장' */
export function groupLabel(name: string): string {
  const n = name.trim()
  if (n.endsWith('목장')) return n
  // 영어로 끝나는 이름은 붙여 쓰면 읽기 어려워서 한 칸 띄운다
  return /[A-Za-z0-9]$/.test(n) ? `${n} 목장` : `${n}목장`
}

export function noticeText(kind: NoticeKind, groupName: string): string {
  const g = groupLabel(groupName)
  return kind === 'done' ? `${g} 출석체크 완료했습니다` : `${g} 수정있어요!!!!!!`
}

/** 같은 알림이 실시간·Web Push 로 두 번 와도 휴대폰 알림은 하나만 남도록 (서버 함수와 같은 규칙) */
export function noticeTag(n: Pick<CompletionNotice, 'date' | 'groupId' | 'n'>): string {
  return `am-${n.date}-${n.groupId}-${n.n}`
}

/** 다른 기기에서 온 값 검사 (모양이 이상하면 null) */
export function parseNotice(v: unknown): CompletionNotice | null {
  if (typeof v !== 'object' || v === null) return null
  const r = v as Record<string, unknown>
  const kind = r.kind === 'done' || r.kind === 'edited' ? r.kind : null
  if (!kind) return null
  if (typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return null
  if (typeof r.groupId !== 'string' || r.groupId.length === 0 || r.groupId.length > 64) return null
  const n = typeof r.n === 'number' && Number.isInteger(r.n) && r.n >= 0 ? r.n : kind === 'done' ? 0 : 1
  const group = typeof r.group === 'string' ? r.group.slice(0, 30) : ''
  return { kind, group, groupId: r.groupId, date: r.date, n }
}

/* ───────────── 기기 지원 ───────────── */

const VAPID = String(import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '').trim()
/** Web Push(앱을 꺼 두어도 알림)를 쓰도록 설정했는지 */
export const pushConfigured = VAPID !== ''

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  } catch {
    return false
  }
}

/**
 * 카카오톡·네이버·인스타그램 등 앱 안에서 열린 브라우저.
 * 이런 화면은 알림을 받을 수 없어서 Safari·크롬으로 다시 열어야 해요.
 */
export function inAppBrowser(): 'kakao' | 'other' | null {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent
  if (/KAKAOTALK/i.test(ua)) return 'kakao'
  if (/NAVER\(inapp|Instagram|FBAN|FBAV|FB_IAB|BAND\/|DaumApps|everytimeApp|; wv\)/i.test(ua) || /\bLine\//.test(ua)) return 'other'
  // 아이폰의 텔레그램·X·슬랙 같은 앱 안 화면: Safari 표시(Safari/)가 없다 (홈 화면 앱은 제외)
  if (isIOS() && !isStandalone() && !/Safari\//.test(ua)) return 'other'
  return null
}

/** 휴대폰·태블릿이 아닌 PC */
export function isDesktop(): boolean {
  if (typeof navigator === 'undefined') return false
  return !isIOS() && !/Android|Mobile/i.test(navigator.userAgent)
}

/** 안드로이드에서 이 주소를 크롬으로 바로 여는 주소 (카톡은 카톡 전용 주소) */
export function openInChromeHref(address: string): string | null {
  if (typeof navigator === 'undefined' || !/Android/i.test(navigator.userAgent)) return null
  if (/KAKAOTALK/i.test(navigator.userAgent)) return `kakaotalk://web/openExternal?url=${encodeURIComponent(address)}`
  const u = new URL(address)
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;end`
}

/** ok = 알림을 쓸 수 있음, ios-home = 아이폰은 홈 화면에 추가해야 함, unsupported = 이 브라우저는 안 됨 */
export type NotifySupport = 'ok' | 'ios-home' | 'unsupported'

export function notifySupport(): NotifySupport {
  if (typeof window === 'undefined') return 'unsupported'
  if ('Notification' in window && 'serviceWorker' in navigator) return 'ok'
  if (isIOS() && !isStandalone()) return 'ios-home'
  return 'unsupported'
}

export function notifyPermission(): NotificationPermission | 'unsupported' {
  return notifySupport() === 'ok' ? Notification.permission : 'unsupported'
}

/* ───────────── 이 기기에서 알림 켜기/끄기 ───────────── */

const PREF_KEY = 'am-attendance:notify'

function readPref(): 'on' | 'off' | null {
  try {
    const v = localStorage.getItem(PREF_KEY)
    return v === 'on' || v === 'off' ? v : null
  } catch {
    return null
  }
}

function writePref(v: 'on' | 'off') {
  try {
    localStorage.setItem(PREF_KEY, v)
  } catch {
    /* 무시 */
  }
}

/**
 * 이 기기의 알림 상태 (알림을 켜야만 앱을 쓸 수 있게 막을 때 씀)
 * - on: 켜져 있음
 * - inapp: 카톡 등 앱 안 브라우저 → Safari·크롬으로 다시 열어야 함
 * - ios-home: 아이폰 Safari → 홈 화면에 추가한 앱으로 열어야 함
 * - ios-old: 홈 화면 앱인데 알림이 안 됨 → iOS 16.4 이상으로 업데이트
 * - unsupported: 이 브라우저는 알림이 안 됨
 * - default: 아직 안 켬 (버튼 한 번이면 켜짐)
 * - denied: 설정에서 막혀 있음 → 설정에서 다시 허용
 */
export type NotifyStatus = 'on' | 'inapp' | 'ios-home' | 'ios-old' | 'unsupported' | 'default' | 'denied'

export function notifyStatus(): NotifyStatus {
  if (inAppBrowser()) return 'inapp'
  const sup = notifySupport()
  if (sup === 'ios-home') return 'ios-home'
  if (sup === 'unsupported') return isIOS() && isStandalone() ? 'ios-old' : 'unsupported'
  const p = Notification.permission
  if (p === 'denied') return 'denied'
  if (p === 'granted' && readPref() !== 'off') return 'on'
  return 'default'
}

/** 이 기기에서 휴대폰 알림을 받는지 (허용돼 있고, 끄지 않았으면) */
export function systemNotifyOn(): boolean {
  if (notifyPermission() !== 'granted') return false
  return readPref() !== 'off'
}

export type EnableResult = 'on' | 'denied' | 'default' | NotifySupport

/** 알림 허용 묻기 → 켜기 (Web Push 가 설정돼 있으면 구독까지) */
export async function enableNotifications(backend: Backend): Promise<EnableResult> {
  const sup = notifySupport()
  if (sup !== 'ok') return sup
  let p = Notification.permission
  if (p === 'default') {
    try {
      const asked: NotificationPermission | undefined = await Notification.requestPermission()
      p = asked ?? Notification.permission
    } catch {
      // 아주 옛 사파리: 콜백 방식
      p = await new Promise<NotificationPermission>((resolve) => {
        void Notification.requestPermission(resolve)
      })
    }
  }
  if (p !== 'granted') return p
  writePref('on')
  await syncPush(backend).catch(() => false)
  return 'on'
}

export async function disableNotifications(backend: Backend): Promise<void> {
  writePref('off')
  await unsubscribePush(backend).catch(() => undefined)
}

/* ───────────── 서비스 워커 ───────────── */

function sleep(ms: number) {
  return new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))
}

/** 켜져 있는 서비스 워커 (개발 서버처럼 없으면 null) */
async function registration(waitMs = 3000): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  try {
    const r = await navigator.serviceWorker.getRegistration()
    if (r?.active) return r
    if (!r) return null
    return await Promise.race([navigator.serviceWorker.ready, sleep(waitMs)])
  } catch {
    return null
  }
}

/** 휴대폰 알림 띄우기 (허용·켜짐일 때만). tag 가 같으면 하나로 합쳐져요 */
export async function showSystemNotice(notice: CompletionNotice, body: string): Promise<void> {
  if (!systemNotifyOn()) return
  const options = {
    body,
    tag: noticeTag(notice),
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: { url: './', date: notice.date, groupId: notice.groupId },
    // 눌러서 확인할 때까지 화면에 남기고(주로 PC), 같은 알림이어도 다시 울리게.
    // 진동은 안드로이드 8 이상에서는 휴대폰의 알림 채널 설정을 따라요
    requireInteraction: true,
    renotify: true,
    vibrate: [300, 100, 300, 100, 600],
  } as NotificationOptions & { renotify: boolean; vibrate: number[] }
  try {
    const reg = await registration(1500)
    if (reg) {
      await reg.showNotification(NOTICE_TITLE, options)
      return
    }
    new Notification(NOTICE_TITLE, options)
  } catch {
    /* 안드로이드 크롬은 서비스 워커 없이는 알림을 못 띄워요. 화면 안 알림은 그대로 나와요 */
  }
}

/* ───────────── Web Push (앱을 꺼 두어도 받는 알림) ───────────── */

function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function sameKey(sub: PushSubscription, key: Uint8Array): boolean {
  const k = sub.options?.applicationServerKey
  if (!k) return false
  const a = new Uint8Array(k)
  return a.length === key.length && a.every((x, i) => x === key[i])
}

let syncedEndpoint: string | null = null

/**
 * 알림이 켜져 있으면 이 기기를 Web Push 받는 목록에 올려요 (앱을 열 때마다 한 번).
 * VITE_VAPID_PUBLIC_KEY 가 없거나 체험 모드면 아무 일도 안 해요. 올렸으면 true
 */
export async function syncPush(backend: Backend): Promise<boolean> {
  if (!pushConfigured || backend.mode !== 'cloud' || !systemNotifyOn()) return false
  const reg = await registration()
  if (!reg || !('pushManager' in reg)) return false
  const key = base64UrlToBytes(VAPID)
  let sub = await reg.pushManager.getSubscription()
  if (sub && !sameKey(sub, key)) {
    // 서버 열쇠(VAPID)를 바꿨으면 새로 받아요
    await sub.unsubscribe().catch(() => false)
    sub = null
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  const json = sub.toJSON()
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (!json.endpoint || !p256dh || !auth) return false
  if (syncedEndpoint !== json.endpoint) {
    await backend.savePushSubscription({ endpoint: json.endpoint, keys: { p256dh, auth } })
    syncedEndpoint = json.endpoint
  }
  return true
}

async function unsubscribePush(backend: Backend): Promise<void> {
  if (!pushConfigured) return
  const reg = await registration(1000)
  const sub = await reg?.pushManager?.getSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe().catch(() => false)
  syncedEndpoint = null
  await backend.deletePushSubscription(endpoint)
}

/** 이 기기의 Web Push 주소 (내가 보낸 알림이 내게 오지 않도록). 없으면 null */
export async function currentPushEndpoint(): Promise<string | null> {
  if (!pushConfigured || !systemNotifyOn()) return null
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    const sub = await reg?.pushManager?.getSubscription()
    return sub?.endpoint ?? null
  } catch {
    return null
  }
}
