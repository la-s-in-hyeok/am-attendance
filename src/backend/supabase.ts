import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import type {
  AttendanceRecord,
  CompletionNotice,
  Group,
  GroupDay,
  ISODate,
  Member,
  NamedNote,
  Role,
  Service,
  Status,
  WeekNote,
} from '../lib/types'
import type { Backend, ChangeScope, GroupDayAction, GroupDayResult, PushSubscriptionInfo, Roster } from './types'
import { parseNotice, pushConfigured } from '../lib/push'

/**
 * 실제 서버 (Supabase): 모든 목자·총무가 같은 출석부를 함께 써요.
 *
 * - 표(테이블)에는 직접 접근할 수 없고, supabase/schema.sql 의 am_ 함수(RPC)만 불러요.
 *   함수마다 공용 비밀번호(p_code)를 함께 보내 서버가 확인해요.
 * - 저장이 끝나면 Realtime broadcast('am-attendance' / 'change', { scope }) 로
 *   다른 기기에 "바뀌었어요"만 알려요. (이름 같은 개인 정보는 보내지 않아요)
 * - 출석 기록은 기기에 한 번 받아 두고, 그다음부터는 바뀐 것만 받아 와요.
 */

const CHANNEL = 'am-attendance'
const EVENT = 'change'
/** 목장 완료 알림 ({ kind, group, groupId, date, n }) */
const NOTICE_EVENT = 'notify'
/** Web Push 를 보내는 서버 함수 (supabase/functions/am-notify) */
const PUSH_FUNCTION = 'am-notify'
const SCOPES: ChangeScope[] = ['roster', 'attendance', 'notes', 'status']
/** 요청 하나를 기다리는 최대 시간 */
const TIMEOUT_MS = 15_000
/**
 * 저장 요청이 결과를 모른 채 끊겼을 때(시간 초과 등), 같은 대상의 다음 저장을 보내기 전에 기다리는 시간.
 * 끊긴 요청이 서버에서 늦게 처리되더라도 그다음 저장보다 먼저 끝나도록 (새 값을 옛 값이 덮지 않도록)
 */
const SETTLE_MS = 5_000
/** 한 번에 보내는 목장원 수 (명단 일괄 추가가 아주 클 때 나눠 보내기) */
const CHUNK = 400
/** 완료할 때 서버가 준 알림 열쇠를 들고 있는 시간 (서버도 10분 지난 열쇠는 받지 않아요) */
const PUSH_TOKEN_TTL_MS = 10 * 60_000
/** 서버 데이터를 바꾸는 함수 */
const WRITES = new Set([
  'am_change_passcode',
  'am_save_attendance',
  'am_clear_attendance',
  'am_save_week_note',
  'am_save_groups',
  'am_save_members',
  'am_import_roster',
  'am_purge_member',
  'am_set_group_day',
  'am_save_push_sub',
  'am_delete_push_sub',
])

export type BackendErrorKind = 'auth' | 'locked' | 'network' | 'setup' | 'invalid' | 'conflict' | 'server'

/** 화면에 그대로 보여 줘도 되는 한국어 메시지를 가진 오류 */
export class BackendError extends Error {
  /**
   * auth = 비밀번호 문제(다시 로그인 필요), locked = 잠시 잠김, network = 인터넷 문제,
   * conflict = 서버 상태 때문에 저장하지 않았어요 (예: 다른 기기에서 이미 '완료'된 목장. 로그아웃하지 않아요) …
   */
  readonly kind: BackendErrorKind
  /** 서버가 준 오류 코드 (PGRST202, 23503 등). 화면에는 쓰지 않아요 */
  readonly code: string
  constructor(kind: BackendErrorKind, message: string, code = '') {
    super(message)
    this.name = 'BackendError'
    this.kind = kind
    this.code = code
  }
}

const MSG = {
  badCode: '비밀번호가 맞지 않아요. 비밀번호가 바뀌었다면 다시 로그인해 주세요.',
  badCurrent: '지금 비밀번호가 맞지 않아요',
  needLogin: '다시 로그인해 주세요.',
  locked: '비밀번호를 여러 번 틀려서 잠시 잠겼어요. 잠시 후 다시 시도해 주세요. (최대 10분)',
  network: '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.',
  unsure: '저장됐는지 확인하지 못했어요. 인터넷 연결을 확인하고 잠시 뒤에 다시 눌러 주세요.',
  setup: '서버 준비가 아직 안 됐어요. Supabase SQL Editor 에서 supabase/schema.sql 을 실행했는지 확인해 주세요.',
  oldSchema:
    '서버 설정이 예전 버전이라 2부 출석이 1부로 저장됐어요. 회장이 Supabase SQL Editor 에서 새 supabase/schema.sql 을 한 번 더 Run 해 주세요.',
  oldSchemaStatus:
    "서버 설정이 예전 버전이라 '완료'를 쓸 수 없어요. 회장이 Supabase SQL Editor 에서 새 supabase/schema.sql 을 한 번 더 Run 해 주세요.",
  oldSchemaImport:
    '서버 설정이 예전 버전이라 엑셀 명단을 넣을 수 없어요. 회장이 Supabase SQL Editor 에서 새 supabase/schema.sql 을 한 번 더 Run 해 주세요.',
  badKey: '서버 연결 정보가 맞지 않아요. VITE_SUPABASE_URL 과 VITE_SUPABASE_ANON_KEY 를 다시 확인해 주세요.',
  badUrl: '서버 주소(VITE_SUPABASE_URL)가 올바르지 않아요. Supabase 의 Project URL 을 다시 복사해 넣어 주세요.',
  invalidPasscode: '새 비밀번호는 숫자 4~8자리로 정해 주세요.',
  missingRef: '이미 지워졌거나 아직 저장되지 않은 목장·사람이 있어요. 새로고침한 뒤 다시 해 주세요.',
  invalid: '저장할 수 없는 값이 있어요. 새로고침한 뒤 다시 해 주세요.',
  groupDone: "완료된 목장이에요. 고치려면 '수정'을 눌러 주세요",
  busy: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
  server: '서버에 잠시 문제가 있어요. 잠시 후 다시 시도해 주세요.',
}

// ---------------------------------------------------------------------------
// 작은 도우미
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>

interface RpcResult {
  data: unknown
  error: { message?: string; code?: string; details?: string | null; hint?: string | null } | null
  status: number
}

/** 붙여 넣은 주소를 정리: 공백·끝의 / ·/rest/v1 제거, https:// 붙이기 */
function normalizeUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, '')
  u = u.replace(/\/(rest|auth|realtime|storage)\/v1$/i, '')
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`
  return u
}

/** 응답이 없을 때 무한정 기다리지 않도록 */
const fetchWithTimeout: typeof fetch = (input, init) => {
  if (init?.signal) return fetch(input, init)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer))
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : v === null || v === undefined ? fallback : String(v)
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 서버가 값으로 돌려준 오류 ({ error: 'bad_code' } 등) */
function envelopeError(data: unknown): string | null {
  return isObject(data) && typeof data.error === 'string' ? data.error : null
}

function envelopeToError(code: string): BackendError {
  switch (code) {
    case 'bad_code':
      return new BackendError('auth', MSG.badCode, code)
    case 'locked':
      return new BackendError('locked', MSG.locked, code)
    case 'invalid_passcode':
      return new BackendError('invalid', MSG.invalidPasscode, code)
    case 'invalid':
      return new BackendError('invalid', MSG.invalid, code)
    case 'group_done':
      // 다른 기기에서 이미 완료된 목장: 서버가 아무것도 바꾸지 않았어요. 다시 보내도 같으니 다시 보내지 않아요
      return new BackendError('conflict', MSG.groupDone, code)
    default:
      return new BackendError('server', MSG.server, code)
  }
}

/** 다시 보내 볼 만한 실패인지 (인터넷이 잠깐 끊김, 서버가 잠깐 바쁨) */
function isRetryable(status: number) {
  return status === 0 || status === 502 || status === 503 || status === 504 || status === 520
}

/**
 * 서버가 요청을 받아 처리했는지 알 수 없는 실패인지 (기다리다 끊음, 중간 서버의 시간 초과 등).
 * 이런 저장은 서버에서 늦게 처리될 수 있어서 바로 다시 보내지 않아요.
 */
function isUnknownOutcome(res: RpcResult) {
  if (res.status === 0) return /AbortError|TimeoutError/.test(res.error?.message ?? '')
  return res.status === 502 || res.status === 504 || res.status === 520
}

function mapRpcError(e: NonNullable<RpcResult['error']>, status: number): BackendError {
  const code = e.code ?? ''
  const text = `${e.message ?? ''} ${e.details ?? ''} ${e.hint ?? ''}`
  if (status === 0) return new BackendError('network', MSG.network, code)
  if (text.includes('AM_LOCKED')) return new BackendError('locked', MSG.locked, code)
  // 함수가 없음(스크립트를 안 돌림) / 함수 사용 권한이 없음
  if (code === 'PGRST202' || code === 'PGRST203' || code === '42883' || code === '42501' || status === 404)
    return new BackendError('setup', MSG.setup, code)
  if (status === 401 || code.startsWith('PGRST3') || /api key/i.test(text)) return new BackendError('setup', MSG.badKey, code)
  if (code === '23503') return new BackendError('invalid', MSG.missingRef, code)
  if (code.startsWith('22') || code.startsWith('23')) return new BackendError('invalid', MSG.invalid, code)
  if (status === 429) return new BackendError('server', MSG.busy, code)
  if (isRetryable(status)) return new BackendError('network', MSG.network, code)
  return new BackendError('server', MSG.server, code)
}

// --- 서버 JSON → 앱 타입 (모양이 조금 달라도 앱이 깨지지 않도록) ---

const STATUSES: Status[] = ['present', 'away', 'nocontact', 'other']

function toGroup(v: unknown): Group {
  const r = isObject(v) ? v : {}
  return { id: str(r.id), name: str(r.name), order: num(r.order), archived: r.archived === true }
}

function toMember(v: unknown): Member {
  const r = isObject(v) ? v : {}
  const role: Role = r.role === 'leader' || r.role === 'manager' ? r.role : null
  return {
    id: str(r.id),
    name: str(r.name),
    groupId: str(r.groupId),
    role,
    order: num(r.order),
    joinedOn: str(r.joinedOn),
    removedOn: typeof r.removedOn === 'string' && r.removedOn ? r.removedOn : null,
    note: str(r.note),
  }
}

/** 출석일 때만 1부·2부. 값이 없거나 이상하면 1부 (예전 서버·예전 기록) */
function toService(status: Status, v: unknown): Service | null {
  if (status !== 'present') return null
  return v === 2 || v === '2' ? 2 : 1
}

function toRecord(v: unknown): AttendanceRecord | null {
  const r = isObject(v) ? v : {}
  const status = STATUSES.find((s) => s === r.status)
  if (!status || typeof r.date !== 'string' || typeof r.memberId !== 'string') return null
  return {
    date: r.date,
    memberId: r.memberId,
    groupId: str(r.groupId),
    status,
    service: toService(status, r.service),
    reason: str(r.reason),
    updatedAt: str(r.updatedAt),
  }
}

function toNamed(v: unknown): NamedNote[] {
  return asArray(v)
    .filter(isObject)
    .map((x) => ({ name: str(x.name), note: str(x.note) }))
}

function toNote(v: unknown): WeekNote | null {
  const r = isObject(v) ? v : {}
  if (typeof r.date !== 'string') return null
  return {
    date: r.date,
    newcomers: toNamed(r.newcomers),
    visitors: toNamed(r.visitors),
    barnabas: str(r.barnabas),
    memo: str(r.memo),
    updatedAt: str(r.updatedAt),
  }
}

function toGroupDay(v: unknown): GroupDay | null {
  const r = isObject(v) ? v : {}
  if (typeof r.date !== 'string' || typeof r.groupId !== 'string') return null
  if (r.state !== 'done' && r.state !== 'editing') return null
  return {
    date: r.date,
    groupId: r.groupId,
    state: r.state,
    doneAt: typeof r.doneAt === 'string' && r.doneAt ? r.doneAt : null,
    editCount: num(r.editCount),
    updatedAt: str(r.updatedAt),
  }
}

/** 서버에 함수가 없음 (예전 schema.sql) */
function isMissingFn(e: unknown) {
  return e instanceof BackendError && (e.code === 'PGRST202' || e.code === '42883')
}

function recKey(date: ISODate, memberId: string) {
  return `${date}|${memberId}`
}

function notNull<T>(x: T | null): x is T {
  return x !== null
}

// --- 앱 타입 → 서버 JSON ---

function groupRow(g: Group) {
  return { id: g.id, name: g.name, order: g.order, archived: g.archived }
}

function memberRow(m: Member) {
  return {
    id: m.id,
    name: m.name,
    groupId: m.groupId,
    role: m.role,
    order: m.order,
    joinedOn: m.joinedOn,
    removedOn: m.removedOn,
    note: m.note ?? '',
  }
}

// ---------------------------------------------------------------------------

export class SupabaseBackend implements Backend {
  readonly mode = 'cloud' as const

  private sb: SupabaseClient | null = null
  private setupError: BackendError | null = null
  /** 로그인에 성공한 공용 비밀번호 (메모리에만) */
  private code: string | null = null

  // 출석 기록 캐시: [attFrom, 끝] 기간을 들고 있고, attCursor 이후에 바뀐 것만 받아 와요
  private att = new Map<string, AttendanceRecord>()
  private attFrom: ISODate | null = null
  private attCursor: string | null = null
  /** 서버에 '바뀐 것만' 함수가 없으면(예전 스크립트) 매번 전체를 받아요 */
  private deltaSupported = true
  private attQueue: Promise<unknown> = Promise.resolve()

  /** 같은 대상에 대한 저장은 보낸 순서대로 (빠르게 두 번 눌러도 마지막 것이 남도록) */
  private lanes = new Map<string, Promise<unknown>>()

  /** 서버에 완료 기능이 없음을 알게 된 시각 (예전 schema.sql). 5분 뒤 다시 물어봐요 */
  private statusMissingAt = 0

  /**
   * 완료할 때 서버가 준 한 번 쓰는 알림 열쇠 ('날짜|목장id' → 열쇠, 받은 시각). 메모리에만 둬요.
   * sendNotice 가 공용 비밀번호 대신 이 열쇠를 알림 함수(am-notify)에 보내고, 보내면 바로 지워요.
   */
  private pushTokens = new Map<string, { token: string; at: number }>()

  // 실시간 알림
  private listeners = new Set<(scope: ChangeScope) => void>()
  private noticeListeners = new Set<(notice: CompletionNotice) => void>()
  private channel: RealtimeChannel | null = null
  private subscribedOnce = false
  private missed = false
  private reopenTimer: ReturnType<typeof setTimeout> | null = null
  private outbox = new Set<ChangeScope>()
  private outTimer: ReturnType<typeof setTimeout> | null = null

  constructor(url: string, anonKey: string) {
    try {
      this.sb = createClient(normalizeUrl(url), anonKey.trim(), {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: fetchWithTimeout },
      })
    } catch (e) {
      console.error('[supabase] 설정 오류', e)
      this.setupError = new BackendError('setup', MSG.badUrl)
    }
  }

  // --- 서버 호출 --------------------------------------------------------------

  private client(): SupabaseClient {
    if (!this.sb) throw this.setupError ?? new BackendError('setup', MSG.badUrl)
    return this.sb
  }

  /**
   * RPC 호출 (항상 POST: 서버는 POST 로 부를 때만 비밀번호를 확인해 줘요).
   * 인터넷이 잠깐 끊기면 tries 번까지 다시 보내요. 다시 보내는 것은 같은 대상의 다음 저장보다 항상 먼저예요
   * (저장은 lane 안에서 부르므로, 다시 보내기가 끝나야 다음 저장이 출발해요).
   * 저장 요청이 처리됐는지 모르게 끊긴 경우(시간 초과 등)에는 다시 보내지 않아요.
   */
  private async rpc(fn: string, args: Json, tries = 2): Promise<unknown> {
    const sb = this.client()
    const write = WRITES.has(fn)
    for (let attempt = 1; ; attempt++) {
      let res: RpcResult
      try {
        const r = await sb.rpc(fn, args)
        res = { data: r.data as unknown, error: r.error, status: r.status }
      } catch (e) {
        res = { data: null, error: { message: String(e) }, status: 0 }
      }
      if (!res.error) return res.data
      const unsure = write && isUnknownOutcome(res)
      if (isRetryable(res.status) && attempt < tries && !unsure) {
        await sleep(700 * attempt)
        continue
      }
      console.error(`[supabase] ${fn} 실패`, res.status, res.error.code, res.error.message)
      if (unsure) throw new BackendError('network', MSG.unsure, 'unknown_outcome')
      throw mapRpcError(res.error, res.status)
    }
  }

  /**
   * 로그인한 비밀번호를 붙여서 호출. 비밀번호가 바뀌었으면 더 보내지 않고 다시 로그인하게 해요.
   * allow: 오류가 아니라 결과로 돌려받을 서버 값 (예: 'exists')
   */
  private async call(fn: string, args: Json = {}, tries = 2, allow?: string): Promise<unknown> {
    const code = this.code
    if (!code) throw new BackendError('auth', MSG.needLogin, 'no_login')
    const data = await this.rpc(fn, { p_code: code, ...args }, tries)
    const err = envelopeError(data)
    if (err && err !== allow) {
      // 다른 기기에서 비밀번호를 바꾼 경우: 틀린 비밀번호로 계속 보내 잠기지 않도록 여기서 멈춰요
      if (err === 'bad_code' && this.code === code) this.code = null
      throw envelopeToError(err)
    }
    return data
  }

  /**
   * 같은 key 의 일은 하나씩, 부른 순서대로. 앞의 일이 실패해도 다음 일은 그 뒤에 출발해요.
   * 앞의 저장이 처리됐는지 모르게 끊겼으면 SETTLE_MS 만큼 더 기다렸다가 다음 저장을 보내요.
   */
  private lane<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.lanes.get(key) ?? Promise.resolve()
    const run = prev.then(fn)
    const tail: Promise<void> = run.then(
      () => undefined,
      (e: unknown) => (e instanceof BackendError && e.code === 'unknown_outcome' ? sleep(SETTLE_MS) : undefined),
    )
    this.lanes.set(key, tail)
    void tail.then(() => {
      if (this.lanes.get(key) === tail) this.lanes.delete(key)
    })
    return run
  }

  /** 명단 저장이 진행 중이면 끝날 때까지 (막 추가한 사람의 출석이 먼저 도착하지 않도록) */
  private async afterRosterWrites() {
    const pending = this.lanes.get('roster')
    if (pending) await pending
  }

  // --- 로그인 -----------------------------------------------------------------

  async login(passcode: string): Promise<boolean> {
    // 새로 로그인할 때는 기억하던 비밀번호부터 지워요.
    // (로그아웃 뒤 틀린 비밀번호를 넣거나 연결이 안 돼도, 예전 비밀번호로 계속 보내지 않도록)
    this.code = null
    const ok = (await this.rpc('am_login', { p_code: passcode })) === true
    if (ok) {
      this.code = passcode
      this.resetAttendanceCache()
    }
    return ok
  }

  async changePasscode(current: string, next: string): Promise<void> {
    if (!/^[0-9]{4,8}$/.test(next)) throw new BackendError('invalid', MSG.invalidPasscode, 'invalid_passcode')
    // 다시 보내지 않아요: 첫 요청이 실제로는 성공했으면 두 번째는 '지금 비밀번호가 틀림'이 되기 때문
    const data = await this.rpc('am_change_passcode', { p_code: current, p_next: next }, 1)
    const err = envelopeError(data)
    if (err === 'bad_code') throw new BackendError('auth', MSG.badCurrent, err)
    if (err) throw envelopeToError(err)
    this.code = next
  }

  // --- 읽기 -------------------------------------------------------------------

  async fetchRoster(): Promise<Roster> {
    const data = await this.call('am_get_roster', {}, 3)
    const r = isObject(data) ? data : {}
    return {
      groups: asArray(r.groups).map(toGroup),
      members: asArray(r.members).map(toMember),
    }
  }

  fetchAttendance(from: ISODate, to: ISODate): Promise<AttendanceRecord[]> {
    return this.inAttendanceQueue(async () => {
      if (!this.deltaSupported) return this.fetchAttendanceRange(from, to)
      const covered = this.attFrom !== null && this.attCursor !== null && from >= this.attFrom
      try {
        if (covered) await this.syncAttendance(this.attFrom as ISODate, this.attCursor)
        else await this.syncAttendance(from, null)
      } catch (e) {
        if (e instanceof BackendError && (e.code === 'PGRST202' || e.code === '42883')) {
          // 예전 스크립트로 만든 서버: 바뀐 것만 받기가 없으면 기간 전체를 받아요
          this.deltaSupported = false
          return this.fetchAttendanceRange(from, to)
        }
        throw e
      }
      const out: AttendanceRecord[] = []
      for (const r of this.att.values()) if (r.date >= from && r.date <= to) out.push({ ...r })
      return out
    })
  }

  async fetchWeekNotes(from: ISODate, to: ISODate): Promise<WeekNote[]> {
    const data = await this.call('am_get_week_notes', { p_from: from, p_to: to }, 3)
    return asArray(data).map(toNote).filter(notNull)
  }

  private inAttendanceQueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.attQueue.then(fn)
    this.attQueue = run.catch(() => undefined)
    return run
  }

  private resetAttendanceCache() {
    this.att = new Map()
    this.attFrom = null
    this.attCursor = null
  }

  /** since 가 null 이면 from 이후 전부, 아니면 since 이후 바뀐 것만 받아 캐시에 반영 */
  private async syncAttendance(from: ISODate, since: string | null) {
    const data = await this.call('am_get_attendance_changes', { p_since: since, p_from: from }, 3)
    const r = isObject(data) ? data : {}
    const records = asArray(r.records).map(toRecord).filter(notNull)
    if (since === null || r.full === true) {
      this.att = new Map(records.map((x) => [recKey(x.date, x.memberId), x]))
      this.attFrom = from
    } else {
      // 지운 것 먼저, 그다음 새로 저장된 것 (지웠다가 다시 누른 경우도 맞게)
      for (const d of asArray(r.deleted)) {
        if (isObject(d) && typeof d.date === 'string' && typeof d.memberId === 'string') {
          this.att.delete(recKey(d.date, d.memberId))
        }
      }
      for (const x of records) this.att.set(recKey(x.date, x.memberId), x)
    }
    this.attCursor = typeof r.now === 'string' ? r.now : null
  }

  private async fetchAttendanceRange(from: ISODate, to: ISODate): Promise<AttendanceRecord[]> {
    const data = await this.call('am_get_attendance', { p_from: from, p_to: to }, 3)
    return asArray(data).map(toRecord).filter(notNull)
  }

  // --- 쓰기 -------------------------------------------------------------------

  async saveAttendance(record: AttendanceRecord): Promise<void> {
    const service = toService(record.status, record.service)
    const p_record = {
      date: record.date,
      memberId: record.memberId,
      groupId: record.groupId,
      status: record.status,
      service,
      reason: record.reason ?? '',
    }
    let data: unknown
    await this.lane(`att:${recKey(record.date, record.memberId)}`, async () => {
      await this.afterRosterWrites()
      data = await this.call('am_save_attendance', { p_record })
    })
    this.notify('attendance')
    // 예전 스크립트로 만든 서버는 '몇 부'를 모르고 그냥 출석(= 1부)으로 저장해요.
    // 새 서버는 저장한 service 를 함께 돌려줘요. 2부가 1부로 바뀐 채 조용히 넘어가지 않도록 알려요.
    if (service === 2 && !(isObject(data) && 'service' in data)) {
      throw new BackendError('setup', MSG.oldSchema, 'old_schema')
    }
  }

  async clearAttendance(date: ISODate, memberId: string): Promise<void> {
    await this.lane(`att:${recKey(date, memberId)}`, () =>
      this.call('am_clear_attendance', { p_date: date, p_member_id: memberId }),
    )
    this.notify('attendance')
  }

  async saveWeekNote(note: WeekNote): Promise<void> {
    const p_note = {
      date: note.date,
      newcomers: note.newcomers.map((n) => ({ name: n.name, note: n.note ?? '' })),
      visitors: note.visitors.map((n) => ({ name: n.name, note: n.note ?? '' })),
      barnabas: note.barnabas ?? '',
      memo: note.memo ?? '',
    }
    await this.lane(`note:${note.date}`, () => this.call('am_save_week_note', { p_note }))
    this.notify('notes')
  }

  async saveGroup(group: Group): Promise<void> {
    await this.saveGroups([group])
  }

  async saveGroups(groups: Group[]): Promise<void> {
    if (groups.length === 0) return
    const p_groups = groups.map(groupRow)
    await this.lane('roster', () => this.call('am_save_groups', { p_groups }))
    this.notify('roster')
  }

  async saveMember(member: Member): Promise<void> {
    await this.saveMembers([member])
  }

  async saveMembers(members: Member[]): Promise<void> {
    if (members.length === 0) return
    const rows = members.map(memberRow)
    await this.lane('roster', async () => {
      for (let i = 0; i < rows.length; i += CHUNK) {
        await this.call('am_save_members', { p_members: rows.slice(i, i + CHUNK) })
      }
    })
    this.notify('roster')
  }

  async importRoster(groups: Group[], members: Member[]): Promise<'done' | 'exists'> {
    const p_groups = groups.map(groupRow)
    const p_members = members.map(memberRow)
    let result: 'done' | 'exists'
    try {
      result = await this.lane('roster', async () => {
        // 다시 보내지 않아요: 첫 요청이 실제로는 들어갔으면 두 번째는 'exists' 가 되어 헷갈리기 때문
        const data = await this.call('am_import_roster', { p_groups, p_members }, 1, 'exists')
        return envelopeError(data) === 'exists' ? 'exists' : 'done'
      })
    } catch (e) {
      // 예전 schema.sql 로 만든 서버에는 이 함수가 없어요
      if (e instanceof BackendError && (e.code === 'PGRST202' || e.code === '42883')) {
        throw new BackendError('setup', MSG.oldSchemaImport, e.code)
      }
      throw e
    }
    if (result === 'done') this.notify('roster')
    return result
  }

  async purgeMember(memberId: string): Promise<void> {
    await this.lane('roster', () => this.call('am_purge_member', { p_member_id: memberId }))
    for (const k of [...this.att.keys()]) if (this.att.get(k)?.memberId === memberId) this.att.delete(k)
    this.notify('roster')
  }

  // --- 목장 완료 / 수정 ----------------------------------------------------------

  async fetchGroupDays(from: ISODate, to: ISODate): Promise<GroupDay[]> {
    if (Date.now() - this.statusMissingAt < 5 * 60_000) return []
    try {
      const data = await this.call('am_get_group_days', { p_from: from, p_to: to }, 3)
      this.statusMissingAt = 0
      return asArray(data).map(toGroupDay).filter(notNull)
    } catch (e) {
      // 예전 schema.sql 로 만든 서버: 완료 기능만 빼고 나머지는 그대로 써요
      if (isMissingFn(e)) {
        this.statusMissingAt = Date.now()
        return []
      }
      throw e
    }
  }

  async setGroupDay(date: ISODate, groupId: string, action: GroupDayAction): Promise<GroupDayResult> {
    let data: unknown
    try {
      data = await this.lane(`day:${date}|${groupId}`, () =>
        this.call('am_set_group_day', { p_date: date, p_group_id: groupId, p_action: action }),
      )
    } catch (e) {
      if (isMissingFn(e)) throw new BackendError('setup', MSG.oldSchemaStatus, (e as BackendError).code)
      throw e
    }
    this.statusMissingAt = 0
    const r = isObject(data) ? data : {}
    const notify = r.notify === 'done' || r.notify === 'edited' ? r.notify : null
    this.keepPushToken(date, groupId, typeof r.pushToken === 'string' && r.pushToken ? r.pushToken : null)
    this.notify('status')
    return { day: toGroupDay(r.day), notify }
  }

  /** 서버가 준 알림 열쇠를 기억해요. 없으면(수정 시작, 이미 알림을 보냄 등) 들고 있던 것도 버려요 */
  private keepPushToken(date: ISODate, groupId: string, token: string | null) {
    const now = Date.now()
    for (const [k, v] of this.pushTokens) if (now - v.at > PUSH_TOKEN_TTL_MS) this.pushTokens.delete(k)
    const key = `${date}|${groupId}`
    if (token) this.pushTokens.set(key, { token, at: now })
    else this.pushTokens.delete(key)
  }

  /**
   * 1) 실시간: 열려 있는 다른 기기에 바로 ('notify' 이벤트)
   * 2) Web Push (VITE_VAPID_PUBLIC_KEY 가 있을 때만): 서버 함수가 앱을 꺼 둔 휴대폰에도 보내요.
   *    공용 비밀번호는 보내지 않고, 이 기기가 완료할 때 서버에게 받은 한 번 쓰는 열쇠만 보내요.
   *    열쇠가 없으면(이 기기가 완료한 게 아니거나 10분이 지남) Web Push 는 건너뛰어요.
   * 어느 쪽이 실패해도 조용히 넘어가요 (완료는 이미 저장됐어요)
   */
  async sendNotice(notice: CompletionNotice, excludeEndpoint?: string | null): Promise<void> {
    const payload = { kind: notice.kind, group: notice.group, groupId: notice.groupId, date: notice.date, n: notice.n }
    const ch = this.channel
    try {
      if (ch?.state === 'joined') await ch.send({ type: 'broadcast', event: NOTICE_EVENT, payload })
      else if (ch) await ch.httpSend(NOTICE_EVENT, payload)
    } catch (e) {
      console.warn('[supabase] 완료 알림(실시간) 실패', e)
    }
    if (!pushConfigured || !this.sb) return
    const key = `${notice.date}|${notice.groupId}`
    const saved = this.pushTokens.get(key)
    // 한 번 쓰는 열쇠라 보내기 전에 지워요 (서버도 한 번 쓰면 지워요)
    this.pushTokens.delete(key)
    if (!saved || Date.now() - saved.at > PUSH_TOKEN_TTL_MS) {
      console.warn('[supabase] 완료 알림(Web Push): 알림 열쇠가 없어서 건너뛰어요')
      return
    }
    try {
      const { error } = await this.sb.functions.invoke(PUSH_FUNCTION, {
        body: { date: notice.date, groupId: notice.groupId, token: saved.token, endpoint: excludeEndpoint ?? null },
      })
      if (error) console.warn('[supabase] 완료 알림(Web Push) 실패', error)
    } catch (e) {
      console.warn('[supabase] 완료 알림(Web Push) 실패', e)
    }
  }

  async savePushSubscription(sub: PushSubscriptionInfo): Promise<void> {
    await this.call('am_save_push_sub', { p_endpoint: sub.endpoint, p_keys: sub.keys })
  }

  async deletePushSubscription(endpoint: string): Promise<void> {
    await this.call('am_delete_push_sub', { p_endpoint: endpoint })
  }

  // --- 실시간 알림 --------------------------------------------------------------

  subscribe(onChange: (scope: ChangeScope) => void): () => void {
    this.listeners.add(onChange)
    this.openChannel()
    return () => {
      this.listeners.delete(onChange)
      if (this.listeners.size + this.noticeListeners.size === 0) this.closeChannel()
    }
  }

  onNotice(fn: (notice: CompletionNotice) => void): () => void {
    this.noticeListeners.add(fn)
    this.openChannel()
    return () => {
      this.noticeListeners.delete(fn)
      if (this.listeners.size + this.noticeListeners.size === 0) this.closeChannel()
    }
  }

  private emitNotice(notice: CompletionNotice) {
    for (const fn of [...this.noticeListeners]) {
      try {
        fn(notice)
      } catch (e) {
        console.error(e)
      }
    }
  }

  private emit(scope: ChangeScope) {
    for (const fn of [...this.listeners]) {
      try {
        fn(scope)
      } catch (e) {
        console.error(e)
      }
    }
  }

  private openChannel() {
    if (this.channel || !this.sb || this.listeners.size + this.noticeListeners.size === 0) return
    if (this.reopenTimer) {
      clearTimeout(this.reopenTimer)
      this.reopenTimer = null
    }
    const sb = this.sb
    const ch = sb.channel(CHANNEL, { config: { broadcast: { self: false, ack: false } } })
    ch.on('broadcast', { event: EVENT }, (msg: { payload?: unknown }) => {
      const raw = isObject(msg.payload) ? msg.payload.scope : undefined
      const scope = SCOPES.find((x) => x === raw)
      if (scope) this.emit(scope)
    })
    ch.on('broadcast', { event: NOTICE_EVENT }, (msg: { payload?: unknown }) => {
      const notice = parseNotice(msg.payload)
      if (notice) this.emitNotice(notice)
    })
    ch.subscribe((status) => {
      if (this.channel !== ch) return
      if (status === 'SUBSCRIBED') {
        // 끊겼다가 다시 연결됐으면 그 사이에 놓친 것을 한 번 받아 와요
        if (this.subscribedOnce && this.missed) {
          this.emit('roster') // 명단 + 출석
          this.emit('notes')
          this.emit('status')
        }
        this.subscribedOnce = true
        this.missed = false
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        // 라이브러리가 알아서 다시 연결해요. 그동안은 30초마다 새로고침으로 버텨요
        this.missed = true
      } else if (status === 'CLOSED') {
        this.missed = true
        this.channel = null
        if (this.listeners.size + this.noticeListeners.size > 0) this.reopenTimer = setTimeout(() => this.openChannel(), 5_000)
      }
    })
    this.channel = ch
  }

  private closeChannel() {
    if (this.reopenTimer) {
      clearTimeout(this.reopenTimer)
      this.reopenTimer = null
    }
    const ch = this.channel
    this.channel = null
    this.subscribedOnce = false
    this.missed = false
    if (ch && this.sb) void this.sb.removeChannel(ch).catch(() => undefined)
  }

  /** 저장이 끝난 뒤 다른 기기에 알리기 (짧은 시간에 여러 번 저장하면 한 번으로 모아서) */
  private notify(scope: ChangeScope) {
    this.outbox.add(scope)
    if (this.outTimer) return
    this.outTimer = setTimeout(() => {
      this.outTimer = null
      const scopes = [...this.outbox]
      this.outbox.clear()
      for (const s of scopes) void this.broadcast(s)
    }, 150)
  }

  private async broadcast(scope: ChangeScope) {
    const ch = this.channel
    if (!ch) return // 실시간 연결을 안 쓰는 중이면 다른 기기는 30초 새로고침으로 받아요
    try {
      if (ch.state === 'joined') await ch.send({ type: 'broadcast', event: EVENT, payload: { scope } })
      else await ch.httpSend(EVENT, { scope })
    } catch (e) {
      // 알림이 안 가도 저장은 이미 끝났어요
      console.warn('[supabase] 실시간 알림 실패', e)
    }
  }
}
