import { create } from 'zustand'
import type { AttendanceRecord, CompletionNotice, Group, GroupDay, ISODate, Member, Service, Status, WeekNote } from './lib/types'
import type { Backend, ChangeScope, GroupDayAction, GroupDayResult } from './backend/types'
import { createBackend } from './backend'
import { currentSunday, addDays, sundayOnOrBefore } from './lib/dates'
import { recKey } from './lib/compute'
import { newId } from './lib/id'
import { mergeWeekNote } from './lib/notes'
import { removalDate, rosterChangeFrom } from './lib/roster'
import { currentPushEndpoint, disableNotifications } from './lib/push'

/** 화면(탭). 출석부 안에 attend(출석)·report(출석보고)·stats(통계)가 있고, 그 밖에 캘린더·목장보고서·관리 */
export type Tab = 'attend' | 'report' | 'stats' | 'calendar' | 'groupReport' | 'manage'
/** 출석부 안쪽 탭 */
export type AttendTab = 'attend' | 'report' | 'stats'

/** 출석부 안쪽 탭(출석·출석보고·통계)인지 */
export function isAttendTab(t: Tab): t is AttendTab {
  return t === 'attend' || t === 'report' || t === 'stats'
}
export type SyncState = 'idle' | 'saving' | 'error'

const PASS_KEY = 'am-attendance:passcode'
const FAR_FUTURE = '9999-12-31'

/** 목장 완료 상태의 key */
export function groupDayKey(date: ISODate, groupId: string): string {
  return `${date}|${groupId}`
}

/** 완료된 목장의 출석을 바꾸려고 할 때 */
export const LOCKED_MESSAGE = "완료된 목장이에요. 고치려면 '수정'을 눌러 주세요"

function dayMap(days: GroupDay[]): Record<string, GroupDay> {
  const out: Record<string, GroupDay> = {}
  for (const d of days) out[groupDayKey(d.date, d.groupId)] = d
  return out
}

/** 이 저장소가 불러오는 데이터 (캘린더·목장보고서는 각자 저장소가 따로 불러와요) */
const MAIN_SCOPES: readonly ChangeScope[] = ['roster', 'attendance', 'notes', 'status']

/** 한글 안내가 담긴 오류면 그 문구를, 아니면 기본 문구를 */
function koreanMessage(e: unknown, fallback: string): string {
  const m = e instanceof Error ? e.message : ''
  return /[가-힣]/.test(m) ? m : fallback
}

function readSavedPasscode(): string | null {
  try {
    return localStorage.getItem(PASS_KEY)
  } catch {
    return null
  }
}
function writeSavedPasscode(code: string | null) {
  try {
    if (code === null) localStorage.removeItem(PASS_KEY)
    else localStorage.setItem(PASS_KEY, code)
  } catch {
    /* 무시 */
  }
}

/** 기본으로 불러오는 기간: 작년 1월 1일부터 */
function defaultLoadFrom(): ISODate {
  const y = Number(currentSunday().slice(0, 4))
  return `${y - 1}-01-01`
}

export interface ToastAction {
  label: string
  run: () => void
}

export interface Toast {
  id: string
  text: string
  tone: 'info' | 'error' | 'success'
  /** 예: '되돌리기' */
  action?: ToastAction
}

interface State {
  backend: Backend
  authed: boolean
  passcode: string | null
  /** 처음 데이터를 불러오는 중 */
  booting: boolean
  bootError: string | null

  groups: Group[]
  members: Member[]
  /** key = `${date}|${memberId}` */
  records: Record<string, AttendanceRecord>
  notes: Record<ISODate, WeekNote>
  /** 목장 완료 상태. key = `${date}|${groupId}`. 없으면 아직 완료 전 */
  groupDays: Record<string, GroupDay>
  /** 이 날짜부터 불러와 있음 */
  loadedFrom: ISODate

  /** 지금 보고 있는 주일 */
  date: ISODate
  /** 앱을 연 시점의 '이번 주일' (주일이 바뀌면 자동으로 넘어가기 위해) */
  autoDate: ISODate
  tab: Tab
  /** 출석부 안쪽 탭 중 마지막으로 본 것 (아래 '출석부' 탭을 누르면 여기로 돌아와요) */
  attendTab: AttendTab
  /** 열어 둔 목장 (출석 탭) */
  groupId: string | null
  /** 지금 켜져 있는 탭을 한 번 더 누른 횟수 (캘린더는 이걸 보고 회의록을 닫고 달력으로 돌아가요) */
  tabRetap: number

  sync: SyncState
  pending: number
  toasts: Toast[]

  // 인증
  tryAutoLogin(): Promise<void>
  login(code: string, remember: boolean): Promise<boolean>
  logout(): void
  changePasscode(current: string, next: string): Promise<void>

  // 데이터
  loadAll(): Promise<void>
  refresh(scope?: ChangeScope): Promise<void>
  ensureLoadedFrom(from: ISODate): Promise<void>

  // 화면
  /** 주일로 맞추고, 다음 주일보다 먼 날짜는 막는다 */
  setDate(d: ISODate): void
  setTab(t: Tab): void
  /**
   * 탭을 누를 때 (아래 탭·PC 왼쪽 메뉴·출석부 안쪽 탭이 같이 써요).
   * 목장 화면이 열려 있으면 '뒤로 가기' 기록까지 정리하고 닫고, 다른 탭은 맨 위부터 보여 준다
   */
  goTab(t: Tab): void
  openGroup(id: string | null): void
  checkSundayRollover(): void
  toast(text: string, tone?: Toast['tone'], action?: ToastAction): void
  dismissToast(id: string): void

  // 출석 — 모두 저장에 성공하면 true
  /** 상태 저장. 'present' 이면 이미 출석이던 예배(1부/2부)를 유지하고, 처음이면 1부 */
  setStatus(memberId: string, status: Status, reason?: string, date?: ISODate): Promise<boolean>
  /** 출석 체크: 1부(노랑) 또는 2부(민트) */
  markPresent(memberId: string, service: Service, date?: ISODate): Promise<boolean>
  clearStatus(memberId: string, date?: ISODate): Promise<boolean>
  /**
   * 주간 기타 기록 저장.
   * base(편집을 시작할 때의 기록)를 주면, 그사이 다른 기기에서 넣은 새신자·방문을 지우지 않도록
   * 서버의 최신 기록과 합쳐서 저장한다. 실제로 저장된(합쳐진) 기록을 돌려준다. 실패하면 null.
   */
  saveNote(note: Omit<WeekNote, 'updatedAt'>, base?: WeekNote | null): Promise<WeekNote | null>

  // 명단 관리 — 실패하면 화면도 원래대로 되돌린다
  addGroup(name: string): Promise<Group | null>
  updateGroup(group: Group): Promise<boolean>
  reorderGroups(orderedIds: string[]): Promise<boolean>
  addMembers(groupId: string, names: string[], joinedOn?: ISODate): Promise<Member[]>
  updateMember(member: Member): Promise<boolean>
  /**
   * 목장 이동. 적용 주일(rosterChangeFrom)과 그 뒤 기록도 새 목장으로 옮긴다.
   * 평일에 옮기면 다음 주일부터라서, 이미 보고한 지난 주일 출석부는 그대로다.
   */
  moveMember(memberId: string, groupId: string): Promise<boolean>
  /** 명단에서 빼기 (지난 기록은 남음). 적용 주일(또는 마지막 기록 다음 주일)부터 빠진다 */
  removeMember(memberId: string): Promise<boolean>
  /** 빼기 취소. groupId 를 주면 그 목장으로 넣는다 (한 번에 저장) */
  restoreMember(memberId: string, groupId?: string): Promise<boolean>
  purgeMember(memberId: string): Promise<boolean>

  // 목장 완료 / 수정 — 성공하면 true
  /**
   * 완료 (수정 중이면 '수정 완료'). 성공하면 다른 기기에 알린다:
   * "OO목장 출석체크 완료했습니다" / "OO목장 수정있어요!!!!!!"
   */
  completeGroup(groupId: string, date?: ISODate): Promise<boolean>
  /** 완료한 목장을 다시 고칠 수 있게 (수정 중) */
  editGroup(groupId: string, date?: ISODate): Promise<boolean>
  /** 완료된 목장이라 바꿀 수 없다는 안내 (여러 번 눌러도 하나만) */
  toastLocked(): void
  /** 이 사람의 그 주일 목장이 완료(잠김) 상태인지 */
  isMemberLocked(memberId: string, date?: ISODate): boolean
}

export const useStore = create<State>((set, get) => {
  /**
   * 화면에 먼저 반영한 변경의 '번호'. 서버에서 새로 받아온 내용이 도착했을 때,
   * 받기 시작한 뒤에 이 기기에서 바뀐 것이 있으면 덮어쓰지 않고 한 번 더 받는다.
   */
  const seq: Record<ChangeScope, number> = { roster: 0, attendance: 0, notes: 0, status: 0, calendar: 0, reports: 0 }
  const bump = (scope: ChangeScope) => {
    seq[scope]++
  }

  /** 서버 저장을 감싸서 저장 중/실패 표시를 관리한다. 성공하면 true */
  async function persist(fn: () => Promise<unknown>, onFail?: () => void): Promise<boolean> {
    set((s) => ({ pending: s.pending + 1, sync: 'saving' }))
    try {
      await fn()
      set((s) => ({ pending: s.pending - 1, sync: s.pending - 1 > 0 ? 'saving' : s.sync === 'error' ? 'error' : 'idle' }))
      return true
    } catch (e) {
      console.error(e)
      onFail?.()
      // 다른 기기에서 그사이 '완료'를 눌러 잠긴 목장: 연결 문제가 아니라 잠금이니 안내만 하고 상태를 새로 받는다
      if ((e as { code?: string } | null)?.code === 'group_done') {
        set((s) => ({ pending: s.pending - 1, sync: s.pending - 1 > 0 ? 'saving' : 'idle' }))
        get().toastLocked()
        void get().refresh('status')
        return false
      }
      set((s) => ({ pending: s.pending - 1, sync: 'error' }))
      if (handleAuthError(e)) return false
      // 연달아 실패하면 저장된 적 없는 값이 화면에 남을 수 있어서, 연결되면 서버 내용으로 다시 맞춘다
      deferRefresh()
      get().toast(koreanMessage(e, '저장하지 못했어요. 인터넷 연결을 확인해 주세요.'), 'error')
      return false
    }
  }

  /** 다른 기기에서 비밀번호가 바뀌었으면 로그아웃시키고 안내한다. 처리했으면 true */
  function handleAuthError(e: unknown): boolean {
    if ((e as { kind?: string } | null)?.kind !== 'auth') return false
    if (get().authed) {
      get().logout()
      get().toast('비밀번호가 바뀌었어요. 새 비밀번호로 다시 들어와 주세요.', 'error')
    }
    return true
  }

  /** 명단(목장·목장원)을 화면에서 바꾸고, 실패하면 바꾸기 전으로 되돌릴 함수를 돌려준다 */
  function setRoster(next: { groups?: Group[]; members?: Member[] }): () => void {
    const before = { groups: get().groups, members: get().members }
    bump('roster')
    set(next)
    const applied = { groups: get().groups, members: get().members }
    return () => {
      // 그사이 다른 변경이 없을 때만 되돌린다
      if (get().groups === applied.groups && get().members === applied.members) {
        bump('roster')
        set(before)
      }
    }
  }

  /** 그 주일에 완료된(잠긴) 목장인지. 수정 중이거나 완료 전이면 false */
  function isLocked(date: ISODate, groupId: string): boolean {
    return get().groupDays[groupDayKey(date, groupId)]?.state === 'done'
  }

  /** 출석 기록 하나를 저장 (화면에 먼저 반영하고, 실패하면 되돌린다) */
  async function saveRecord(memberId: string, status: Status, reason: string, date?: ISODate, service?: Service): Promise<boolean> {
    const d = date ?? get().date
    const member = get().members.find((m) => m.id === memberId)
    if (!member) return false
    const key = recKey(d, memberId)
    const prev = get().records[key]
    if (isLocked(d, prev?.groupId ?? member.groupId)) {
      get().toastLocked()
      return false
    }
    const record: AttendanceRecord = {
      date: d,
      memberId,
      groupId: prev?.groupId ?? member.groupId,
      status,
      service: status === 'present' ? (service ?? (prev?.status === 'present' && prev.service === 2 ? 2 : 1)) : null,
      reason: status === 'present' ? '' : reason.trim(),
      updatedAt: new Date().toISOString(),
    }
    bump('attendance')
    set((s) => ({ records: { ...s.records, [key]: record } }))
    return persist(
      () => get().backend.saveAttendance(record),
      () => {
        // 그사이 같은 사람을 다시 눌렀으면(더 새 기록) 되돌리지 않는다
        if (get().records[key] !== record) return
        bump('attendance')
        set((s) => {
          const records = { ...s.records }
          if (prev) records[key] = prev
          else delete records[key]
          return { records }
        })
      },
    )
  }

  /** 목장 완료 상태 하나를 화면에서 바꾼다 (null = 완료 전) */
  function putDay(key: string, day: GroupDay | null) {
    bump('status')
    set((s) => {
      const groupDays = { ...s.groupDays }
      if (day) groupDays[key] = day
      else delete groupDays[key]
      return { groupDays }
    })
  }

  /** 완료 / 수정: 화면에 먼저 반영하고 서버에 저장. 실패하면 되돌린다 */
  async function changeDay(groupId: string, action: GroupDayAction, date?: ISODate): Promise<GroupDayResult | null> {
    const d = date ?? get().date
    const key = groupDayKey(d, groupId)
    const prev = get().groupDays[key] ?? null
    const now = new Date().toISOString()
    let optimistic: GroupDay | null = prev
    if (action === 'complete') {
      if (!prev) optimistic = { date: d, groupId, state: 'done', doneAt: now, editCount: 0, updatedAt: now }
      else if (prev.state === 'editing') optimistic = { ...prev, state: 'done', doneAt: now, editCount: prev.editCount + 1, updatedAt: now }
    } else if (prev?.state === 'done') {
      optimistic = { ...prev, state: 'editing', updatedAt: now }
    }
    if (optimistic !== prev) putDay(key, optimistic)
    const out: { result?: GroupDayResult } = {}
    const ok = await persist(
      async () => {
        out.result = await get().backend.setGroupDay(d, groupId, action)
      },
      () => {
        // 그사이 다른 기기의 새 상태가 들어왔으면 되돌리지 않는다
        if ((get().groupDays[key] ?? null) === optimistic && optimistic !== prev) putDay(key, prev)
      },
    )
    if (!ok || !out.result) return null
    // 서버가 정한 상태로 맞춘다 (다른 사람이 먼저 완료했을 수도 있어요)
    if ((get().groupDays[key] ?? null) === optimistic) putDay(key, out.result.day)
    return out.result
  }

  /** 다른 기기에 '완료했어요' 알림 (내 Web Push 주소는 빼고). 실패해도 조용히 */
  async function announce(notice: CompletionNotice) {
    try {
      const endpoint = await currentPushEndpoint()
      await get().backend.sendNotice(notice, endpoint)
    } catch (e) {
      console.warn('완료 알림을 보내지 못했어요', e)
    }
  }

  /* ── 다시 불러오기 예약 (중복 없이 하나만) ── */
  let unsubscribe: (() => void) | null = null
  let deferTimer: ReturnType<typeof setTimeout> | null = null
  const deferred = new Set<ChangeScope | 'all'>()
  function deferRefresh(scope?: ChangeScope) {
    deferred.add(scope ?? 'all')
    if (deferTimer) return
    deferTimer = setTimeout(() => {
      deferTimer = null
      const list = [...deferred]
      deferred.clear()
      if (list.includes('all')) void get().refresh()
      else for (const s of list) void get().refresh(s as ChangeScope)
    }, 800)
  }

  /* ── 다른 기기에서 바뀌었다는 알림: 모아서, 너무 자주 받지 않게 ── */
  let broadcastTimer: ReturnType<typeof setTimeout> | null = null
  let lastBroadcastRefresh = 0
  const broadcastScopes = new Set<ChangeScope>()
  function onRemoteChange(scope: ChangeScope) {
    // 캘린더·목장보고서는 각자 자기 저장소가 따로 받아요
    if (!MAIN_SCOPES.includes(scope)) return
    broadcastScopes.add(scope)
    if (broadcastTimer) return
    const wait = Math.max(400, 2500 - (Date.now() - lastBroadcastRefresh))
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null
      lastBroadcastRefresh = Date.now()
      const scopes = [...broadcastScopes]
      broadcastScopes.clear()
      for (const s of scopes) void get().refresh(s)
    }, wait)
  }

  function clearTimers() {
    if (deferTimer) clearTimeout(deferTimer)
    if (broadcastTimer) clearTimeout(broadcastTimer)
    deferTimer = null
    broadcastTimer = null
    deferred.clear()
    broadcastScopes.clear()
  }

  return {
    backend: createBackend(),
    authed: false,
    passcode: null,
    booting: false,
    bootError: null,
    groups: [],
    members: [],
    records: {},
    notes: {},
    groupDays: {},
    loadedFrom: defaultLoadFrom(),
    date: currentSunday(),
    autoDate: currentSunday(),
    tab: 'attend',
    attendTab: 'attend',
    tabRetap: 0,
    groupId: null,
    sync: 'idle',
    pending: 0,
    toasts: [],

    async tryAutoLogin() {
      const saved = readSavedPasscode()
      if (!saved) return
      set({ booting: true })
      try {
        if (await get().backend.login(saved)) {
          set({ authed: true, passcode: saved })
          await get().loadAll()
        } else {
          writeSavedPasscode(null)
        }
      } catch (e) {
        console.error(e)
        if ((e as { kind?: string } | null)?.kind === 'auth') {
          writeSavedPasscode(null)
          set({ authed: false, passcode: null })
        } else {
          set({ bootError: koreanMessage(e, '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.') })
        }
      } finally {
        set({ booting: false })
      }
    },

    async login(code, remember) {
      const ok = await get().backend.login(code)
      if (!ok) return false
      writeSavedPasscode(remember ? code : null)
      set({ authed: true, passcode: code, booting: true, bootError: null })
      try {
        await get().loadAll()
      } catch (e) {
        console.error(e)
        set({ bootError: koreanMessage(e, '데이터를 불러오지 못했어요. 새로고침해 주세요.') })
      } finally {
        set({ booting: false })
      }
      return true
    },

    logout() {
      // 이 기기에서 그만 쓰는 것이니 앱을 꺼 두어도 오던 알림(Web Push)도 끊는다
      void disableNotifications(get().backend).catch(() => undefined)
      writeSavedPasscode(null)
      unsubscribe?.()
      unsubscribe = null
      clearTimers()
      set({ authed: false, passcode: null, groups: [], members: [], records: {}, notes: {}, groupDays: {}, groupId: null, tab: 'attend', attendTab: 'attend' })
    },

    async changePasscode(current, next) {
      await get().backend.changePasscode(current, next)
      set({ passcode: next })
      if (readSavedPasscode() !== null) writeSavedPasscode(next)
      try {
        localStorage.setItem('am-attendance:passlen', String(next.length))
      } catch {
        /* 무시 */
      }
    },

    async loadAll() {
      const { backend, loadedFrom } = get()
      const [roster, att, notes, days] = await Promise.all([
        backend.fetchRoster(),
        backend.fetchAttendance(loadedFrom, FAR_FUTURE),
        backend.fetchWeekNotes(loadedFrom, FAR_FUTURE),
        // 완료 상태를 못 받아도 출석부는 열려야 해요 (30초 새로고침 때 다시 받아요)
        backend.fetchGroupDays(loadedFrom, FAR_FUTURE).catch((e: unknown) => {
          console.error(e)
          return []
        }),
      ])
      const records: Record<string, AttendanceRecord> = {}
      for (const r of att) records[recKey(r.date, r.memberId)] = r
      const noteMap: Record<ISODate, WeekNote> = {}
      for (const n of notes) noteMap[n.date] = n
      bump('status')
      set({ groups: roster.groups, members: roster.members, records, notes: noteMap, groupDays: dayMap(days) })

      if (!unsubscribe) unsubscribe = backend.subscribe(onRemoteChange)
    },

    async refresh(scope) {
      if (!get().authed) return
      // 캘린더·목장보고서는 여기서 불러오지 않아요 (각자 저장소가 새로고침해요)
      if (scope && !MAIN_SCOPES.includes(scope)) return
      const { backend, loadedFrom } = get()
      // 내가 저장 중일 때 서버 값으로 덮어쓰면 방금 누른 것이 깜빡이므로 잠시 미룬다
      if (get().pending > 0) {
        deferRefresh(scope)
        return
      }
      const start = { ...seq }
      // 받아 오는 사이 이 기기에서 바뀐 것이 있으면, 덮어쓰지 않고 나중에 다시 받는다
      const fresh = (s: ChangeScope) => seq[s] === start[s] && get().pending === 0 && get().authed
      let retry = false
      try {
        if (!scope || scope === 'roster') {
          const roster = await backend.fetchRoster()
          if (fresh('roster')) set({ groups: roster.groups, members: roster.members })
          else retry = true
        }
        if (!scope || scope === 'attendance' || scope === 'roster') {
          const att = await backend.fetchAttendance(loadedFrom, FAR_FUTURE)
          if (fresh('attendance')) {
            const records: Record<string, AttendanceRecord> = {}
            for (const r of att) records[recKey(r.date, r.memberId)] = r
            set({ records })
          } else retry = true
        }
        if (!scope || scope === 'notes') {
          const notes = await backend.fetchWeekNotes(loadedFrom, FAR_FUTURE)
          if (fresh('notes')) {
            const noteMap: Record<ISODate, WeekNote> = {}
            for (const n of notes) noteMap[n.date] = n
            set({ notes: noteMap })
          } else retry = true
        }
        if (!scope || scope === 'status') {
          const days = await backend.fetchGroupDays(loadedFrom, FAR_FUTURE)
          if (fresh('status')) set({ groupDays: dayMap(days) })
          else retry = true
        }
        if (retry) deferRefresh(scope)
        else if (get().sync === 'error' && get().pending === 0) set({ sync: 'idle' })
      } catch (e) {
        console.error(e)
        handleAuthError(e)
      }
    },

    async ensureLoadedFrom(from) {
      const { loadedFrom, backend } = get()
      if (from >= loadedFrom) return
      const to = addDays(loadedFrom, -1)
      const [att, notes, days] = await Promise.all([
        backend.fetchAttendance(from, to),
        backend.fetchWeekNotes(from, to),
        backend.fetchGroupDays(from, to).catch(() => [] as GroupDay[]),
      ])
      // 진행 중인 다시 불러오기가 예전 범위로 이 기록을 덮지 않도록 표시한다
      bump('attendance')
      bump('notes')
      bump('status')
      set((s) => {
        const records = { ...s.records }
        for (const r of att) records[recKey(r.date, r.memberId)] = r
        const noteMap = { ...s.notes }
        for (const n of notes) noteMap[n.date] = n
        const groupDays = { ...dayMap(days), ...s.groupDays }
        return { records, notes: noteMap, groupDays, loadedFrom: from }
      })
    },

    setDate(d) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < '2000-01-01') return
      const max = addDays(currentSunday(), 7)
      const sunday = sundayOnOrBefore(d)
      const next = sunday > max ? max : sunday
      set({ date: next })
      if (next < get().loadedFrom) void get().ensureLoadedFrom(`${next.slice(0, 4)}-01-01`)
    },
    setTab(t) {
      set({ tab: t, groupId: t === 'attend' ? get().groupId : null, ...(isAttendTab(t) ? { attendTab: t } : {}) })
    },
    goTab(t) {
      const { tab, groupId } = get()
      if (groupId && (t !== 'attend' || tab === 'attend')) {
        // 휴대폰 '뒤로 가기'와 같은 길로 닫아야 방문 기록이 꼬이지 않는다 (App 이 기록을 보고 목장 화면을 닫아요)
        if ((history.state as { group?: string } | null)?.group) history.back()
        else get().openGroup(null)
      }
      if (t !== tab) {
        get().setTab(t)
        // 다른 탭은 맨 위부터 보여 준다 (앞 탭의 스크롤 위치가 남으면 빈 화면처럼 보인다)
        window.scrollTo(0, 0)
      } else {
        // 같은 탭을 또 눌렀다: 그 탭의 첫 화면으로 (캘린더는 열린 회의록을 닫아요)
        set((s) => ({ tabRetap: s.tabRetap + 1 }))
      }
    },
    openGroup(id) {
      set({ groupId: id })
    },
    checkSundayRollover() {
      const now = currentSunday()
      const { autoDate, date } = get()
      if (now !== autoDate) {
        // 주일이 바뀌었다: 이번 주를 보고 있던 사람은 새 출석부로 넘어간다
        set({ autoDate: now, date: date === autoDate ? now : date })
        void get().refresh()
      }
    },
    toast(text, tone = 'info', action) {
      const id = newId()
      set((s) => ({ toasts: [...s.toasts, { id, text, tone, action }] }))
      setTimeout(() => get().dismissToast(id), action ? 6000 : tone === 'error' ? 5000 : 2600)
    },
    dismissToast(id) {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    },

    markPresent(memberId, service, date) {
      return saveRecord(memberId, 'present', '', date, service)
    },

    setStatus(memberId, status, reason = '', date) {
      return saveRecord(memberId, status, reason, date)
    },

    async clearStatus(memberId, date) {
      const d = date ?? get().date
      const key = recKey(d, memberId)
      const prev = get().records[key]
      if (!prev) return true
      if (isLocked(d, prev.groupId)) {
        get().toastLocked()
        return false
      }
      bump('attendance')
      set((s) => {
        const records = { ...s.records }
        delete records[key]
        return { records }
      })
      return persist(
        () => get().backend.clearAttendance(d, memberId),
        () => {
          if (get().records[key]) return
          bump('attendance')
          set((s) => ({ records: { ...s.records, [key]: prev } }))
        },
      )
    },

    async saveNote(note, base) {
      let merged: WeekNote = { ...note, updatedAt: new Date().toISOString() }
      if (base !== undefined) {
        // 다른 기기에서 그사이 넣은 내용을 지우지 않도록, 서버의 최신 기록과 합친다
        let latest = get().notes[note.date]
        try {
          const fetched = await get().backend.fetchWeekNotes(note.date, note.date)
          latest = fetched.find((n) => n.date === note.date) ?? latest
        } catch {
          /* 못 받으면 가지고 있는 것과 합친다 */
        }
        merged = { ...mergeWeekNote(base, note, latest), updatedAt: new Date().toISOString() }
      }
      const prev = get().notes[note.date]
      bump('notes')
      set((s) => ({ notes: { ...s.notes, [note.date]: merged } }))
      const ok = await persist(
        () => get().backend.saveWeekNote(merged),
        () => {
          if (get().notes[note.date] !== merged) return
          bump('notes')
          set((s) => {
            const notes = { ...s.notes }
            if (prev) notes[note.date] = prev
            else delete notes[note.date]
            return { notes }
          })
        },
      )
      return ok ? merged : null
    },

    async addGroup(name) {
      const order = Math.max(-1, ...get().groups.map((g) => g.order)) + 1
      const group: Group = { id: newId(), name: name.trim(), order, archived: false }
      const undo = setRoster({ groups: [...get().groups, group] })
      const ok = await persist(() => get().backend.saveGroup(group), undo)
      return ok ? group : null
    },

    async updateGroup(group) {
      const undo = setRoster({ groups: get().groups.map((g) => (g.id === group.id ? group : g)) })
      return persist(() => get().backend.saveGroup(group), undo)
    },

    async reorderGroups(orderedIds) {
      const groups = get().groups.map((g) => {
        const i = orderedIds.indexOf(g.id)
        return i >= 0 ? { ...g, order: i } : g
      })
      const undo = setRoster({ groups })
      return persist(() => get().backend.saveGroups(groups.filter((g) => orderedIds.includes(g.id))), undo)
    },

    async addMembers(groupId, names, joinedOn) {
      const clean = names.map((n) => n.trim()).filter(Boolean)
      if (clean.length === 0) return []
      const inGroup = get().members.filter((m) => m.groupId === groupId)
      let order = Math.max(-1, ...inGroup.map((m) => m.order)) + 1
      const added: Member[] = clean.map((name) => ({
        id: newId(),
        name,
        groupId,
        role: null,
        order: order++,
        joinedOn: joinedOn ?? get().date,
        removedOn: null,
        note: '',
      }))
      const undo = setRoster({ members: [...get().members, ...added] })
      const ok = await persist(() => get().backend.saveMembers(added), undo)
      return ok ? added : []
    },

    async updateMember(member) {
      const undo = setRoster({ members: get().members.map((m) => (m.id === member.id ? member : m)) })
      return persist(() => get().backend.saveMember(member), undo)
    },

    async moveMember(memberId, groupId) {
      const member = get().members.find((m) => m.id === memberId)
      if (!member) return false
      if (member.groupId === groupId) return true
      const inGroup = get().members.filter((m) => m.groupId === groupId)
      const moved: Member = {
        ...member,
        groupId,
        // 목자·총무 역할은 원래 목장 것이므로 이동하면 해제
        role: null,
        order: Math.max(-1, ...inGroup.map((m) => m.order)) + 1,
      }
      const undo = setRoster({ members: get().members.map((m) => (m.id === memberId ? moved : m)) })
      if (!(await persist(() => get().backend.saveMember(moved), undo))) return false
      // 적용 주일과 그 뒤 기록은 새 목장으로 옮긴다. 그 전 기록은 원래 목장에 남는다
      const from = rosterChangeFrom(get().date)
      const later = Object.values(get().records).filter((r) => r.memberId === memberId && r.date >= from && r.groupId !== groupId)
      let allOk = true
      for (const r of later) {
        const updated = { ...r, groupId, updatedAt: new Date().toISOString() }
        const key = recKey(r.date, r.memberId)
        bump('attendance')
        set((s) => ({ records: { ...s.records, [key]: updated } }))
        const ok = await persist(
          () => get().backend.saveAttendance(updated),
          () => {
            if (get().records[key] !== updated) return
            bump('attendance')
            set((s) => ({ records: { ...s.records, [key]: r } }))
          },
        )
        allOk &&= ok
      }
      return allOk
    },

    async removeMember(memberId) {
      const member = get().members.find((m) => m.id === memberId)
      if (!member) return false
      const removedOn = removalDate(memberId, Object.values(get().records), get().date)
      const updated: Member = { ...member, removedOn, role: null }
      const undo = setRoster({ members: get().members.map((m) => (m.id === memberId ? updated : m)) })
      return persist(() => get().backend.saveMember(updated), undo)
    },

    async restoreMember(memberId, groupId) {
      const member = get().members.find((m) => m.id === memberId)
      if (!member) return false
      let updated: Member = { ...member, removedOn: null }
      if (groupId && groupId !== member.groupId) {
        const inGroup = get().members.filter((m) => m.groupId === groupId)
        updated = { ...updated, groupId, role: null, order: Math.max(-1, ...inGroup.map((m) => m.order)) + 1 }
      }
      const undo = setRoster({ members: get().members.map((m) => (m.id === memberId ? updated : m)) })
      return persist(() => get().backend.saveMember(updated), undo)
    },

    async purgeMember(memberId) {
      const before = { members: get().members, records: get().records }
      bump('roster')
      bump('attendance')
      set((s) => {
        const records = { ...s.records }
        for (const k of Object.keys(records)) if (records[k].memberId === memberId) delete records[k]
        return { members: s.members.filter((m) => m.id !== memberId), records }
      })
      return persist(
        () => get().backend.purgeMember(memberId),
        () => {
          bump('roster')
          bump('attendance')
          set(before)
        },
      )
    },

    async completeGroup(groupId, date) {
      const d = date ?? get().date
      const before = get().groupDays[groupDayKey(d, groupId)]?.state ?? 'open'
      const result = await changeDay(groupId, 'complete', d)
      if (!result) return false
      let kind = result.notify
      // 누른 순간 연결이 끊겼다가 다시 보내진 경우: 서버는 이미 첫 요청으로 완료돼 있어서 notify 가 비어 온다.
      // 이 기기가 보기에 아직 완료 전(또는 수정 중)이었고 서버 완료 시각이 방금이면, 알림을 대신 보낸다
      if (!kind && before !== 'done' && result.day?.state === 'done' && result.day.doneAt) {
        const age = Date.now() - new Date(result.day.doneAt).getTime()
        if (age >= 0 && age < 2 * 60_000) kind = result.day.editCount > 0 ? 'edited' : 'done'
      }
      if (kind) {
        const group = get().groups.find((g) => g.id === groupId)?.name ?? ''
        void announce({ kind, group, groupId, date: d, n: result.day?.editCount ?? 0 })
        get().toast(kind === 'edited' ? '수정 완료! 모두에게 알렸어요' : '완료! 모두에게 알렸어요', 'success')
      } else if (before === 'done') {
        get().toast('이미 완료된 목장이에요', 'info')
      }
      return true
    },

    async editGroup(groupId, date) {
      const result = await changeDay(groupId, 'edit', date)
      if (!result) return false
      if (result.day?.state === 'editing') get().toast("고칠 수 있어요. 다 고치면 '수정 완료'를 눌러 주세요", 'info')
      return true
    },

    isMemberLocked(memberId, date) {
      const d = date ?? get().date
      const rec = get().records[recKey(d, memberId)]
      const gid = rec?.groupId ?? get().members.find((m) => m.id === memberId)?.groupId
      return gid ? isLocked(d, gid) : false
    },

    toastLocked() {
      if (get().toasts.some((t) => t.text === LOCKED_MESSAGE)) return
      get().toast(LOCKED_MESSAGE, 'info')
    },
  }
})
