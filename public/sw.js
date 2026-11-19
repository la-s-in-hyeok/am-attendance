// 앱 화면(HTML·JS·CSS)만 캐시한다. 출석 데이터는 항상 서버에서 받아온다.
const CACHE = 'am-attendance-v2'
self.addEventListener('install', (e) => {
  self.skipWaiting()
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './icon.svg', './manifest.webmanifest'])))
})
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return
  // 네트워크 우선, 실패하면 캐시
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(e.request, copy))
        return res
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))),
  )
})

// ── 목장 완료 알림 (Web Push: 앱을 꺼 두어도 서버 함수 am-notify 가 보내요) ──
//   payload: { title, body, tag, date, groupId }
self.addEventListener('push', (e) => {
  let d = {}
  try {
    d = e.data ? e.data.json() : {}
  } catch {
    d = { body: e.data ? e.data.text() : '' }
  }
  const title = typeof d.title === 'string' && d.title ? d.title : 'AM청년회 출석부'
  const options = {
    body: typeof d.body === 'string' ? d.body : '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: { date: d.date, groupId: d.groupId },
  }
  if (typeof d.tag === 'string' && d.tag) {
    // 실시간으로 이미 띄운 같은 알림이 있으면 하나로 합쳐요
    options.tag = d.tag
    options.renotify = true
  }
  e.waitUntil(self.registration.showNotification(title, options))
})

// 알림을 누르면: 열려 있는 앱이 있으면 그 화면으로, 없으면 새로 열어서 그 목장으로
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const data = e.notification.data || {}
  const ok = typeof data.groupId === 'string' && typeof data.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.date)
  const url = new URL('./', self.registration.scope)
  if (ok) {
    url.searchParams.set('open', data.groupId)
    url.searchParams.set('date', data.date)
  }
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
      const client = list.find((c) => c.url.startsWith(self.registration.scope)) || list[0]
      if (client) {
        if (ok) client.postMessage({ type: 'am-open', groupId: data.groupId, date: data.date })
        if ('focus' in client) return client.focus()
        return undefined
      }
      return self.clients.openWindow(url.href)
    }),
  )
})
