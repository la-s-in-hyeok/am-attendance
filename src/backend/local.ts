import type { AttendanceRecord, CompletionNotice, Group, GroupDay, ISODate, Member, WeekNote } from '../lib/types'
import type { Backend, ChangeScope, GroupDayAction, GroupDayResult, Roster } from './types'
import { parseNotice } from '../lib/push'

/**
 * 체험 모드: 이 브라우저의 localStorage 에만 저장한다.
 * 같은 브라우저의 다른 탭과는 BroadcastChannel 로 실시간 동기화된다.
 */
const KEY = 'am-attendance:v1'
const DEFAULT_PASSCODE = '0000'

interface LocalData {
  passcode: string
  groups: Group[]
  members: Member[]
  attendance: Record<string, AttendanceRecord>
  notes: Record<ISODate, WeekNote>
  /** key = `${date}|${groupId}` (예전 체험 데이터에는 없음) */
  groupDays?: Record<string, GroupDay>
}

const SCOPES: ChangeScope[] = ['roster', 'attendance', 'notes', 'status']

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
}
