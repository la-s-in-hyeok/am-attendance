import {
  EVENT_COLORS,
  type AttendanceRecord,
  type CalEvent,
  type CalEventInput,
  type CompletionNotice,
  type EventNote,
  type Group,
  type GroupDay,
  type ISODate,
  type Member,
  type ReportFile,
  type ReportWeek,
  type SaveNoteResult,
  type WeekNote,
} from '../lib/types'
import type { Backend, ChangeScope, GroupDayAction, GroupDayResult, Roster } from './types'
import { parseNotice } from '../lib/push'
import { addDays, todayKST } from '../lib/dates'
import { newId } from '../lib/id'
import { deleteReportBlobs, getReportBlob, listReportPaths, putReportBlob } from './reportsLocalStore'
import { dateOfPath, ensureOwner, ownerFor, ownersFor } from './reportOwners'

/**
 * 체험 모드: 이 브라우저의 localStorage 에만 저장한다.
 * 같은 브라우저의 다른 탭과는 BroadcastChannel 로 실시간 동기화된다.
 */
const KEY = 'am-attendance:v1'
/** 회의록은 일정마다 따로 저장해요 (자동 저장 때마다 출석 데이터 전체를 다시 쓰지 않도록) */
const NOTE_KEY = `${KEY}:note:`
const DEFAULT_PASSCODE = '0000'
/** 회의록 크기 한도 (서버와 같게 약 300KB) */
const NOTE_MAX_BYTES = 300_000
/** 지운 일정을 되돌릴 수 있는 기간 */
const RESTORE_DAYS = 30
/** 목장보고서 목록 (PDF 바이트는 IndexedDB: reportsLocalStore.ts) */
const REPORTS_KEY = `${KEY}:reports`
/** 보고서 PDF 하나의 최대 크기 (서버 보관함과 같게 45MB) */
const REPORT_MAX_BYTES = 45 * 1024 * 1024
/** 이 날수보다 오래된 주의 보고서는 마감할 때 정리해요 (서버와 같게 1년) */
const REPORT_KEEP_DAYS = 371
/** 담당 비밀번호: 10분 안에 서로 다른 틀린 값을 이만큼 넣으면 잠시 막아요 (서버와 같게) */
const PIN_LIMIT = 10
const PIN_WINDOW_MS = 10 * 60_000

/** 체험 모드에 저장한 보고서 한 개 */
interface StoredReportFile {
  groupId: string
  date: ISODate
  path: string
  fileName: string
  pages: number
  sizeBytes: number
  uploadedAt: string
  /** 낸 기기 주인 열쇠의 지문 (서버의 owner_hash 와 같은 역할). 없으면 아무의 것도 아니에요 */
  ownerHash?: string
}

/** 체험 모드에 저장한 목장보고서 목록 (localStorage `${REPORTS_KEY}`) */
interface StoredReports {
  /** 주일 → 마감 시각 (null = 마감 전) */
  weeks: Record<ISODate, { closedAt: string | null }>
  /** key = `${date}|${groupId}` */
  files: Record<string, StoredReportFile>
}

/** 체험 모드에 저장한 일정 (지운 일정도 30일 동안 남겨 둬요) */
interface StoredEvent extends CalEventInput {
  hasNote: boolean
  updatedAt: string
  deletedAt: string | null
}

/** 체험 모드에 저장한 회의록 (localStorage `${NOTE_KEY}${일정 id}`) */
interface StoredNote {
  doc: unknown
  plainLen: number
  version: number
  updatedAt: string
}

interface LocalData {
  passcode: string
  groups: Group[]
  members: Member[]
  attendance: Record<string, AttendanceRecord>
  notes: Record<ISODate, WeekNote>
  /** key = `${date}|${groupId}` (예전 체험 데이터에는 없음) */
  groupDays?: Record<string, GroupDay>
  /** 캘린더 일정 (key = 일정 id. 예전 체험 데이터에는 없음) */
  events?: Record<string, StoredEvent>
  /** 2027년 seed 일정을 넣었는지 (다 지워도 다시 넣지 않도록) */
  calendarSeeded?: boolean
  /** 보고서 담당 비밀번호 (없으면 처음 값 0000. 서버와 같게) */
  reportPin?: string
}

const SCOPES: ChangeScope[] = ['roster', 'attendance', 'notes', 'status', 'calendar', 'reports']

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 서버(BackendError)와 같은 모양의 오류: kind 와 code 로 구분해요.
 * code: 'invalid' | 'not_found' | 'too_big' | 'quota'
 */
class LocalError extends Error {
  readonly kind: 'invalid' | 'conflict' | 'server' | 'locked'
  readonly code: string
  constructor(kind: LocalError['kind'], message: string, code: string) {
    super(message)
    this.name = 'LocalError'
    this.kind = kind
    this.code = code
  }
}

const invalidError = () => new LocalError('invalid', '저장할 수 없는 값이 있어요. 새로고침한 뒤 다시 해 주세요.', 'invalid')
const notFoundError = () => new LocalError('conflict', '이미 지워진 일정이에요. 새로고침한 뒤 다시 확인해 주세요.', 'not_found')
const quotaError = () =>
  new LocalError('server', '이 기기 저장 공간이 모자라요. 체험 모드에서는 긴 회의록을 저장하지 못할 수 있어요.', 'quota')

/** 'YYYY-MM-DD' → 1970-01-01 부터 며칠째인지. 없는 날짜(2027-02-30 등)면 null */
function dayNumber(d: string): number | null {
  if (!DAY_RE.test(d)) return null
  const [y, m, day] = d.split('-').map(Number)
  const t = Date.UTC(y, m - 1, day)
  const back = new Date(t)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== day) return null
  return t / 86_400_000
}

function readNote(eventId: string): StoredNote | null {
  try {
    const raw = localStorage.getItem(NOTE_KEY + eventId)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<StoredNote> | null
    if (!v || typeof v !== 'object' || typeof v.version !== 'number') return null
    return {
      doc: v.doc ?? null,
      plainLen: typeof v.plainLen === 'number' ? v.plainLen : 0,
      version: v.version,
      updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : '',
    }
  } catch {
    return null
  }
}

/** 회의록 쓰기. 저장 공간이 모자라면 조용히 넘기지 않고 오류를 내요 ('저장됨'으로 보이는데 사라지지 않도록) */
function writeNote(eventId: string, note: StoredNote) {
  try {
    localStorage.setItem(NOTE_KEY + eventId, JSON.stringify(note))
  } catch {
    throw quotaError()
  }
}

function removeNote(eventId: string) {
  try {
    localStorage.removeItem(NOTE_KEY + eventId)
  } catch {
    /* 지우지 못해도 일정이 없으면 보이지 않아요 */
  }
}

const closedError = () => new LocalError('conflict', '이미 마감됐어요. 더 올리거나 지울 수 없어요', 'closed')
const noGroupError = () => new LocalError('conflict', '목장 정보가 바뀌었어요. 새로고침한 뒤 다시 해 주세요.', 'no_group')
const reportGoneError = () => new LocalError('conflict', '이미 지워진 보고서예요. 새로고침한 뒤 다시 확인해 주세요.', 'not_found')
const notOwnerError = () => new LocalError('conflict', '다른 사람이 낸 보고서예요. 낸 사람만 바꾸거나 지울 수 있어요', 'not_owner')
const badPinError = () => new LocalError('invalid', '담당 비밀번호가 맞지 않아요', 'bad_pin')
const pinLockedError = () => new LocalError('locked', '비밀번호를 여러 번 틀려서 잠시 막혔어요. 10분 뒤에 다시 해 주세요', 'pin_locked')
const pinUnsetError = () =>
  new LocalError(
    'invalid',
    "아직 보고서 담당 비밀번호를 정하지 않았어요. 보고서를 걷는 사람이 관리 탭의 '목장보고서 담당 비밀번호'에서 먼저 정해 주세요.",
    'pin_unset',
  )
const PIN_RE = /^[0-9]{4,8}$/
/** 담당 비밀번호 처음(임시) 값 */
const DEFAULT_REPORT_PIN = '0000'

/** 주인 열쇠 → 지문 (서버처럼 sha256 16진수). 이 브라우저가 sha256 을 못 쓰면(http 주소 등) 열쇠를 그대로 써요 (체험 모드라 괜찮아요) */
async function ownerHash(owner: string): Promise<string> {
  try {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(owner))
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return `raw:${owner}`
  }
}

async function ownerHashes(owners: string[]): Promise<Set<string>> {
  return new Set(await Promise.all(owners.map(ownerHash)))
}

/** 저장된 보고서 → 앱이 쓰는 모양 (내 것만 경로·파일 이름·크기) */
function toReportFile(f: StoredReportFile, mine: boolean): ReportFile {
  const base = { groupId: f.groupId, pages: f.pages, uploadedAt: f.uploadedAt }
  return mine ? { ...base, mine: true, path: f.path, fileName: f.fileName, sizeBytes: f.sizeBytes } : { ...base, mine: false }
}

function readReports(): StoredReports {
  try {
    const raw = localStorage.getItem(REPORTS_KEY)
    const v = raw ? (JSON.parse(raw) as Partial<StoredReports> | null) : null
    return {
      weeks: v && typeof v.weeks === 'object' && v.weeks ? v.weeks : {},
      files: v && typeof v.files === 'object' && v.files ? v.files : {},
    }
  } catch {
    return { weeks: {}, files: {} }
  }
}

/** 보고서 목록 쓰기. 저장 공간이 모자라면 오류 ('냈어요'로 보이는데 사라지지 않도록) */
function writeReports(r: StoredReports) {
  try {
    localStorage.setItem(REPORTS_KEY, JSON.stringify(r))
  } catch {
    throw quotaError()
  }
}

function toCalEvent(e: StoredEvent): CalEvent {
  return { id: e.id, title: e.title, startDate: e.startDate, endDate: e.endDate, color: e.color, hasNote: e.hasNote, updatedAt: e.updatedAt }
}

function safeGet(): LocalData | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as LocalData) : null
  } catch {
    return null
  }
}

export class LocalBackend implements Backend {
  readonly mode = 'local' as const
  private data: LocalData
  private channel: BroadcastChannel | null = null

  /** 처음 실행이면 체험용 명단을 채워 넣는 작업 */
  private ready: Promise<void>
  /** 처음 캘린더를 열 때 2027년 seed 일정을 넣는 작업 (한 번만) */
  private calendarReady: Promise<void> | null = null

  constructor() {
    const existing = safeGet()
    this.data = existing ?? { passcode: DEFAULT_PASSCODE, groups: [], members: [], attendance: {}, notes: {} }
    this.ready = existing ? Promise.resolve() : this.seed()
    try {
      this.channel = new BroadcastChannel(KEY)
    } catch {
      this.channel = null
    }
  }

  /**
   * 체험 모드 첫 실행: 엑셀(2026.10.11) 실제 명단을 넣어 둔다.
   * 서버 모드로 빌드할 때는 이 코드와 명단 파일이 통째로 빠진다 (명단이 공개 파일에 들어가지 않도록).
   */
  private async seed() {
    if (import.meta.env.VITE_SUPABASE_URL) return
    const { buildSeedRoster } = await import('../lib/seed')
    const roster = buildSeedRoster()
    if (!safeGet()) {
      this.data = { ...this.data, ...roster }
      this.persist()
    }
  }

  private reload() {
    const fresh = safeGet()
    if (fresh) this.data = fresh
  }

  private persist(scope?: ChangeScope) {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data))
    } catch {
      // 저장 공간이 없거나 막혀 있으면 메모리에만 남는다
    }
    if (scope) this.channel?.postMessage(scope)
  }

  /** persist 와 같지만, 저장 공간이 모자라면 오류를 내요 (캘린더 저장용) */
  private persistOrThrow(scope: ChangeScope) {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data))
    } catch {
      // 메모리의 바뀐 내용은 버리고 저장된 내용으로 되돌려요
      this.reload()
      throw quotaError()
    }
    this.channel?.postMessage(scope)
  }

  async login(passcode: string) {
    await this.ready
    this.reload()
    return passcode === this.data.passcode
  }

  async changePasscode(current: string, next: string) {
    this.reload()
    if (current !== this.data.passcode) throw new Error('지금 비밀번호가 맞지 않아요')
    this.data.passcode = next
    this.persist()
  }

  async fetchRoster(): Promise<Roster> {
    await this.ready
    this.reload()
    return { groups: structuredClone(this.data.groups), members: structuredClone(this.data.members) }
  }

  async fetchAttendance(from: ISODate, to: ISODate) {
    this.reload()
    return Object.values(this.data.attendance).filter((r) => r.date >= from && r.date <= to)
  }

  async fetchWeekNotes(from: ISODate, to: ISODate) {
    this.reload()
    return Object.values(this.data.notes).filter((n) => n.date >= from && n.date <= to)
  }

  async saveAttendance(record: AttendanceRecord) {
    this.reload()
    this.data.attendance[`${record.date}|${record.memberId}`] = record
    this.persist('attendance')
  }

  async clearAttendance(date: ISODate, memberId: string) {
    this.reload()
    delete this.data.attendance[`${date}|${memberId}`]
    this.persist('attendance')
  }

  async saveWeekNote(note: WeekNote) {
    this.reload()
    this.data.notes[note.date] = note
    this.persist('notes')
  }

  async saveGroup(group: Group) {
    await this.saveGroups([group])
  }

  async saveGroups(groups: Group[]) {
    this.reload()
    for (const g of groups) {
      const i = this.data.groups.findIndex((x) => x.id === g.id)
      if (i >= 0) this.data.groups[i] = g
      else this.data.groups.push(g)
    }
    this.persist('roster')
  }

  async saveMember(member: Member) {
    await this.saveMembers([member])
  }

  async saveMembers(members: Member[]) {
    this.reload()
    for (const m of members) {
      const i = this.data.members.findIndex((x) => x.id === m.id)
      if (i >= 0) this.data.members[i] = m
      else this.data.members.push(m)
    }
    this.persist('roster')
  }

  async importRoster(groups: Group[], members: Member[]) {
    await this.ready
    this.reload()
    // 쓰는 목장이나 명단에 있는 사람이 있으면 넣지 않는다 (삭제한 목장만 남아 있으면 넣는다)
    if (this.data.groups.some((g) => !g.archived) || this.data.members.some((m) => m.removedOn === null)) return 'exists' as const
    this.data.groups = [...this.data.groups, ...groups]
    this.data.members = [...this.data.members, ...members]
    this.persist('roster')
    return 'done' as const
  }

  async purgeMember(memberId: string) {
    this.reload()
    this.data.members = this.data.members.filter((m) => m.id !== memberId)
    for (const k of Object.keys(this.data.attendance)) {
      if (this.data.attendance[k].memberId === memberId) delete this.data.attendance[k]
    }
    this.persist('roster')
  }

  subscribe(onChange: (scope: ChangeScope) => void) {
    const ch = this.channel
    if (!ch) return () => {}
    const handler = (e: MessageEvent) => {
      const scope = SCOPES.find((x) => x === e.data)
      if (scope) onChange(scope)
    }
    ch.addEventListener('message', handler)
    return () => ch.removeEventListener('message', handler)
  }

  /* ── 목장 완료 / 수정 ── */

  async fetchGroupDays(from: ISODate, to: ISODate) {
    this.reload()
    return Object.values(this.data.groupDays ?? {})
      .filter((d) => d.date >= from && d.date <= to)
      .map((d) => ({ ...d }))
  }

  async setGroupDay(date: ISODate, groupId: string, action: GroupDayAction): Promise<GroupDayResult> {
    this.reload()
    const key = `${date}|${groupId}`
    const cur = this.data.groupDays?.[key] ?? null
    const now = new Date().toISOString()
    let next = cur
    let notify: GroupDayResult['notify'] = null
    if (action === 'complete') {
      if (!cur) {
        next = { date, groupId, state: 'done', doneAt: now, editCount: 0, updatedAt: now }
        notify = 'done'
      } else if (cur.state === 'editing') {
        next = { ...cur, state: 'done', doneAt: now, editCount: cur.editCount + 1, updatedAt: now }
        notify = 'edited'
      }
    } else if (cur?.state === 'done') {
      next = { ...cur, state: 'editing', updatedAt: now }
    }
    if (next && next !== cur) {
      this.data.groupDays = { ...(this.data.groupDays ?? {}), [key]: next }
      this.persist('status')
    }
    return { day: next ? { ...next } : null, notify }
  }

  /** 같은 브라우저의 다른 탭에 알림 (보낸 탭 자신은 받지 않아요) */
  async sendNotice(notice: CompletionNotice) {
    try {
      this.channel?.postMessage({ notice })
    } catch {
      /* 알림이 안 가도 완료는 이미 저장됐어요 */
    }
  }

  onNotice(fn: (notice: CompletionNotice) => void) {
    const ch = this.channel
    if (!ch) return () => {}
    const handler = (e: MessageEvent) => {
      const data: unknown = e.data
      if (typeof data !== 'object' || data === null || !('notice' in data)) return
      const notice = parseNotice((data as { notice: unknown }).notice)
      if (notice) fn(notice)
    }
    ch.addEventListener('message', handler)
    return () => ch.removeEventListener('message', handler)
  }

  /** 체험 모드에는 알림 서버가 없어요 */
  async savePushSubscription() {}
  async deletePushSubscription() {}

  /* ── 청년회 캘린더 ── */

  /**
   * 처음 캘린더를 쓸 때 2027년 seed 일정을 넣어요 (출석 체험 데이터가 이미 있는 브라우저도).
   * 다 지운 뒤에도 다시 넣지 않도록 calendarSeeded 를 남겨요.
   * 서버 모드로 빌드할 때는 이 코드와 seed 파일이 통째로 빠져요.
   */
  private ensureCalendar(): Promise<void> {
    this.calendarReady ??= (async () => {
      if (import.meta.env.VITE_SUPABASE_URL) return
      await this.ready
      this.reload()
      if (this.data.calendarSeeded) return
      const { SEED_EVENTS, seedNoteDoc } = await import('../lib/calendarSeed')
      this.reload()
      // 내려받는 사이 다른 탭이 먼저 넣었으면 그대로
      if (this.data.calendarSeeded) return
      const now = new Date().toISOString()
      const events = { ...(this.data.events ?? {}) }
      for (const e of SEED_EVENTS) {
        if (events[e.id]) continue
        events[e.id] = {
          id: e.id,
          title: e.title,
          startDate: e.startDate,
          endDate: e.endDate,
          color: e.color,
          hasNote: false,
          updatedAt: now,
          deletedAt: null,
        }
        if (!readNote(e.id)) {
          try {
            // 글자 수는 0: 📝 표시는 누가 실제로 쓴 뒤에만 보여요 (서버 seed 와 같게)
            writeNote(e.id, { doc: seedNoteDoc(e.memo), plainLen: 0, version: 1, updatedAt: now })
          } catch {
            /* 저장 공간이 모자라면 첫 문단만 빠져요 */
          }
        }
      }
      this.data.events = events
      this.data.calendarSeeded = true
      this.persist('calendar')
    })().catch((e: unknown) => {
      // 다음에 다시 해 볼 수 있게
      this.calendarReady = null
      throw e
    })
    return this.calendarReady
  }

  /** 지운 지 30일이 지난 일정은 회의록과 함께 정리해요. 정리한 게 있으면 true */
  private purgeOldEvents(): boolean {
    const events = this.data.events
    if (!events) return false
    const limit = Date.now() - RESTORE_DAYS * 86_400_000
    let changed = false
    for (const [id, e] of Object.entries(events)) {
      if (e.deletedAt && Date.parse(e.deletedAt) < limit) {
        delete events[id]
        removeNote(id)
        changed = true
      }
    }
    return changed
  }

  async fetchEvents(): Promise<CalEvent[]> {
    await this.ensureCalendar()
    this.reload()
    return Object.values(this.data.events ?? {})
      .filter((e) => !e.deletedAt)
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || b.endDate.localeCompare(a.endDate) || a.id.localeCompare(b.id))
      .map(toCalEvent)
  }

  async saveEvent(input: CalEventInput): Promise<CalEvent> {
    await this.ensureCalendar()
    // 서버(am_save_event)와 같은 검사
    const title = (input.title ?? '').trim()
    const start = dayNumber(input.startDate)
    const end = dayNumber(input.endDate)
    if (
      !UUID_RE.test(input.id) ||
      [...title].length < 1 ||
      [...title].length > 60 ||
      !EVENT_COLORS.includes(input.color) ||
      start === null ||
      end === null ||
      input.startDate < '2000-01-01' ||
      input.endDate > '2100-12-31' ||
      end < start ||
      end - start > 59
    ) {
      throw invalidError()
    }
    this.reload()
    const events = (this.data.events ??= {})
    const cur = events[input.id]
    if (cur?.deletedAt) throw notFoundError()
    const next: StoredEvent = {
      id: input.id,
      title,
      startDate: input.startDate,
      endDate: input.endDate,
      color: input.color,
      hasNote: cur?.hasNote ?? false,
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    }
    events[input.id] = next
    this.persistOrThrow('calendar')
    return toCalEvent(next)
  }

  async deleteEvent(id: string): Promise<void> {
    await this.ensureCalendar()
    this.reload()
    const e = this.data.events?.[id]
    const now = new Date().toISOString()
    let changed = false
    if (e && !e.deletedAt) {
      e.deletedAt = now
      e.updatedAt = now
      changed = true
    }
    if (this.purgeOldEvents()) changed = true
    if (changed) this.persistOrThrow('calendar')
  }

  async restoreEvent(id: string): Promise<void> {
    await this.ensureCalendar()
    this.reload()
    const e = this.data.events?.[id]
    if (!e) throw notFoundError()
    if (!e.deletedAt) return
    e.deletedAt = null
    e.updatedAt = new Date().toISOString()
    this.persistOrThrow('calendar')
  }

  async fetchEventNote(eventId: string): Promise<EventNote> {
    await this.ensureCalendar()
    this.reload()
    const e = this.data.events?.[eventId]
    if (!e || e.deletedAt) throw notFoundError()
    const n = readNote(eventId)
    if (!n) return { doc: null, version: 0, updatedAt: null }
    return { doc: n.doc, version: n.version, updatedAt: n.updatedAt || null }
  }

  async saveEventNote(
    eventId: string,
    doc: unknown,
    plainLen: number,
    baseVersion: number,
    force = false,
  ): Promise<SaveNoteResult> {
    await this.ensureCalendar()
    // 서버(am_save_event_note)와 같은 검사
    if (typeof doc !== 'object' || doc === null || Array.isArray(doc) || (doc as { type?: unknown }).type !== 'doc') {
      throw invalidError()
    }
    const len = Math.max(0, Math.round(plainLen) || 0)
    let bytes: number
    try {
      bytes = new TextEncoder().encode(JSON.stringify(doc)).length
    } catch {
      throw invalidError()
    }
    if (bytes > NOTE_MAX_BYTES) {
      throw new LocalError('invalid', '회의록이 너무 길어요. 내용을 조금 줄이거나 다른 일정에 나눠 적어 주세요.', 'too_big')
    }
    // 다른 탭이 그사이 지웠거나 먼저 저장했을 수 있어서, 저장된 내용을 새로 읽고 비교해요
    this.reload()
    const e = this.data.events?.[eventId]
    if (!e || e.deletedAt) throw notFoundError()
    const cur = readNote(eventId)
    const curVersion = cur?.version ?? 0
    if (!force && curVersion !== Math.max(0, Math.round(baseVersion) || 0)) {
      return {
        ok: false,
        latest: { doc: cur?.doc ?? null, version: curVersion, updatedAt: cur?.updatedAt || null },
      }
    }
    const updatedAt = new Date().toISOString()
    const version = curVersion + 1
    writeNote(eventId, { doc, plainLen: len, version, updatedAt })
    if (e.hasNote !== len > 0) {
      e.hasNote = len > 0
      // 📝 표시만 바뀌는 것이라, 저장 공간이 모자라도 회의록 저장은 이미 끝났어요
      this.persist('calendar')
    } else {
      this.channel?.postMessage('calendar')
    }
    return { ok: true, version, updatedAt }
  }

  /* ── 목장보고서 ──
   * 목록은 localStorage, PDF 는 이 브라우저의 IndexedDB (못 쓰면 메모리: 새로고침하면 사라져요).
   * 서버(am_report_*)와 같은 규칙: 마감된 주는 올리기·지우기 막기, 없거나 지운 목장은 막기,
   * 다시 올리면 예전 파일은 지우기, 마감할 때 1년 지난 주 정리,
   * 낸 사람(주인 열쇠)만 열고·바꾸고·지우기, 마감·마감 풀기·합친 PDF·남의 것 지우기는 담당 비밀번호.
   */

  /** 이 탭 안의 보고서 작업은 하나씩 (마감과 올리기가 엇갈리지 않도록) */
  private reportQueue: Promise<unknown> = Promise.resolve()
  /** 틀린 담당 비밀번호 기록 (서버처럼 10분 안에 서로 다른 틀린 값 10번이면 잠시 막아요. 이 탭 메모리에만) */
  private pinFails: { pin: string; at: number }[] = []

  private inReportQueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.reportQueue.then(fn)
    this.reportQueue = run.catch(() => undefined)
    return run
  }

  /** 지금 쓰는 목장 순서 (보고서 목록을 목장 순서대로) */
  private groupOrder(): Map<string, number> {
    const groups = [...this.data.groups].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    return new Map(groups.map((g, i) => [g.id, i]))
  }

  /** 정해 둔 담당 비밀번호 (아직 안 바꿨으면 처음 값 0000) */
  private savedPin(): string | null {
    const p = this.data.reportPin ?? DEFAULT_REPORT_PIN
    return typeof p === 'string' && PIN_RE.test(p) ? p : null
  }

  /** 담당 비밀번호 확인 (서버의 am__verify_admin 과 같게). 틀리거나 막혔으면 오류 */
  private verifyPin(pin: string | null | undefined) {
    const now = Date.now()
    this.pinFails = this.pinFails.filter((f) => now - f.at < PIN_WINDOW_MS)
    if (new Set(this.pinFails.map((f) => f.pin)).size >= PIN_LIMIT) throw pinLockedError()
    this.reload()
    const want = this.savedPin()
    // 아직 정하지 않았으면 아무 값도 통하지 않아요 (틀린 기록도 남기지 않아요. 서버와 같게)
    if (!want) throw pinUnsetError()
    if (typeof pin === 'string' && PIN_RE.test(pin) && pin === want) return
    const tried = (pin ?? '').slice(0, 64)
    if (!this.pinFails.some((f) => f.pin === tried)) this.pinFails.push({ pin: tried, at: now })
    throw badPinError()
  }

  async fetchReports(date: ISODate): Promise<ReportWeek> {
    await this.ready
    this.reload()
    const r = readReports()
    const order = this.groupOrder()
    const mine = await ownerHashes(ownersFor(date))
    const files = Object.values(r.files)
      .filter((f) => f.date === date)
      .sort((a, b) => (order.get(a.groupId) ?? 1e9) - (order.get(b.groupId) ?? 1e9) || a.groupId.localeCompare(b.groupId))
      .map((f) => toReportFile(f, !!f.ownerHash && mine.has(f.ownerHash)))
    return { date, closedAt: r.weeks[date]?.closedAt ?? null, files }
  }

  uploadReport(date: ISODate, groupId: string, pdf: Uint8Array, fileName: string, pages: number): Promise<ReportFile> {
    return this.inReportQueue(async () => {
      await this.ready
      if (dayNumber(date) === null || !UUID_RE.test(groupId) || !(pdf instanceof Uint8Array) || pdf.byteLength === 0) {
        throw invalidError()
      }
      if (pdf.byteLength > REPORT_MAX_BYTES) {
        throw new LocalError('invalid', '파일이 너무 커요 (최대 45MB). 쪽수를 줄이거나 나눠서 올려 주세요.', 'too_big')
      }
      this.reload()
      const g = this.data.groups.find((x) => x.id === groupId)
      if (!g || g.archived) throw noGroupError()
      // 마감된 주, 1년 넘게 지난 주(마감할 때 정리되는 주)는 더 못 올려요 (서버와 같게)
      if (date < addDays(todayKST(), -REPORT_KEEP_DAYS) || readReports().weeks[date]?.closedAt) throw closedError()
      const key = `${date}|${groupId}`
      const hash = await ownerHash(ensureOwner(date, groupId))
      // 다른 사람이 낸 보고서(열쇠 없는 예전 것 포함)는 바꿀 수 없어요
      const before = readReports().files[key]
      if (before && before.ownerHash !== hash) throw notOwnerError()

      const path = `reports/${date}/${groupId.toLowerCase()}/${newId()}.pdf`
      const kept = await putReportBlob(path, pdf)
      if (!kept) console.info('[체험 모드] 이 브라우저에 파일을 저장하지 못해서 메모리에만 뒀어요. 새로고침하면 사라져요.')

      // 저장하는 사이 다른 탭이 마감했거나 먼저 냈을 수 있어서 목록을 새로 읽어요
      const r = readReports()
      const cur = r.files[key]
      if (r.weeks[date]?.closedAt || (cur && cur.ownerHash !== hash)) {
        await deleteReportBlobs([path])
        throw r.weeks[date]?.closedAt ? closedError() : notOwnerError()
      }
      const old = cur?.path ?? null
      const name = (fileName ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || '보고서.pdf'
      const stored: StoredReportFile = {
        groupId,
        date,
        path,
        fileName: name,
        pages: Math.max(0, Math.round(pages) || 0),
        sizeBytes: pdf.byteLength,
        uploadedAt: new Date().toISOString(),
        ownerHash: hash,
      }
      r.files[key] = stored
      try {
        writeReports(r)
      } catch (e) {
        await deleteReportBlobs([path])
        throw e
      }
      if (old && old !== path) await deleteReportBlobs([old])
      this.channel?.postMessage('reports')
      return toReportFile(stored, true)
    })
  }

  deleteReport(date: ISODate, groupId: string, adminPin?: string): Promise<void> {
    return this.inReportQueue(async () => {
      if (adminPin) this.verifyPin(adminPin)
      const r = readReports()
      if (r.weeks[date]?.closedAt) throw closedError()
      const key = `${date}|${groupId}`
      const cur = r.files[key]
      if (!cur) return
      if (!adminPin) {
        const owner = ownerFor(date, groupId)
        if (!owner || !cur.ownerHash || cur.ownerHash !== (await ownerHash(owner))) throw notOwnerError()
      }
      delete r.files[key]
      writeReports(r)
      await deleteReportBlobs([cur.path])
      this.channel?.postMessage('reports')
    })
  }

  async downloadAllReports(date: ISODate, adminPin: string): Promise<{ groupId: string; bytes: Uint8Array | null }[]> {
    this.verifyPin(adminPin)
    const files = Object.values(readReports().files).filter((f) => f.date === date)
    return Promise.all(
      files.map(async (f) => {
        try {
          return { groupId: f.groupId, bytes: await getReportBlob(f.path) }
        } catch {
          return { groupId: f.groupId, bytes: null }
        }
      }),
    )
  }

  /**
   * 체험 모드: blob: 주소를 돌려줘요 (이 기기가 낸 보고서만). 다 쓰면 부르는 쪽이 URL.revokeObjectURL 로 꼭 풀어 주세요 (메모리).
   * blob 주소에는 파일 이름을 붙일 수 없어서 downloadName 은 쓰지 않아요
   * (이름을 붙여 받으려면 <a download="이름"> 으로 여세요).
   */
  async reportFileUrl(path: string): Promise<string> {
    const f = Object.values(readReports().files).find((x) => x.path === path)
    const date = dateOfPath(path)
    const mine = date ? await ownerHashes(ownersFor(date)) : new Set<string>()
    // 남이 낸 보고서는 경로를 알아도 열 수 없어요 (서버와 같게)
    if (!f || !f.ownerHash || !mine.has(f.ownerHash)) throw reportGoneError()
    const bytes = await getReportBlob(path)
    if (!bytes) {
      throw new LocalError('server', '체험 모드라 이 기기에서 파일이 사라졌어요 (새로고침하면 지워질 수 있어요). 다시 올려 주세요.', 'gone')
    }
    const blob = new Blob([bytes.slice()], { type: 'application/pdf' })
    return URL.createObjectURL(blob)
  }

  closeReports(date: ISODate, adminPin: string): Promise<string> {
    return this.inReportQueue(async () => {
      if (dayNumber(date) === null) throw invalidError()
      this.verifyPin(adminPin)
      const r = readReports()
      const closedAt = r.weeks[date]?.closedAt ?? new Date().toISOString()
      r.weeks[date] = { closedAt }

      // 1년 지난 주의 보고서 정리 (서버의 am_report_close 와 같게)
      const cutoff = addDays(todayKST(), -REPORT_KEEP_DAYS)
      const prune: string[] = []
      for (const [k, f] of Object.entries(r.files)) {
        if (f.date < cutoff) {
          prune.push(f.path)
          delete r.files[k]
        }
      }
      // 마감 표시는 남겨요 (지우면 그 주가 다시 '마감 전'이 돼요)
      for (const d of Object.keys(r.weeks)) {
        if (d < cutoff && !r.weeks[d]?.closedAt && !Object.values(r.files).some((f) => f.date === d)) delete r.weeks[d]
      }
      writeReports(r)

      // 목록에 없는 파일(올리다 멈춘 것 등)도 정리. 아직 올리는 중일 수 있는 주(마감 전)는 건드리지 않아요
      try {
        const referenced = new Set(Object.values(r.files).map((f) => f.path))
        for (const p of await listReportPaths()) {
          const d = /^reports\/(\d{4}-\d{2}-\d{2})\//.exec(p)?.[1]
          if (referenced.has(p)) continue
          if (!d || d < cutoff || r.weeks[d]?.closedAt) prune.push(p)
        }
      } catch {
        /* 정리는 다음에 해도 돼요 */
      }
      if (prune.length) await deleteReportBlobs([...new Set(prune)])
      this.channel?.postMessage('reports')
      return closedAt
    })
  }

  reopenReports(date: ISODate, adminPin: string): Promise<void> {
    return this.inReportQueue(async () => {
      this.verifyPin(adminPin)
      const r = readReports()
      if (!r.weeks[date]?.closedAt) return
      r.weeks[date] = { closedAt: null }
      writeReports(r)
      this.channel?.postMessage('reports')
    })
  }

  async checkReportPin(pin: string): Promise<void> {
    this.verifyPin(pin)
  }

  async reportPinIsSet(): Promise<boolean> {
    this.reload()
    return this.savedPin() !== null
  }

  async changeReportPin(current: string | null, next: string): Promise<void> {
    if (!PIN_RE.test(next)) {
      throw new LocalError('invalid', '새 담당 비밀번호는 숫자 4~8자리로 정해 주세요.', 'invalid_pin')
    }
    this.reload()
    // 처음 정할 때는 지금 비밀번호가 없어요 (서버와 같게)
    if (this.savedPin()) this.verifyPin(current)
    this.data.reportPin = next
    this.persist()
  }
}
