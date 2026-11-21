// 앱 화면(HTML·JS·CSS)만 캐시한다. 출석 데이터는 항상 서버에서 받아온다.
const CACHE = 'am-attendance-v5'
// 첫 화면(index.html)은 한 이름으로만 저장해요. 오프라인·느린 인터넷일 때 이걸 보여 줘요
const INDEX = new URL('./index.html', self.registration.scope).href
// 바로 앞 버전의 첫 화면 (새 버전이 올라온 뒤에도 열려 있던 예전 화면이 쓰는 파일을 남겨 두려고)
const PREV_INDEX = new URL('./__am-prev-index.html', self.registration.scope).href
// 느린 인터넷: 첫 화면을 이만큼 기다려도 안 오면 저장해 둔 화면을 먼저 보여 줘요 (받은 새 화면은 다음에 써요)
const NAVIGATE_WAIT_MS = 4000
// 지금 버전 화면이 바로 안 열릴 때(아직 안 열어 본 새 화면)는 이때까지 기다려요. 그래도 안 오면(응답 없이 걸린 인터넷) 앞 버전 화면을 보여 줘요
const PREV_WAIT_MS = 12000
// 앞 버전 화면에 붙이는 '잠시 맡아 둠' 표시. 예전 서비스 워커에서 처음 넘어올 때 오프라인용으로만 남긴 것이라,
// 이 표시가 있는 동안은 예전 파일을 정리하지 않아요.
// (첫 화면 요청으로 지금 저장된 것과 다른 새 버전을 받으면 풀어요. 서비스 워커 설치는 표시를 그대로 이어 가요)
const HOLD = 'x-am-hold'
/** 저장할 첫 화면 응답 (hold 면 '잠시 맡아 둠' 표시를 붙여요) */
const pageOf = (text, hold = false) =>
  new Response(text, { headers: hold ? { 'content-type': 'text/html; charset=utf-8', [HOLD]: '1' } : { 'content-type': 'text/html; charset=utf-8' } })

// 첫 화면 저장과 예전 파일 정리는 한 번에 하나씩만 해요 (둘이 겹치면 지금 쓰는 파일을 지울 수 있어요)
let lock = Promise.resolve()
const locked = (fn) => {
  const run = lock.then(fn, fn)
  lock = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}
const textOf = async (cache, key) => {
  const r = await cache.match(key)
  return r ? r.text() : null
}

self.addEventListener('install', (e) => {
  self.skipWaiting()
  // 서버에서 새로 받고, 브라우저 HTTP 캐시는 읽지도 쓰지도 않아요
  // (옛 첫 화면이 저장되면 지금 쓰는 파일을 정리해 버릴 수 있고, 받아 두기만 한 새 화면이 HTTP 캐시에 남으면 예전 서비스 워커가 그걸 띄울 수 있어요)
  const fresh = ['./', './index.html', './icon.svg', './manifest.webmanifest'].map((u) => new Request(u, { cache: 'no-store' }))
  e.waitUntil(
    locked(async () => {
      const c = await caches.open(CACHE)
      // 먼저 본문까지 다 받기만 해요. 하나라도 실패하면(받는 도중 끊김 포함) 아무것도 쓰기 전에 설치를 그만둬요
      const got = await Promise.all(fresh.map((r) => fetch(r)))
      if (got.some((r) => !r.ok)) throw new TypeError('설치에 필요한 파일을 받지 못했어요')
      const bodies = await Promise.all(got.map((r) => r.clone().arrayBuffer()))
      const newText = new TextDecoder().decode(bodies[1])
      // 앞 버전 첫 화면을 새 첫 화면보다 먼저 저장해요 (중간에 끊겨도 바로 열리는 화면을 잃지 않게).
      // 앞 버전을 못 정하거나(첫 읽기 실패는 다음 후보로 넘어가요) 저장이 실패하면 설치도 실패해요. 새 첫 화면은 아직 안 썼으니 다음 업데이트 확인 때 처음부터 다시 해요
      const prev = await prevForInstall(c, newText)
      if (prev) await c.put(PREV_INDEX, pageOf(prev.text, prev.hold))
      // 아이콘·manifest 를 먼저, 첫 화면은 맨 끝에 index.html → './' 순서로 써요.
      // 중간에 끊겨 예전 서비스 워커가 계속 쓰이더라도, 그쪽이 오프라인에서 주로 쓰는 './'(홈 화면 아이콘 주소)는 될 수 있는 한 예전 그대로 남게요
      // (대신 그 짧은 틈에는 index.html·저장 안 된 ?open= 주소 쪽이 새 화면이 될 수 있어요)
      await c.put(fresh[2], got[2])
      await c.put(fresh[3], got[3])
      await c.put(fresh[1], got[1])
      await c.put(fresh[0], got[0])
    }),
  )
})

/**
 * 설치할 때 앞 버전 자리에 둘 첫 화면을 골라요. 바꿀 필요가 없으면 null
 * - 이 방식을 쓰던 중(앞 버전 자리가 있음): 덮어쓸 지금 화면(표시가 있으면 './' 를 먼저 봐요). 다만 그게 한 번도 안 열렸고 지금 앞 버전이 바로 열리면 앞 버전 그대로예요.
 *   '잠시 맡아 둠' 표시는 그대로 이어 가요 (표시는 다음 내용 배포를 첫 화면 요청으로 받을 때 풀려요)
 * - 예전 서비스 워커에서 처음 넘어올 때: 새 화면이 이미 바로 열리면 필요 없어요. 아니면 예전 서비스 워커가 저장한 화면('./', index.html, ?open= 주소)
 *   가운데 바로 열리는 것을 남겨 오프라인에서 흰 화면이 안 되게 해요. 지금 열린 화면보다 오래됐을 수 있어서 정리는 다음 새 버전 때까지 미뤄요(hold)
 */
async function prevForInstall(c, newText) {
  const root = new URL('./', self.registration.scope).href
  const had = await c.match(PREV_INDEX)
  if (had) {
    // '잠시 맡아 둠' 표시가 남아 있으면 처음 넘어오는 설치가 끊겼을 수 있어요 (예전 서비스 워커가 아직 쓰이고, './' 가 더 새것).
    // 그럴 때는 './' 를 먼저 보고 표시도 그대로 둬요
    const held = !!had.headers.get(HOLD)
    const [first, second] = held ? [root, INDEX] : [INDEX, root]
    // 첫 읽기가 계속 실패해도(저장소 손상) 설치가 영영 막히지 않게 다음 후보로 넘어가요 (설치가 그 자리를 새로 써서 나아요)
    const oldText = (await textOf(c, first).catch(() => null)) ?? (await textOf(c, second))
    if (!oldText || oldText === newText) return null
    const text = (await keepPrev(c, oldText)) ? await textOf(c, PREV_INDEX) : oldText
    return text === null ? null : { text, hold: held }
  }
  if (await opens(c, newText)) return null
  const pages = (await c.keys()).map((req) => new URL(req.url)).filter((u) => u.search !== '' && isAppPage(u))
  for (const key of [root, INDEX, ...pages.map((u) => u.href)]) {
    const text = await textOf(c, key)
    if (text && text !== newText && (await opens(c, text))) return { text, hold: true }
  }
  return null
}
// 예전 버전 파일 정리를 아직 못 했는지 (활성화 직후에 하고, 못 끝냈으면 다음 첫 화면 요청 때 해요)
let prunePending = false
const pruneQuietly = () =>
  locked(() => dropOldPages().then(() => pruneAssets()))
    .then((done) => {
      // 건너뛰었으면(새 화면 파일을 아직 못 받음 등) 다음 첫 화면 요청 때 다시 해요
      if (done) prunePending = false
    })
    .catch(() => undefined)
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .catch(() => undefined),
  )
  // 정리는 활성화가 끝난 뒤에 따로 해요. 활성화하는 동안에는 모든 요청이 기다리기 때문이에요
  prunePending = true
  sleep(3000).then(pruneQuietly)
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fileName = (url) => new URL(url).pathname.split('/').pop() || ''
const isCode = (name) => /\.(m?js|css)$/i.test(name)
// 빌드 파일 이름 (이름-해시.확장자)
const BUILT = /[\w.$-]+-[\w$-]{8}\.(?:m?js|css|wasm)\b/g

/** index.html 이 직접 부르는 빌드 파일 이름들 */
function indexRefs(text, base) {
  const out = new Set()
  for (const m of text.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const u = new URL(m[1], base)
      if (u.origin === self.location.origin && u.pathname.includes('/assets/')) out.add(fileName(u.href))
    } catch {
      // 이상한 주소는 건너뛰어요
    }
  }
  return out
}

/** 이 첫 화면이 바로 열리는지 (그 화면이 바로 부르는 JS·CSS 가 다 저장돼 있는지) */
async function opens(cache, text) {
  if (!text) return false
  const saved = new Set()
  for (const req of await cache.keys()) if (new URL(req.url).pathname.includes('/assets/')) saved.add(fileName(req.url))
  const direct = indexRefs(text, INDEX)
  return direct.size > 0 && [...direct].every((n) => !isCode(n) || saved.has(n))
}
/**
 * 앞 버전 자리를 그대로 둘지: 덮어쓸 화면이 한 번도 안 열렸고 지금 앞 버전은 바로 열리면 그대로 둬요.
 * (안 열린 화면 둘만 남으면 오프라인·응답 없는 인터넷에서 흰 화면이 돼요)
 */
const keepPrev = async (cache, oldText) => !(await opens(cache, oldText)) && (await opens(cache, await textOf(cache, PREV_INDEX)))

/**
 * 저장해 둔 빌드 파일(assets/) 가운데 지금 첫 화면(과 바로 앞 버전 첫 화면)이 쓰지 않는 것을 지워요.
 * 첫 화면 → 그 화면이 부르는 JS·CSS → 그 안에 이름이 나오는 파일 … 을 따라가며 쓰는 파일을 모아요.
 * - 지금 첫 화면이 직접 부르는 파일이 아직 저장돼 있지 않으면(새 버전을 막 받았을 때) 다음에 해요
 * - 따라가다 저장 안 된 JS 가 있으면 그 아래를 몰라서, 큰 한글 엔진(wasm)은 지우지 않아요
 * - 글꼴(fonts/)은 건드리지 않아요
 * - 앞 버전 첫 화면을 아직 모르면(이 서비스 워커로 처음 바뀐 직후) 지우지 않고 다음 새 버전 때 해요.
 *   예전 화면이 열려 있을 수 있는데 그 화면이 쓰는 파일을 알 수 없어서예요
 * 정리를 끝냈으면 true, 다음으로 미뤘으면 false
 */
async function pruneAssets() {
  const cache = await caches.open(CACHE)
  const cur = await cache.match(INDEX)
  if (!cur) return false
  const prev = await cache.match(PREV_INDEX)
  // 앞 버전을 모르거나, 처음 넘어올 때 잠시 맡아 둔 앞 버전(hold)이면 지우지 않아요
  if (!prev || prev.headers.get(HOLD)) return false
  const texts = [await cur.text(), await prev.text()]
  const assets = new Map()
  for (const req of await cache.keys()) {
    if (new URL(req.url).pathname.includes('/assets/')) assets.set(fileName(req.url), req)
  }
  if (assets.size === 0) return true
  const keep = new Set()
  let unknown = false
  const queue = []
  const visit = (name) => {
    if (!name || keep.has(name)) return
    keep.add(name)
    if (assets.has(name)) queue.push(name)
    else if (isCode(name)) unknown = true
  }
  const direct = indexRefs(texts[0], INDEX)
  // 엉뚱한 화면(오류 화면 등)이거나 새 화면의 파일을 아직 안 받았으면 지우지 않아요
  if (direct.size === 0 || [...direct].some((n) => isCode(n) && !assets.has(n))) return false
  for (const t of texts) for (const n of indexRefs(t, INDEX)) visit(n)
  while (queue.length) {
    const name = queue.pop()
    if (!isCode(name)) continue
    const res = await cache.match(assets.get(name))
    if (!res) {
      unknown = true
      continue
    }
    const text = await res.text()
    for (const n of assets.keys()) if (!keep.has(n) && text.includes(n)) visit(n)
    for (const m of text.matchAll(BUILT)) if (!keep.has(m[0])) visit(m[0])
  }
  // wasm 은 크니까(한글 엔진 약 28MB) 모를 때는 남겨요. 다만 같은 이름의 새 wasm 을 쓰는 게 확실하면 예전 것은 지워요
  const stem = (name) => name.replace(/-[\w$-]{8}\.wasm$/i, '')
  const usedWasm = new Set([...keep].filter((n) => /\.wasm$/i.test(n) && assets.has(n)).map(stem))
  const removable = (name) => !keep.has(name) && (!/\.wasm$/i.test(name) || !unknown || usedWasm.has(stem(name)))
  await Promise.all([...assets].filter(([name]) => removable(name)).map(([, req]) => cache.delete(req)))
  return true
}

/** 예전 서비스 워커가 주소마다 따로 저장한 첫 화면(예: ?open=…)을 지워요. 이제는 한 이름(INDEX)으로만 저장해요 */
async function dropOldPages() {
  const cache = await caches.open(CACHE)
  const old = (await cache.keys()).filter((req) => {
    const u = new URL(req.url)
    return u.search !== '' && isAppPage(u)
  })
  await Promise.all(old.map((req) => cache.delete(req)))
}

/** 받은 첫 화면을 저장해요. 내용이 바뀌었으면(새 버전) 앞 버전을 따로 남기고, 잠시 뒤 안 쓰는 파일을 정리해요 */
async function storeIndex(res) {
  const text = await res.text()
  const type = res.headers.get('content-type') || 'text/html; charset=utf-8'
  const changed = await locked(async () => {
    const cache = await caches.open(CACHE)
    const oldText = await textOf(cache, INDEX)
    const isNew = oldText !== null && oldText !== text
    // 앞 버전을 먼저 남겨요 (중간에 멈춰도 다음 요청 때 다시 맞춰져요).
    // 앞 버전을 그대로 둘 때도 다시 저장해서 '잠시 맡아 둠' 표시를 풀어요 (새 버전이 왔으니 이제 정리해도 돼요)
    if (isNew) {
      const prevText = (await keepPrev(cache, oldText)) ? await textOf(cache, PREV_INDEX) : oldText
      if (prevText !== null) await cache.put(PREV_INDEX, pageOf(prevText))
    }
    // 새 Response 로 저장해요 (주소가 바뀐(redirect) 응답을 그대로 저장하면 나중에 첫 화면으로 못 써요)
    const fresh = () => new Response(text, { status: 200, headers: { 'content-type': type } })
    await cache.put(INDEX, fresh())
    await cache.put(new URL('./', self.registration.scope).href, fresh())
    return isNew
  })
  if (!changed) return
  // 새 화면이 자기 파일을 받아 저장할 시간을 주고 정리해요. 그때도 못 하면 다음 첫 화면 요청 때 다시 해요
  await sleep(15000)
  if (!(await locked(pruneAssets))) prunePending = true
}

/**
 * 저장해 둔 첫 화면 가운데 바로 열리는 것(그 화면이 바로 부르는 JS·CSS 가 다 저장돼 있는 것)을 keys 순서대로 찾아요.
 * 느린 인터넷 때 받아 두기만 한 새 화면, 설치 때 서버에서 새로 받은 화면은 아직 한 번도 안 열려서 그 파일이 없을 수 있어요.
 * 그런 화면을 띄우면 오프라인에서는 흰 화면, 그 사이 또 새 버전이 올라왔으면 온라인에서도 흰 화면(없는 파일)이 돼요
 */
async function readyPage(keys) {
  const cache = await caches.open(CACHE)
  const saved = new Set()
  for (const req of await cache.keys()) {
    if (new URL(req.url).pathname.includes('/assets/')) saved.add(fileName(req.url))
  }
  for (const key of keys) {
    const r = await cache.match(key)
    if (!r) continue
    const direct = indexRefs(await r.clone().text(), INDEX)
    if (direct.size > 0 && [...direct].every((n) => !isCode(n) || saved.has(n))) return r
  }
  return null
}

/** 오프라인일 때 보여 줄 첫 화면: 바로 열리는 지금 버전 → 바로 열리는 앞 버전 → (둘 다 아니면) 예전처럼 지금 버전 */
const cachedPage = (req) =>
  readyPage([INDEX, PREV_INDEX])
    .catch(() => null)
    .then((r) => r || caches.match(INDEX))
    .then((r) => r || caches.match(req))

/**
 * 첫 화면 요청은 브라우저 HTTP 캐시(GitHub Pages 는 10분)를 그대로 쓰지 않고 늘 서버에 확인해요 (내용이 같으면 304 라 가벼워요).
 * HTTP 캐시에 받아 두기만 한 새 화면이 남아 있으면 오프라인에서도 그게 먼저 와서, 바로 열리는 화면을 두고 흰 화면이 돼요.
 * (요청을 e.request 그대로 감싸야 redirect 방식이 유지돼요. 감싸지 못하는 오래된 브라우저는 예전처럼 보내요)
 */
const revalidate = (req) => {
  try {
    return new Request(req, { cache: 'no-cache' })
  } catch {
    return req
  }
}

/** 이 앱의 첫 화면 주소인지 (index.html 이나 앱 주소 자체. ?open= 같은 것은 상관없어요) */
const isAppPage = (url) => {
  const scope = new URL(self.registration.scope)
  return url.origin === scope.origin && (url.pathname === scope.pathname || url.pathname === scope.pathname + 'index.html')
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return
  if (e.request.headers.has('range')) return
  // 이름에 해시가 붙은 빌드 파일(assets/)과 글꼴(fonts/)은 내용이 절대 안 바뀌어요: 캐시 우선
  // (한글 변환 엔진 wasm 약 28MB 도 한 번 받으면 다음부터는 인터넷 없이 써요)
  if (url.pathname.includes('/assets/') || url.pathname.includes('/fonts/')) {
    e.respondWith(
      // 해시 이름이라 Vary 는 볼 필요가 없어요 (Vary: Origin 을 붙이는 서버에서도 오프라인으로 열리게)
      caches.match(e.request, { ignoreVary: true }).then(
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
  // 앱 첫 화면: 네트워크 우선. 4초 안에 안 오면(아주 느린 인터넷) 저장해 둔 화면을 먼저 보여 주고, 받은 새 화면은 저장만 해요
  if (e.request.mode === 'navigate' && isAppPage(url)) {
    // 저장할 사본은 응답을 받자마자 같은 자리에서 떠 둬요 (화면에 넘긴 뒤에는 본문을 이미 읽고 있을 수 있어요)
    let stored
    const net = fetch(revalidate(e.request)).then((res) => {
      if (cacheable(res) && isHtml(res)) stored = storeIndex(res.clone())
      return res
    })
    e.waitUntil(
      net
        .then(
          () => stored,
          () => undefined,
        )
        .catch(() => undefined)
        .then(() => (prunePending ? pruneQuietly() : undefined)),
    )
    const fallback = () => cachedPage(e.request).then((r) => r || Response.error())
    const slow = sleep(NAVIGATE_WAIT_MS)
      // 저장해 둔 지금 버전 화면이 바로 열릴 때만 먼저 보여 줘요. 아니면(아직 안 열어 본 새 화면, 못 읽음 등)
      // 네트워크 응답을 더 기다려요 (앞 버전을 바로 띄우면 느린 인터넷에서는 새 버전으로 영영 안 바뀌어요)
      .then(() => readyPage([INDEX]).catch(() => null))
      // 그래도 안 오면 바로 열리는 앞 버전 화면을 보여 줘요. 그것도 없으면 오류 화면 대신 계속 기다려요
      .then((hit) => hit || sleep(PREV_WAIT_MS - NAVIGATE_WAIT_MS).then(() => readyPage([INDEX, PREV_INDEX]).catch(() => null)))
      .then((hit) => hit || net.catch(fallback))
    e.respondWith(Promise.race([net.catch(fallback), slow]))
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
        // 해시 이름이라 Vary 는 볼 필요가 없어요 (Vary: Origin 을 붙이는 서버에서도 오프라인으로 열리게)
      caches.match(e.request, { ignoreVary: true }).then((r) => r || (e.request.mode === 'navigate' ? cachedPage(e.request) : Response.error())),
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
