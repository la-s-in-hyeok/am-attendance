// =====================================================================
//  Supabase Edge Function: am-notify  (앱을 꺼 두어도 완료 알림 받기)
// =====================================================================
//  목장에서 '완료' / '수정 완료'를 누르면 앱이 이 함수를 불러요.
//  이 함수는 알림을 켠 모든 휴대폰(누른 사람 휴대폰은 빼고)에 Web Push 를 보내요.
//    "믿음목장 출석체크 완료했습니다" / "믿음목장 수정있어요!!!!!!"
//
//  · 앱은 공용 비밀번호를 보내지 않아요. 완료를 누를 때 서버(am_set_group_day)가 그 기기에만 준
//    한 번 쓰는 알림 열쇠(token)를 보내요. 열쇠가 맞는지는 서버의 am_push_targets 함수가 확인해요.
//    (틀리거나, 10분이 지났거나, 이미 한 번 썼으면 보내지 않아요. 쓰고 나면 열쇠는 지워져요)
//  · 알림 문구(목장 이름, 완료/수정)는 앱이 보낸 글이 아니라 서버 기록(group_days)으로 정해요.
//    방금(10분 안에) 완료한 것만, 완료 한 번에 한 번만 보내요.
//  · 없어진 휴대폰(404/410)은 받는 목록에서 지워요 (am_push_forget).
//
//  휴대폰에 보내는 값: { title, body, tag, date, groupId, kind, group, n }
//  앱이 보내는 값: { date: 'YYYY-MM-DD', groupId: 목장 id, token: 알림 열쇠, endpoint: 누른 기기 주소 | null }
//  돌려주는 값: 200 { ok, sent, removed, failed } | 400 값이 빠지거나 이상함 | 403 열쇠가 맞지 않음(보내지 않음)
//
//  Secrets (Supabase → Edge Functions → Secrets):
//    VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY : npx web-push generate-vapid-keys 로 만든 값
//    VAPID_SUBJECT                       : mailto:회장이메일@example.com
//  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 는 Supabase 가 자동으로 넣어 줘요.
// =====================================================================

import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'

const TITLE = 'AM청년회 출석부'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } })
}

/** '믿음' → '믿음목장', '믿음목장' → '믿음목장', 'Living hope' → 'Living hope 목장' (앱의 src/lib/push.ts 와 같은 규칙) */
function groupLabel(name: string): string {
  const n = name.trim()
  if (n.endsWith('목장')) return n
  return /[A-Za-z0-9]$/.test(n) ? `${n} 목장` : `${n}목장`
}

function message(kind: string, group: string): string {
  const g = groupLabel(group)
  return kind === 'edited' ? `${g} 수정있어요!!!!!!` : `${g} 출석체크 완료했습니다`
}

interface Target {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

interface TargetsResult {
  ok?: boolean
  error?: string
  kind?: string
  group?: string
  groupId?: string
  date?: string
  n?: number
  targets?: Target[]
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)

  const pub = Deno.env.get('VAPID_PUBLIC_KEY')
  const priv = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com'
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!pub || !priv || !url || !serviceKey) return json({ error: 'setup' }, 500)

  let body: Record<string, unknown>
  try {
    const raw: unknown = await req.json()
    if (typeof raw !== 'object' || raw === null) throw new Error('not object')
    body = raw as Record<string, unknown>
  } catch {
    return json({ error: 'invalid' }, 400)
  }
  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null
  const groupId = typeof body.groupId === 'string' && /^[0-9a-f-]{36}$/i.test(body.groupId) ? body.groupId : null
  const token = typeof body.token === 'string' && /^[A-Za-z0-9_-]{16,200}$/.test(body.token) ? body.token : null
  const endpoint = typeof body.endpoint === 'string' && body.endpoint.length <= 1000 ? body.endpoint : null
  if (!date || !groupId || !token) return json({ error: 'invalid' }, 400)

  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await sb.rpc('am_push_targets', {
    p_date: date,
    p_group_id: groupId,
    p_token: token,
    p_exclude_endpoint: endpoint,
  })
  if (error) {
    console.error('am_push_targets 실패', error.code, error.message)
    return json({ error: 'server' }, 500)
  }
  const r = (data ?? {}) as TargetsResult
  if (r.error) {
    // denied = 열쇠가 틀렸거나, 10분이 지났거나, 이미 보냈거나, 수정 중이에요 → 보내지 않아요
    return json({ error: r.error }, r.error === 'invalid' ? 400 : 403)
  }

  webpush.setVapidDetails(subject, pub, priv)
  const payload = JSON.stringify({
    title: TITLE,
    body: message(r.kind ?? 'done', r.group ?? ''),
    tag: `am-${r.date}-${r.groupId}-${r.n ?? 0}`,
    date: r.date,
    groupId: r.groupId,
    // 앱을 보고 있는 휴대폰은 이 값으로 화면 안 알림을 띄워요 (sw.js)
    kind: r.kind === 'edited' ? 'edited' : 'done',
    group: r.group ?? '',
    n: r.n ?? 0,
  })

  const targets = Array.isArray(r.targets) ? r.targets : []
  let sent = 0
  let removed = 0
  let failed = 0
  await Promise.all(
    targets.map(async (t) => {
      try {
        await webpush.sendNotification({ endpoint: t.endpoint, keys: t.keys }, payload, { TTL: 6 * 60 * 60, urgency: 'high' })
        sent++
      } catch (e) {
        const status = (e as { statusCode?: number } | null)?.statusCode
        if (status === 404 || status === 410) {
          // 알림을 끄거나 앱을 지운 휴대폰
          const { error: e2 } = await sb.rpc('am_push_forget', { p_endpoint: t.endpoint })
          if (e2) console.warn('없어진 구독 지우기 실패', e2.code)
          removed++
        } else {
          failed++
          console.warn('보내기 실패', status)
        }
      }
    }),
  )
  return json({ ok: true, sent, removed, failed })
})
