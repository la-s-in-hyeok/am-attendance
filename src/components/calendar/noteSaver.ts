import type { EventNote } from '../../lib/types'
import { useStore } from '../../store'
import { handleCalAuthError } from './useCalendar'

/*
 * 회의록 자동 저장 (화면과 따로 도는 작은 일꾼).
 * - 고치면 1초 기다렸다가 저장. 요청은 한 번에 하나만 보내고, 보내는 중에 또 고치면 끝난 뒤 최신으로 한 번 더.
 * - base = 마지막으로 저장에 성공한 판 번호. 서버 판이 그사이 바뀌었으면 서버가 { ok:false, latest } 를 줘요.
 *   · latest 가 내가 보낸 것 중 하나면(시간 초과로 결과를 몰랐던 저장) 성공으로 보고 판 번호만 맞춰요.
 *   · 내가 고친 게 없으면 최신으로 바꿔요.
 *   · 둘 다 아니면 충돌 → 화면에 안내 띠 ([최신 내용 보기] / [내 것으로 저장]).
 * - 저장을 못 하면 이 기기에 임시본(localStorage am-cal:draft:<id>)을 남기고, 연결되거나 다음에 고칠 때 다시 보내요.
 */

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict' | 'paused' | 'tooBig'

export interface Snapshot {
  doc: unknown
  json: string
  plainLen: number
}

export interface Draft {
  base: number
  doc: unknown
}

const DEBOUNCE_MS = 1_000
/** 회의록 하나의 최대 크기 (서버도 같은 값으로 막아요) */
export const NOTE_MAX_BYTES = 300 * 1024
const draftKey = (id: string) => `am-cal:draft:${id}`

/** 키 순서와 상관없이 같은 문서면 같은 글자 (서버 jsonb 는 키 순서를 바꿔요) */
export function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(',')}}`
}

export function readDraft(id: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(id))
    if (!raw) return null
    const d = JSON.parse(raw) as Draft
    return typeof d?.base === 'number' && d.doc ? d : null
  } catch {
    return null
  }
}
function writeDraft(id: string, d: Draft) {
  try {
    localStorage.setItem(draftKey(id), JSON.stringify(d))
  } catch {
    /* 저장 공간이 없으면 넘어가요 (화면의 글은 그대로) */
  }
}
export function clearDraft(id: string) {
  try {
    localStorage.removeItem(draftKey(id))
  } catch {
    /* 무시 */
  }
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length
}

export interface SaverHooks {
  /** 지금 편집기 내용 */
  snapshot(): Snapshot
  /** 편집기 내용을 이 문서로 바꿔요 (다른 기기 내용 받기) */
  replace(doc: unknown): void
  onState(s: SaveState): void
  onConflict(latest: EventNote | null): void
  onSaved(plainLen: number): void
}

export class NoteSaver {
  private base: number
  /** 서버에 있는 것과 같은 내용 (stableJson) */
  private savedJson: string
  /** base 뒤로 보낸 내용들 (결과를 모른 채 끊긴 저장이 서버에 들어갔는지 알아보는 데 써요) */
  private sentSinceBase: string[] = []
  private inflight = false
  private again = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private state: SaveState = 'saved'
  private latest: EventNote | null = null
  private paused = false
  private closed = false
  private readonly eventId: string
  private readonly hooks: SaverHooks

  constructor(eventId: string, base: number, savedJson: string, hooks: SaverHooks) {
    this.eventId = eventId
    this.base = base
    this.savedJson = savedJson
    this.hooks = hooks
  }

  get current(): SaveState {
    return this.state
  }

  /** 고치는 중인지 (저장 안 된 내용이 있는지) */
  get busy(): boolean {
    return this.inflight || this.timer !== null || this.state !== 'saved'
  }

  private set(s: SaveState) {
    if (this.state === s) return
    this.state = s
    if (!this.closed) this.hooks.onState(s)
  }

  /** 편집기에서 무언가 고쳤을 때 */
  markDirty() {
    if (this.state === 'conflict') {
      // 충돌 안내가 떠 있는 동안에는 자동 저장하지 않아요 (고른 뒤에 저장)
      return
    }
    if (!this.inflight && this.state !== 'paused') this.set('dirty')
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, DEBOUNCE_MS)
  }

  /** 기다리지 않고 지금 저장 (닫기·앱 숨김·언마운트). 결과를 기다리지 않아요 */
  flushNow() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const snap = this.hooks.snapshot()
    if (snap.json === this.savedJson) return
    // 앱이 바로 꺼져도 남도록 먼저 기기에 적어 둬요
    writeDraft(this.eventId, { base: this.base, doc: snap.doc })
    this.flush()
  }

  /** 저장해야 하면 보내요 (보내는 중이면 끝난 뒤에 한 번 더) */
  flush() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.paused || this.state === 'conflict') return
    const snap = this.hooks.snapshot()
    if (snap.json === this.savedJson) {
      if (!this.inflight) {
        clearDraft(this.eventId)
        this.set('saved')
      }
      return
    }
    if (this.inflight) {
      this.again = true
      return
    }
    void this.send(snap, false)
  }

  /** 일정이 지워졌을 때 등: 저장을 멈춰요 (임시본은 남겨요) */
  setPaused(p: boolean) {
    if (this.paused === p) return
    this.paused = p
    if (p) {
      const snap = this.hooks.snapshot()
      if (snap.json !== this.savedJson) writeDraft(this.eventId, { base: this.base, doc: snap.doc })
      this.set('paused')
    } else {
      this.set('dirty')
      this.flush()
    }
  }

  /** 인터넷이 다시 연결됐을 때 */
  retry() {
    if (this.state === 'error' || this.state === 'dirty') this.flush()
  }

  /** 충돌: 다른 기기의 최신 내용으로 (내 것은 버려요) */
  useLatest() {
    const latest = this.latest
    if (!latest) return
    this.latest = null
    this.hooks.replace(latest.doc)
    this.base = latest.version
    this.sentSinceBase = []
    this.savedJson = this.hooks.snapshot().json
    clearDraft(this.eventId)
    this.hooks.onConflict(null)
    this.set('saved')
  }

  /** 충돌: 판 번호를 보지 않고 내 것으로 덮어써요 */
  keepMine() {
    this.latest = null
    this.hooks.onConflict(null)
    this.state = 'dirty'
    if (this.inflight) {
      this.again = true
      return
    }
    void this.send(this.hooks.snapshot(), true)
  }

  /** 다른 기기에서 바뀌었다는 알림: 내가 고치는 중이 아닐 때만 받아요 */
  canTakeRemote(): boolean {
    return !this.closed && !this.paused && !this.inflight && this.timer === null && this.state === 'saved'
  }

  /**
   * 받아 온 최신 회의록을 반영 (canTakeRemote 일 때만 부르세요).
   * 서버의 판 번호는 늘기만 해요: 늦게 도착한 예전 판(내가 방금 저장한 것보다 앞선 것)은 버려요
   */
  takeRemote(note: EventNote) {
    if (!this.canTakeRemote() || note.version <= this.base) return
    const json = stableJson(note.doc)
    this.base = note.version
    this.sentSinceBase = []
    if (json === this.savedJson) return
    this.hooks.replace(note.doc)
    this.savedJson = this.hooks.snapshot().json
  }

  close() {
    this.closed = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private async send(snap: Snapshot, force: boolean) {
    if (byteLength(snap.json) > NOTE_MAX_BYTES) {
      writeDraft(this.eventId, { base: this.base, doc: snap.doc })
      this.set('tooBig')
      return
    }
    this.inflight = true
    this.again = false
    this.set('saving')
    this.sentSinceBase.push(snap.json)
    if (this.sentSinceBase.length > 20) this.sentSinceBase.shift()
    try {
      const res = await useStore.getState().backend.saveEventNote(this.eventId, snap.doc, snap.plainLen, this.base, force)
      if (res.ok) {
        this.base = res.version
        this.sentSinceBase = []
        this.savedJson = snap.json
        this.hooks.onSaved(snap.plainLen)
      } else {
        const latestJson = stableJson(res.latest.doc)
        if (this.sentSinceBase.includes(latestJson)) {
          // 결과를 모른 채 끊겼던 내 저장이 서버에 들어가 있었어요: 성공으로 보고 판 번호만 맞춰요
          this.base = res.latest.version
          this.sentSinceBase = []
          this.savedJson = latestJson
          if (latestJson === snap.json) this.hooks.onSaved(snap.plainLen)
          else this.again = true
        } else if (this.hooks.snapshot().json === this.savedJson) {
          // 그사이 내가 고친 게 없으면(되돌렸으면) 최신으로 바꿔요
          this.base = res.latest.version
          this.sentSinceBase = []
          this.hooks.replace(res.latest.doc)
          this.savedJson = this.hooks.snapshot().json
        } else {
          this.inflight = false
          this.latest = res.latest
          writeDraft(this.eventId, { base: this.base, doc: this.hooks.snapshot().doc })
          this.set('conflict')
          if (!this.closed) this.hooks.onConflict(res.latest)
          return
        }
      }
    } catch (e) {
      console.error(e)
      this.inflight = false
      writeDraft(this.eventId, { base: this.base, doc: this.hooks.snapshot().doc })
      if (handleCalAuthError(e)) {
        this.set('error')
        return
      }
      const code = (e as { code?: string } | null)?.code ?? ''
      if (/not_found|no_event|deleted/.test(code)) {
        // 다른 기기에서 지운 일정: 다시 보내도 같아요 (되살리면 다시 저장해요)
        this.paused = true
        this.set('paused')
      } else if (code === 'too_big') {
        this.set('tooBig')
      } else {
        this.set('error')
      }
      return
    }
    this.inflight = false
    const cur = this.hooks.snapshot()
    if (cur.json === this.savedJson) {
      clearDraft(this.eventId)
      this.set('saved')
    } else if (this.again || this.closed) {
      void this.send(cur, false)
    } else {
      // 1초 기다리는 중 (markDirty 의 타이머가 보내요). 타이머가 없으면 바로 보내요
      this.set('dirty')
      if (!this.timer) void this.send(cur, false)
    }
  }
}
