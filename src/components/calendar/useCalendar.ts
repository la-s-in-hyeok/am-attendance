import { create } from 'zustand'
import type { CalEvent, CalEventInput, DayISO } from '../../lib/types'
import { addDays, monthKey, todayKST } from '../../lib/dates'
import { useStore } from '../../store'
import { diffDays, labelDayShort, withRo } from './calDates'

/*
 * 청년회 캘린더 데이터 (이 화면만 쓰는 작은 저장소).
 * - 옮기기·저장·삭제·되살리기는 화면에 먼저 반영하고(낙관적) 서버에 보내요. 실패하면 원래대로 돌리고 알려요.
 * - 다른 기기에서 바뀌면(backend.subscribe 'calendar') 2.5초 모아서 한 번 새로 받아요.
 *   캘린더 화면이 보이는 동안에는 30초마다, 앱으로 돌아올 때도 새로 받아요.
 */

export type CalStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface CalLoadError {
  message: string
  /** 서버 설정이 예전 버전이라 캘린더 함수가 없을 때 (회장이 schema.sql 을 다시 Run 해야 해요) */
  setup: boolean
}

interface CalState {
  events: CalEvent[]
  status: CalStatus
  error: CalLoadError | null
  /** 보고 있는 달 (YYYY-MM). 처음은 오늘(한국 시간)이 있는 달, 앱을 닫기 전까지 기억해요 */
  viewMonth: string
  /** 고른 날 (달력 아래 목록) */
  selectedDay: DayISO
  /** 다른 기기에서 바뀌었거나 새로고침한 횟수 (열린 회의록이 최신 내용을 받을지 보는 데 써요) */
  remoteTick: number
  /** 막대를 끄는 중 (그동안 받은 새 내용은 놓은 뒤에 반영) */
  dragging: boolean
  /** 이 기기에서 방금 지운 일정 (회의록 페이지가 '다른 기기에서 지웠어요'로 오해하지 않게) */
  removedHere: string | null

  load(): Promise<void>
  refresh(): Promise<void>
  /** 캘린더 화면이 보이는 동안: 실시간 알림 + 30초 새로고침. 반환값은 정리 함수 */
  start(): () => void
  setMonth(ym: string): void
  goToday(): void
  selectDay(d: DayISO): void
  /** 그 날을 고르고, 다른 달이면 그 달로 넘겨요 (지난달·다음 달 칸의 날짜를 눌렀을 때) */
  showDay(d: DayISO): void
  setDragging(v: boolean): void

  /** 추가·수정. 성공하면 저장된 일정, 실패하면 null (화면도 원래대로) */
  save(input: CalEventInput): Promise<CalEvent | null>
  /** 기간을 그대로 두고 시작일을 옮겨요. 토스트 + 되돌리기 */
  move(id: string, newStart: DayISO, opts?: { undo?: boolean }): Promise<boolean>
  /** 지우기 (회의록도 같이). 토스트 '지웠어요' + 되돌리기 */
  remove(id: string): Promise<boolean>
  restore(event: CalEvent): Promise<boolean>
  /** 회의록을 저장했을 때 목록의 📝 표시를 바로 맞춰요 */
  setHasNote(id: string, has: boolean): void
  reset(): void
}

const GATHER_MS = 2_500
const POLL_MS = 30_000

/** 한글 안내가 담긴 오류면 그 문구를, 아니면 기본 문구를 */
function koreanMessage(e: unknown, fallback: string): string {
  const m = e instanceof Error ? e.message : ''
  return /[가-힣]/.test(m) ? m : fallback
}

function errKind(e: unknown): string | undefined {
  return (e as { kind?: string } | null)?.kind
}

/** 다른 기기에서 이미 지운 일정이라 저장하지 못했는지 */
function isGone(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === 'not_found'
}

/** 비밀번호가 바뀌었으면 로그아웃 (출석부와 같은 안내). 처리했으면 true */
export function handleCalAuthError(e: unknown): boolean {
  if (errKind(e) !== 'auth') return false
  const s = useStore.getState()
  if (s.authed) {
    s.logout()
    s.toast('비밀번호가 바뀌었어요. 새 비밀번호로 다시 들어와 주세요.', 'error')
  }
  return true
}

function failToast(e: unknown, fallback: string) {
  console.error(e)
  if (handleCalAuthError(e)) return
  useStore.getState().toast(koreanMessage(e, fallback), 'error')
}

function upsert(list: CalEvent[], ev: CalEvent): CalEvent[] {
  const i = list.findIndex((x) => x.id === ev.id)
  if (i < 0) return [...list, ev]
  const out = list.slice()
  out[i] = ev
  return out
}

function initialDay(): { viewMonth: string; selectedDay: DayISO } {
  const today = todayKST()
  return { viewMonth: monthKey(today), selectedDay: today }
}

export const useCalendar = create<CalState>((set, get) => {
  /** 이 기기에서 바꾼 횟수. 받아 오는 사이 바뀌었으면 받은 것으로 덮지 않아요 */
  let seq = 0
  /** 서버에 보내는 중인 저장 수 */
  let writes = 0
  /** 미뤄 둔 새로고침이 있는지 */
  let deferred = false
  let gatherTimer: ReturnType<typeof setTimeout> | null = null
  let loading: Promise<void> | null = null

  const toast = (...a: Parameters<ReturnType<typeof useStore.getState>['toast']>) => useStore.getState().toast(...a)

  const settle = () => {
    writes = Math.max(0, writes - 1)
    if (writes === 0 && deferred && !get().dragging) {
      deferred = false
      void get().refresh()
    }
  }

  const fetchInto = async (): Promise<void> => {
    const backend = useStore.getState().backend
    const start = seq
    const events = await backend.fetchEvents()
    if (!useStore.getState().authed) return
    if (start !== seq || writes > 0 || get().dragging) {
      // 받는 사이 이 기기에서 바꿨어요: 받은 것은 버리고, 저장·끌기가 끝나면 다시 받아요
      if (writes > 0 || get().dragging) deferred = true
      else setTimeout(() => void get().refresh(), 0)
      return
    }
    set({ events, status: 'ready', error: null, remoteTick: get().remoteTick + 1 })
  }

  return {
    events: [],
    status: 'idle',
    error: null,
    ...initialDay(),
    remoteTick: 0,
    dragging: false,
    removedHere: null,

    async load() {
      if (!useStore.getState().authed) return
      if (get().status === 'ready') return get().refresh()
      if (loading) return loading
      set({ status: get().events.length ? get().status : 'loading', error: null })
      loading = (async () => {
        try {
          await fetchInto()
        } catch (e) {
          console.error(e)
          if (handleCalAuthError(e)) return
          set({
            status: 'error',
            error: { message: koreanMessage(e, '일정을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'), setup: errKind(e) === 'setup' },
          })
        } finally {
          loading = null
        }
      })()
      return loading
    },

    async refresh() {
      if (!useStore.getState().authed) return
      if (get().status !== 'ready') return get().load()
      if (writes > 0 || get().dragging) {
        deferred = true
        return
      }
      try {
        await fetchInto()
      } catch (e) {
        // 새로고침 실패는 조용히 (30초 뒤 다시). 비밀번호가 바뀐 것만 알려요
        console.error(e)
        handleCalAuthError(e)
      }
    },

    start() {
      const backend = useStore.getState().backend
      const unsub = backend.subscribe((scope) => {
        if (scope !== 'calendar') return
        // 자동 저장마다 알림이 와도 2.5초에 한 번만 받아요
        if (gatherTimer) return
        gatherTimer = setTimeout(() => {
          gatherTimer = null
          void get().refresh()
        }, GATHER_MS)
      })
      const poll = setInterval(() => {
        if (document.visibilityState === 'visible') void get().refresh()
      }, POLL_MS)
      const onVisible = () => {
        if (document.visibilityState === 'visible') void get().refresh()
      }
      document.addEventListener('visibilitychange', onVisible)
      return () => {
        unsub()
        clearInterval(poll)
        document.removeEventListener('visibilitychange', onVisible)
        if (gatherTimer) clearTimeout(gatherTimer)
        gatherTimer = null
      }
    },

    setMonth(ym) {
      if (!/^\d{4}-\d{2}$/.test(ym)) return
      const today = todayKST()
      set({ viewMonth: ym, selectedDay: monthKey(today) === ym ? today : `${ym}-01` })
    },
    goToday() {
      set(initialDay())
    },
    selectDay(d) {
      set({ selectedDay: d })
    },
    showDay(d) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return
      set({ selectedDay: d, viewMonth: monthKey(d) })
    },
    setDragging(v) {
      set({ dragging: v })
      if (!v && deferred && writes === 0) {
        deferred = false
        void get().refresh()
      }
    },

    async save(input) {
      const before = get().events.find((e) => e.id === input.id) ?? null
      const optimistic: CalEvent = { hasNote: before?.hasNote ?? false, updatedAt: before?.updatedAt ?? new Date().toISOString(), ...input }
      seq++
      writes++
      set({ events: upsert(get().events, optimistic) })
      try {
        const saved = await useStore.getState().backend.saveEvent(input)
        seq++
        set({ events: upsert(get().events, saved) })
        return saved
      } catch (e) {
        seq++
        if (isGone(e)) {
          // 다른 기기에서 지운 일정: 되돌리지 말고 이 기기에서도 빼고, 저장이 끝나면 서버 목록을 다시 받아요
          set({ events: get().events.filter((x) => x.id !== input.id) })
          deferred = true
        } else set({ events: before ? upsert(get().events, before) : get().events.filter((x) => x.id !== input.id) })
        failToast(e, '일정을 저장하지 못했어요. 인터넷 연결을 확인해 주세요.')
        return null
      } finally {
        settle()
      }
    },

    async move(id, newStart, opts) {
      const ev = get().events.find((e) => e.id === id)
      if (!ev || ev.startDate === newStart) return false
      const oldStart = ev.startDate
      const newEnd = addDays(newStart, diffDays(ev.startDate, ev.endDate))
      const input: CalEventInput = { id, title: ev.title, startDate: newStart, endDate: newEnd, color: ev.color }
      seq++
      writes++
      set({ events: upsert(get().events, { ...ev, startDate: newStart, endDate: newEnd }) })
      try {
        const saved = await useStore.getState().backend.saveEvent(input)
        seq++
        set({ events: upsert(get().events, saved) })
        if (opts?.undo) toast('되돌렸어요', 'info')
        else
          toast(`${withRo(labelDayShort(newStart))} 옮겼어요`, 'success', {
            label: '되돌리기',
            run: () => void get().move(id, oldStart, { undo: true }),
          })
        return true
      } catch (e) {
        seq++
        if (isGone(e)) {
          // 다른 기기에서 지운 일정: 이 기기에서도 빼고 서버 목록을 다시 받아요
          set({ events: get().events.filter((x) => x.id !== id) })
          deferred = true
        }
        // 그사이 지워지지 않았으면 원래 자리로
        else if (get().events.some((x) => x.id === id)) set({ events: upsert(get().events, ev) })
        failToast(e, '옮기지 못했어요. 인터넷 연결을 확인해 주세요.')
        return false
      } finally {
        settle()
      }
    },

    async remove(id) {
      const ev = get().events.find((e) => e.id === id)
      if (!ev) return false
      seq++
      writes++
      set({ events: get().events.filter((x) => x.id !== id), removedHere: id })
      try {
        await useStore.getState().backend.deleteEvent(id)
        toast('지웠어요', 'info', { label: '되돌리기', run: () => void get().restore(ev) })
        return true
      } catch (e) {
        seq++
        set({ events: upsert(get().events, ev) })
        failToast(e, '지우지 못했어요. 인터넷 연결을 확인해 주세요.')
        return false
      } finally {
        settle()
      }
    },

    async restore(event) {
      seq++
      writes++
      set({ events: upsert(get().events, event), removedHere: get().removedHere === event.id ? null : get().removedHere })
      try {
        await useStore.getState().backend.restoreEvent(event.id)
        toast('되돌렸어요', 'info')
        return true
      } catch (e) {
        seq++
        set({ events: get().events.filter((x) => x.id !== event.id) })
        failToast(e, '되돌리지 못했어요. 인터넷 연결을 확인해 주세요.')
        return false
      } finally {
        settle()
      }
    },

    setHasNote(id, has) {
      const ev = get().events.find((e) => e.id === id)
      if (!ev || ev.hasNote === has) return
      seq++
      set({ events: upsert(get().events, { ...ev, hasNote: has }) })
    },

    reset() {
      seq++
      deferred = false
      if (gatherTimer) clearTimeout(gatherTimer)
      gatherTimer = null
      set({ events: [], status: 'idle', error: null, dragging: false, removedHere: null, ...initialDay() })
    },
  }
})

// 로그아웃하면 다른 사람이 볼 수 없게 비워요
useStore.subscribe((s, prev) => {
  if (prev.authed && !s.authed) useCalendar.getState().reset()
})
