// 앱 화면(HTML·JS·CSS)만 캐시한다. 출석 데이터는 항상 서버에서 받아온다.
const CACHE = 'am-attendance-v5'
self.addEventListener('install', (e) => {
  self.skipWaiting()
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './icon.svg', './manifest.webmanifest'])))
})
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})
// 정상(200)인 같은 주소 응답만 저장해요. 오류·일부 응답(206)·불투명 응답은 저장하지 않아요
const cacheable = (res) => res && res.status === 200 && res.type === 'basic'
// 빌드 파일·글꼴 자리에 HTML 이 오면(없는 파일을 첫 화면으로 돌려주는 서버) 저장하지 않아요.
// 저장해 버리면 그 주소는 계속 고장 난 채로 남아요
const isHtml = (res) => /text\/html/i.test(res.headers.get('content-type') || '')
const save = (e, res) => {
  const copy = res.clone()
  e.waitUntil(caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => undefined))
}
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return
  if (e.request.headers.has('range')) return
  // 이름에 해시가 붙은 빌드 파일(assets/)과 글꼴(fonts/)은 내용이 절대 안 바뀌어요: 캐시 우선
  // (한글 변환 엔진 wasm 약 28MB 도 한 번 받으면 다음부터는 인터넷 없이 써요)
  if (url.pathname.includes('/assets/') || url.pathname.includes('/fonts/')) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((res) => {
            if (cacheable(res) && !isHtml(res)) save(e, res)
            return res
          }),
      ),
    )
    return
  }
  // 나머지는 네트워크 우선, 실패하면 캐시
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (cacheable(res)) save(e, res)
        return res
      })
      .catch(() =>
        caches.match(e.request).then((r) => r || (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())),
      ),
  )
})

// ── 목장 완료 알림 (Web Push: 앱을 꺼 두어도 서버 함수 am-notify 가 보내요) ──
//   payload: { title, body, tag, date, groupId, kind, group, n }
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
    // 안드로이드 위쪽 상태 표시줄의 작은 아이콘: 투명 배경 위 모양만 쓰여요 (불투명 그림이면 흰 네모가 돼요)
    badge: './badge-96.png',
    data: { date: d.date, groupId: d.groupId },
    // 눌러서 확인할 때까지 화면에 남기고(주로 PC), 진동해요 (안드로이드 8 이상은 휴대폰 알림 설정을 따라요)
    requireInteraction: true,
    vibrate: [300, 100, 300, 100, 600],
  }
  if (typeof d.tag === 'string' && d.tag) {
    // 실시간으로 이미 띄운 같은 알림이 있으면 하나로 합쳐요
    options.tag = d.tag
    options.renotify = true
  }
  // 화면 안 알림으로도 보여 줄 수 있는 값 (앱이 확인하고 한 번만 보여 줘요)
  const notice =
    (d.kind === 'done' || d.kind === 'edited') && typeof d.groupId === 'string' && typeof d.date === 'string' && Number.isInteger(d.n)
      ? { kind: d.kind, group: typeof d.group === 'string' ? d.group : '', groupId: d.groupId, date: d.date, n: d.n }
      : null
  e.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((list) => {
        const shown = list.filter((c) => c.visibilityState === 'visible' && c.url.startsWith(self.registration.scope))
        if (shown.length === 0 || !notice) return
        // 앱을 보고 있으면 화면 안 알림을 띄우라고 알려 주고, '소리를 낼 수 있다'는 답이 오면
        // 휴대폰 알림은 조용히 남겨서 두 번 울리지 않게 해요. 답이 없거나 소리를 못 내면 평소처럼 울려요
        const asks = shown.map(
          (c) =>
            new Promise((resolve) => {
              const ch = new MessageChannel()
              const t = setTimeout(() => resolve(false), 700)
              ch.port1.onmessage = (ev) => {
                clearTimeout(t)
                resolve(!!(ev.data && ev.data.sound === true))
              }
              c.postMessage({ type: 'am-notice', notice }, [ch.port2])
            }),
        )
        return Promise.all(asks).then((answers) => {
          if (answers.some(Boolean)) {
            options.silent = true
            delete options.vibrate // silent 와 vibrate 를 같이 주면 알림이 안 떠요
          }
        })
      })
      .catch(() => undefined)
      .then(() => self.registration.showNotification(title, options)),
  )
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
      // 같은 github.io 주소의 다른 페이지가 아니라 출석부 창만 (없으면 새로 열어요)
      const client = list.find((c) => c.url.startsWith(self.registration.scope))
      if (client) {
        if (ok) client.postMessage({ type: 'am-open', groupId: data.groupId, date: data.date })
        if ('focus' in client) return client.focus()
        return undefined
      }
      return self.clients.openWindow(url.href)
    }),
  )
})
