import { create } from 'zustand'
import type { ISODate, ReportFile, ReportWeek } from '../../lib/types'
import { useStore } from '../../store'

/*
 * 목장보고서 데이터 (이 화면만 쓰는 작은 저장소).
 * - 보는 주일은 출석부와 같은 useStore 의 date 를 써요.
 * - 다른 기기에서 바뀌면(backend.subscribe 'reports') 1초 모아서 한 번 새로 받아요.
 *   화면이 보이는 동안에는 30초마다, 앱으로 돌아올 때도 새로 받아요.
 * - 마감된 주는 낸 보고서들을 이 기기에서 미리 한 PDF로 합쳐 둬요(서버에는 저장하지 않아요).
 *   삼성 인터넷은 누르고 5초가 지나서 시작한 내려받기를 막아서, 누르자마자 받을 수 있게 미리 준비해요.
 * - 마감·마감 풀기·합친 PDF·남의 보고서 지우기는 '보고서 담당 비밀번호'가 있어야 해요.
 *   한 번 맞게 넣으면 이 앱을 켜 둔 동안만 메모리에 기억해요 (저장하지 않아요. 새로고침·로그아웃하면 잊어요).
 *   미리 합치기도 담당 비밀번호를 기억하고 있을 때만 해요.
 */

export type WeekStatus = 'loading' | 'ready' | 'error'

export interface ReportLoadError {
  date: ISODate
  message: string
  /** 서버 설정이 예전 버전이라 보고서 함수가 없을 때 (회장이 schema.sql 을 다시 Run 해야 해요) */
  setup: boolean
}

/** 합칠 보고서 하나 (목장 순서대로) */
export interface MergePart {
  groupId: string
  /** 목장 이름 (빠진 목장을 알려 줄 때 써요) */
  label: string
  /** 낸 시각 (다시 낸 보고서면 바뀌어서 다시 합쳐요) */
  stamp: string
}

export interface MergeState {
  date: ISODate
  /** 합친 보고서들(목장·낸 시각)을 이은 것. 낸 보고서가 바뀌면 다시 합쳐요 */
  key: string
  status: 'working' | 'ready' | 'error'
  step: 'download' | 'merge'
  /** 합칠 보고서 수 */
  count: number
  blob: Blob | null
  pages: number
  /** 받지 못했거나 합치지 못해서 빠진 목장 이름 */
  skipped: string[]
  message: string | null
}

/** 올리기 결과: ok / 그사이 마감됨 / 실패(토스트로 알렸어요) */
export type UploadOutcome = 'ok' | 'closed' | 'fail'

/** 담당 비밀번호 확인 결과 (틀렸으면 창 안에 보여 줄 문구) */
export type PinCheck = { ok: true } | { ok: false; message: string }

interface ReportsState {
  weeks: Record<ISODate, ReportWeek>
  status: Record<ISODate, WeekStatus>
  error: ReportLoadError | null
  merge: MergeState | null
  /** 보고서 담당 비밀번호를 이 앱이 기억하고 있는지 (비밀번호 자체는 상태에 두지 않아요) */
  hasPin: boolean

  load(date: ISODate): Promise<void>
  /** 지금 보는 주일(또는 date)을 조용히 새로 받기 */
  refresh(date?: ISODate): Promise<void>
  /** 화면이 보이는 동안: 실시간 알림 + 30초 새로고침. 반환값은 정리 함수 */
  start(): () => void

  upload(date: ISODate, groupId: string, pdf: Uint8Array, fileName: string, pages: number): Promise<UploadOutcome>
  /** 지우기. asAdmin 이면 기억해 둔 담당 비밀번호로 (남이 낸 보고서 정리) */
  remove(date: ISODate, groupId: string, asAdmin?: boolean): Promise<boolean>
  /** 마감·마감 풀기 (기억해 둔 담당 비밀번호로) */
  close(date: ISODate): Promise<boolean>
  reopen(date: ISODate): Promise<boolean>
  /**
   * 마감된 주의 보고서를 한 PDF로 합쳐 둬요 (담당 비밀번호를 기억하고 있을 때만).
   * 같은 보고서들로 이미 합쳤거나 합치는 중이면 그대로
   */
  prepareMerge(date: ISODate, parts: MergePart[], force?: boolean): Promise<void>
  /** 담당 비밀번호 확인. 맞으면 이 앱을 켜 둔 동안 기억해요 */
  verifyPin(pin: string): Promise<PinCheck>
  /** 담당 비밀번호를 바꾼 뒤: 새 비밀번호를 기억해요 */
  rememberPin(pin: string): void
  reset(): void
}

const GATHER_MS = 1_000
const POLL_MS = 30_000

/** 한글 안내가 담긴 오류면 그 문구를, 아니면 기본 문구를 */
export function koreanMessage(e: unknown, fallback: string): string {
  const m = e instanceof Error ? e.message : ''
  return /[가-힣]/.test(m) ? m : fallback
}

function errKind(e: unknown): string | undefined {
  return (e as { kind?: string } | null)?.kind
}

/** 마감된 주에 올리거나 지우려고 했을 때의 오류인지 */
export function isClosedError(e: unknown): boolean {
  const x = e as { kind?: string; code?: string } | null
  return x?.kind === 'conflict' && x.code === 'closed'
}

/** 비밀번호가 바뀌었으면 로그아웃 (출석부·캘린더와 같은 안내). 처리했으면 true */
export function handleReportAuthError(e: unknown): boolean {
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
  if (handleReportAuthError(e)) return
  useStore.getState().toast(koreanMessage(e, fallback), 'error')
}

function withFile(week: ReportWeek, file: ReportFile): ReportWeek {
  return { ...week, files: [...week.files.filter((f) => f.groupId !== file.groupId), file] }
}

export function mergeKey(parts: MergePart[]): string {
  return parts.map((p) => `${p.groupId}@${p.stamp}`).join('|')
}

/** 담당 비밀번호가 틀렸거나(다른 기기에서 바꿈) 막혔거나 아직 정하지 않았다는 오류인지 (예상한 결과라 콘솔에 오류로 찍지 않아요) */
export function isPinError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code
  return code === 'bad_pin' || code === 'pin_locked' || code === 'pin_unset'
}

export const useGroupReports = create<ReportsState>((set, get) => {
  /*
   * 주일마다 따로 세요: 한 주에 큰 파일을 올리는 동안에도 다른 주는 바로 불러올 수 있게.
   * changes = 이 기기에서 그 주를 바꾼 횟수 (받아 오는 사이 바뀌었으면 받은 것으로 덮지 않아요)
   * writes = 그 주에 서버로 보내는 중인 저장 수
   */
  const changes = new Map<ISODate, number>()
  /** 보고서 담당 비밀번호 (메모리에만. 새로고침·로그아웃하면 사라져요) */
  let adminPin: string | null = null
  const forgetPin = () => {
    adminPin = null
    if (get().hasPin) set({ hasPin: false })
  }
  /** 담당 비밀번호로 한 일이 실패: 비밀번호 문제면 잊고 알려요 (다시 넣게) */
  const pinFail = (e: unknown, fallback: string) => {
    if (isPinError(e)) {
      forgetPin()
      useStore.getState().toast(koreanMessage(e, '담당 비밀번호가 맞지 않아요'), 'error')
      return
    }
    failToast(e, fallback)
  }
  const writes = new Map<ISODate, number>()
  /** 로그아웃으로 비울 때마다 올라가요 (그 전에 시작한 받아 오기는 버려요) */
  let epoch = 0
  /** 저장이 끝나면 다시 받을 주일 */
  const deferred = new Set<ISODate>()
  const changed = (date: ISODate) => changes.set(date, (changes.get(date) ?? 0) + 1)
  const writing = (date: ISODate) => (writes.get(date) ?? 0) > 0
  /** 저장 시작: 바꿈 표시 + 보내는 중 */
  const begin = (date: ISODate) => {
    changed(date)
    writes.set(date, (writes.get(date) ?? 0) + 1)
  }
  let gatherTimer: ReturnType<typeof setTimeout> | null = null
  const loading = new Map<ISODate, Promise<void>>()

  const backend = () => useStore.getState().backend

  const setWeek = (week: ReportWeek) => set({ weeks: { ...get().weeks, [week.date]: week } })
  const patchWeek = (date: ISODate, fn: (w: ReportWeek) => ReportWeek) => {
    const w = get().weeks[date]
    if (w) setWeek(fn(w))
  }

  /** 저장 끝: 그 주에 보내는 중인 것이 다 끝났고 미뤄 둔 새로고침이 있으면 받아요 */
  const settle = (date: ISODate) => {
    const n = Math.max(0, (writes.get(date) ?? 0) - 1)
    if (n > 0) writes.set(date, n)
    else writes.delete(date)
    if (n > 0 || !deferred.has(date)) return
    deferred.delete(date)
    void get().refresh(date)
  }

  const fetchInto = async (date: ISODate): Promise<void> => {
    const start = changes.get(date) ?? 0
    const startEpoch = epoch
    const week = await backend().fetchReports(date)
    if (!useStore.getState().authed || startEpoch !== epoch) return
    if (start !== (changes.get(date) ?? 0) || writing(date)) {
      // 받는 사이 이 기기에서 바꿨어요: 받은 것은 버리고, 저장이 끝나면 다시 받아요
      if (writing(date)) deferred.add(date)
      else setTimeout(() => void get().refresh(date), 0)
      return
    }
    set({
      weeks: { ...get().weeks, [date]: { ...week, date } },
      status: { ...get().status, [date]: 'ready' },
      error: get().error?.date === date ? null : get().error,
    })
  }

  /** 올리기·지우기·마감 공통: 마감됐다는 오류면 그 주를 새로 받아 화면을 맞춰요 */
  const onClosed = (date: ISODate) => {
    patchWeek(date, (w) => (w.closedAt ? w : { ...w, closedAt: new Date().toISOString() }))
    void get().refresh(date)
  }

  return {
    weeks: {},
    status: {},
    error: null,
    merge: null,
    hasPin: false,

    async load(date) {
      if (!useStore.getState().authed) return
      if (get().status[date] === 'ready') return get().refresh(date)
      const running = loading.get(date)
      if (running) return running
      set({ status: { ...get().status, [date]: 'loading' }, error: get().error?.date === date ? null : get().error })
      const p = (async () => {
        try {
          await fetchInto(date)
        } catch (e) {
          console.error(e)
          if (handleReportAuthError(e)) return
          set({
            status: { ...get().status, [date]: 'error' },
            error: { date, message: koreanMessage(e, '보고서 목록을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'), setup: errKind(e) === 'setup' },
          })
        } finally {
          loading.delete(date)
        }
      })()
      loading.set(date, p)
      return p
    },

    async refresh(date = useStore.getState().date) {
      if (!useStore.getState().authed) return
      if (get().status[date] !== 'ready') return get().load(date)
      if (writing(date)) {
        deferred.add(date)
        return
      }
      try {
        await fetchInto(date)
      } catch (e) {
        // 새로고침 실패는 조용히 (30초 뒤 다시). 비밀번호가 바뀐 것만 알려요
        console.error(e)
        handleReportAuthError(e)
      }
    },

    start() {
      const unsub = backend().subscribe((scope) => {
        if (scope !== 'reports') return
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

    async upload(date, groupId, pdf, fileName, pages) {
      begin(date)
      try {
        const file = await backend().uploadReport(date, groupId, pdf, fileName, pages)
        changed(date)
        patchWeek(date, (w) => withFile(w, file))
        return 'ok'
      } catch (e) {
        if (isClosedError(e)) {
          onClosed(date)
          return 'closed'
        }
        // 시간 초과처럼 결과를 모를 때는 서버에 들어갔을 수 있어요: 끝나면 서버 것을 다시 받아요
        deferred.add(date)
        failToast(e, '보고서를 올리지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.')
        return 'fail'
      } finally {
        settle(date)
      }
    },

    async remove(date, groupId, asAdmin) {
      const pin = asAdmin ? adminPin : null
      if (asAdmin && !pin) return false
      const removed = get().weeks[date]?.files.find((f) => f.groupId === groupId) ?? null
      begin(date)
      patchWeek(date, (w) => ({ ...w, files: w.files.filter((f) => f.groupId !== groupId) }))
      try {
        await backend().deleteReport(date, groupId, pin ?? undefined)
        return true
      } catch (e) {
        changed(date)
        // 지운 것만 되돌려요 (그사이 끝난 다른 목장의 올리기는 그대로). 같은 목장이 새로 올렸으면 그것을 둬요
        if (removed) patchWeek(date, (w) => (w.files.some((f) => f.groupId === groupId) ? w : withFile(w, removed)))
        deferred.add(date)
        if (isClosedError(e)) {
          onClosed(date)
          useStore.getState().toast('이미 마감돼서 지울 수 없어요', 'error')
          return false
        }
        pinFail(e, '지우지 못했어요. 인터넷 연결을 확인해 주세요.')
        return false
      } finally {
        settle(date)
      }
    },

    async close(date) {
      const pin = adminPin
      if (!pin) return false
      begin(date)
      try {
        const closedAt = await backend().closeReports(date, pin)
        changed(date)
        patchWeek(date, (w) => ({ ...w, closedAt }))
        // 마감 직전에 다른 기기에서 낸 보고서가 아직 이 기기에 안 왔을 수 있어요: 서버의 최종 목록을 다시 받아요
        deferred.add(date)
        return true
      } catch (e) {
        deferred.add(date)
        pinFail(e, '마감하지 못했어요. 인터넷 연결을 확인해 주세요.')
        return false
      } finally {
        settle(date)
      }
    },

    async reopen(date) {
      const pin = adminPin
      if (!pin) return false
      begin(date)
      try {
        await backend().reopenReports(date, pin)
        changed(date)
        patchWeek(date, (w) => ({ ...w, closedAt: null }))
        if (get().merge?.date === date) set({ merge: null })
        return true
      } catch (e) {
        deferred.add(date)
        pinFail(e, '마감을 풀지 못했어요. 인터넷 연결을 확인해 주세요.')
        return false
      } finally {
        settle(date)
      }
    },

    async prepareMerge(date, parts, force) {
      const key = mergeKey(parts)
      const cur = get().merge
      if (!force && cur && cur.date === date && cur.key === key && cur.status !== 'error') return
      if (parts.length === 0) {
        set({ merge: null })
        return
      }
      const pin = adminPin
      // 담당 비밀번호를 모르면 합치지 않아요 ([합친 PDF 받기]를 누르면 물어봐요)
      if (!pin) {
        if (cur?.date === date) set({ merge: null })
        return
      }
      const base: MergeState = { date, key, status: 'working', step: 'download', count: parts.length, blob: null, pages: 0, skipped: [], message: null }
      set({ merge: base })
      const still = () => {
        const m = get().merge
        return m !== null && m.date === date && m.key === key
      }
      try {
        const got = await backend().downloadAllReports(date, pin)
        if (!still()) return
        const byGroup = new Map(got.map((g) => [g.groupId.toLowerCase(), g.bytes]))
        const ready: { bytes: Uint8Array; label: string }[] = []
        const skipped: string[] = []
        for (const p of parts) {
          const key = p.groupId.toLowerCase()
          const bytes = byGroup.get(key)
          byGroup.delete(key)
          if (bytes) ready.push({ bytes, label: p.label })
          else skipped.push(p.label)
        }
        // 화면 목록에 아직 없던 보고서(마감 직전에 낸 것)도 뒤에 붙여요
        for (const bytes of byGroup.values()) if (bytes) ready.push({ bytes, label: '목장' })
        if (ready.length === 0) throw new Error('보고서를 받지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.')
        set({ merge: { ...base, step: 'merge' } })
        const { mergePdfs } = await import('../../lib/convert')
        const out = await mergePdfs(ready)
        if (!still()) return
        skipped.push(...out.failed)
        if (out.pages === 0) throw new Error('보고서를 합치지 못했어요. 다시 해 주세요.')
        const blob = new Blob([out.pdf as BlobPart], { type: 'application/pdf' })
        set({ merge: { ...base, status: 'ready', step: 'merge', blob, pages: out.pages, skipped } })
      } catch (e) {
        if (!isPinError(e)) console.error(e)
        if (handleReportAuthError(e)) return
        if (!still()) return
        if (isPinError(e)) {
          // 다른 기기에서 담당 비밀번호를 바꿨어요: 잊고, 누르면 다시 묻게
          forgetPin()
          set({ merge: null })
          useStore.getState().toast(koreanMessage(e, '담당 비밀번호가 맞지 않아요'), 'error')
          return
        }
        set({ merge: { ...base, status: 'error', message: koreanMessage(e, '보고서를 합치지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.') } })
      }
    },

    async verifyPin(pin) {
      if (!/^[0-9]{4,8}$/.test(pin)) return { ok: false, message: '담당 비밀번호는 숫자 4~8자리예요' }
      try {
        await backend().checkReportPin(pin)
        adminPin = pin
        set({ hasPin: true })
        return { ok: true }
      } catch (e) {
        // 틀림·막힘·정하기 전은 예상한 결과라 창 안에만 알려요 (콘솔에 오류로 남기지 않아요)
        if (!isPinError(e)) console.error(e)
        if (handleReportAuthError(e)) return { ok: false, message: '다시 로그인해 주세요.' }
        return { ok: false, message: koreanMessage(e, '확인하지 못했어요. 인터넷 연결을 확인해 주세요.') }
      }
    },

    rememberPin(pin) {
      adminPin = pin
      set({ hasPin: true })
    },

    reset() {
      epoch++
      adminPin = null
      changes.clear()
      deferred.clear()
      loading.clear()
      if (gatherTimer) clearTimeout(gatherTimer)
      gatherTimer = null
      set({ weeks: {}, status: {}, error: null, merge: null, hasPin: false })
    },
  }
})

// 로그아웃하면 다른 사람이 볼 수 없게 비워요
useStore.subscribe((s, prev) => {
  if (prev.authed && !s.authed) useGroupReports.getState().reset()
})
