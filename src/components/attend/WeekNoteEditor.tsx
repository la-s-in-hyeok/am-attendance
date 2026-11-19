import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type Ref } from 'react'
import type { ISODate, NamedNote, WeekNote } from '../../lib/types'
import { useStore } from '../../store'
import { countRows, noteRowKey } from '../../lib/notes'
import { Icon, TextArea } from '../ui'

/* ───────────── 초안(입력 중인 내용) ───────────── */

interface Row {
  /** 화면용 키 (저장하지 않음) */
  k: string
  name: string
  note: string
}

interface Draft {
  newcomers: Row[]
  visitors: Row[]
  barnabas: string
  memo: string
}

type NoteContent = Pick<WeekNote, 'newcomers' | 'visitors' | 'barnabas' | 'memo'>

let seq = 0
const rowKey = () => `row-${++seq}`

function toDraft(n: WeekNote | undefined): Draft {
  return {
    newcomers: (n?.newcomers ?? []).map((x) => ({ k: rowKey(), name: x.name, note: x.note })),
    visitors: (n?.visitors ?? []).map((x) => ({ k: rowKey(), name: x.name, note: x.note })),
    barnabas: n?.barnabas ?? '',
    memo: n?.memo ?? '',
  }
}

/**
 * 저장하면서 서버 기록과 합쳐졌을 때, 다른 기기에서 그사이 바뀐 것을 입력 화면에도 반영한다.
 * - 다른 기기에서 넣은 줄은 더하고, 지운 줄은 뺀다 (내가 그사이 고친 줄은 건드리지 않는다)
 * - 글 칸은 서버 쪽이 실제로 달라졌고, 내가 그사이 더 고치지 않았을 때만 맞춘다
 *   (그래서 방금 친 띄어쓰기·줄바꿈이 지워지지 않는다)
 */
function withRemoteRows(cur: Draft, sent: NoteContent, merged: WeekNote): Draft {
  const fix = (list: 'newcomers' | 'visitors') => {
    const sentC = countRows(sent[list])
    const mergedC = countRows(merged[list])
    const remove = new Map<string, number>()
    for (const [k, c] of sentC) {
      const d = c - (mergedC.get(k) ?? 0)
      if (d > 0) remove.set(k, d)
    }
    let changed = false
    const rows = cur[list].filter((r) => {
      const k = noteRowKey(r)
      const n = remove.get(k) ?? 0
      if (n > 0) {
        remove.set(k, n - 1)
        changed = true
        return false
      }
      return true
    })
    const have = countRows(rows)
    const extraLeft = new Map<string, number>()
    for (const [k, c] of mergedC) {
      const extra = c - Math.max(sentC.get(k) ?? 0, have.get(k) ?? 0)
      if (extra > 0) extraLeft.set(k, extra)
    }
    for (const x of merged[list]) {
      const k = noteRowKey(x)
      const n = extraLeft.get(k) ?? 0
      if (n > 0) {
        rows.push({ k: rowKey(), name: x.name, note: x.note })
        extraLeft.set(k, n - 1)
        changed = true
      }
    }
    return changed ? rows : cur[list]
  }
  const newcomers = fix('newcomers')
  const visitors = fix('visitors')
  const barnabas = merged.barnabas !== sent.barnabas && cur.barnabas.trim() === sent.barnabas ? merged.barnabas : cur.barnabas
  const memo = merged.memo !== sent.memo && cur.memo.trim() === sent.memo ? merged.memo : cur.memo
  if (newcomers === cur.newcomers && visitors === cur.visitors && barnabas === cur.barnabas && memo === cur.memo) return cur
  return { newcomers, visitors, barnabas, memo }
}

function cleanRows(rows: { name: string; note: string }[]): NamedNote[] {
  return rows.map((r) => ({ name: r.name.trim(), note: r.note.trim() })).filter((r) => r.name || r.note)
}

/** 저장할 모양: 앞뒤 공백 없애고 빈 줄은 뺀다 */
function clean(d: Draft): NoteContent {
  return { newcomers: cleanRows(d.newcomers), visitors: cleanRows(d.visitors), barnabas: d.barnabas.trim(), memo: d.memo.trim() }
}

function contentOf(n: WeekNote | undefined): NoteContent {
  return {
    newcomers: cleanRows(n?.newcomers ?? []),
    visitors: cleanRows(n?.visitors ?? []),
    barnabas: (n?.barnabas ?? '').trim(),
    memo: (n?.memo ?? '').trim(),
  }
}

function same(a: NoteContent, n: WeekNote | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(contentOf(n))
}

function isEmpty(c: NoteContent): boolean {
  return c.newcomers.length === 0 && c.visitors.length === 0 && !c.barnabas && !c.memo
}

const SAVE_DELAY = 600

/* ───────────── 저장 (창을 닫은 뒤의 다시 저장 포함) ───────────── */

interface SaveResult {
  /** 저장된 내용 (실패면 null) */
  saved: WeekNote | null
  /** 이 저장보다 뒤에 같은 날짜 저장이 시작됐음 (그쪽이 더 새 내용) */
  newer: boolean
}

let saveSeq = 0
/** 날짜별로 마지막에 시작한 저장 번호 */
const lastSave = new Map<ISODate, number>()

/** 저장하고, 실패하면 서버에 들어갔는지 한 번 확인한다 (응답만 잃고 서버에는 들어갔을 수 있어서) */
async function saveContent(date: ISODate, content: NoteContent, base: WeekNote | null): Promise<SaveResult> {
  const my = ++saveSeq
  lastSave.set(date, my)
  let saved: WeekNote | null = null
  try {
    saved = await useStore.getState().saveNote({ date, ...content }, base)
  } catch {
    saved = null
  }
  if (!saved) {
    try {
      const fetched = (await useStore.getState().backend.fetchWeekNotes(date, date)).find((n) => n.date === date)
      if (fetched && same(content, fetched)) saved = fetched
    } catch {
      /* 확인도 안 되면 다음에 다시 저장 */
    }
  }
  return { saved, newer: lastSave.get(date) !== my }
}

/** 창을 닫은 뒤 저장하지 못한 입력 */
interface Pending {
  draft: Draft
  /** 입력의 바탕이 된 저장본 (합칠 때 기준) */
  base: WeekNote | null
  /** 저장에 실패했을 때 이 기기에 있던 저장본 */
  seen: WeekNote | null
}

/**
 * 창을 닫은 뒤에 저장이 실패한 입력 (날짜별). 닫자마자 인터넷이 끊겨도 적은 이름이 사라지지 않게
 * - 인터넷이 다시 연결되거나 앱을 내릴 때 한 번씩 다시 저장해 본다
 * - 그 전에 창을 다시 열면 그대로 보여 주고 다시 저장한다
 * - 그사이 더 새 내용이 저장됐으면 옛 입력은 버린다 (새 내용을 덮어쓰지 않게)
 */
const unsaved = new Map<ISODate, Pending>()
/** 창 밖에서 다시 저장하는 중 (날짜별) */
const retrying = new Map<ISODate, { pending: Pending; content: NoteContent; done: Promise<SaveResult> }>()
/** 지금 열려 있는 입력 화면 (날짜별): 저장하지 못한 입력을 넘겨받는 함수 (못 받으면 false) */
const openEditors = new Map<ISODate, (p: Pending) => boolean>()

function sameVersion(a: WeekNote | null, b: WeekNote | undefined): boolean {
  if (!a || !b) return !a && !b
  return a.updatedAt === b.updatedAt || same(contentOf(a), b)
}

/** 그사이 더 새 내용이 저장되지 않았음 (이어서 저장해도 새 내용을 덮어쓰지 않음) */
function stillCurrent(p: Pending, latest: WeekNote | undefined): boolean {
  return sameVersion(p.base, latest) || sameVersion(p.seen, latest)
}

let retryArmed = false
function onHiddenRetry() {
  if (document.visibilityState === 'hidden') retryUnsaved()
}
/** 남은 입력이 있을 때만 인터넷 연결·앱 내림을 지켜본다 */
function syncRetryListeners() {
  const want = unsaved.size > 0
  if (want === retryArmed) return
  retryArmed = want
  if (want) {
    window.addEventListener('online', retryUnsaved)
    document.addEventListener('visibilitychange', onHiddenRetry)
  } else {
    window.removeEventListener('online', retryUnsaved)
    document.removeEventListener('visibilitychange', onHiddenRetry)
  }
}

function keepUnsaved(date: ISODate, p: Pending) {
  // 그 날짜 창이 다시 열려 있으면 그 화면이 이어받는다
  if (openEditors.get(date)?.(p)) return
  unsaved.set(date, p)
  syncRetryListeners()
}

/** p 를 주면 그것일 때만 지운다 */
function dropUnsaved(date: ISODate, p?: Pending) {
  if (p && unsaved.get(date) !== p) return
  if (unsaved.delete(date)) syncRetryListeners()
}

/** 다시 열 때 이어받을 입력 (더 새 내용이 저장됐으면 버린다) */
function pendingFor(date: ISODate, latest: WeekNote | undefined): Pending | undefined {
  const p = unsaved.get(date)
  if (!p) return undefined
  // 다시 저장하는 중이면 화면의 저장본이 그 저장이라 비교하지 않고 이어받는다
  if (retrying.get(date)?.pending === p || stillCurrent(p, latest)) return p
  dropUnsaved(date)
  return undefined
}

/** 인터넷이 다시 연결되거나 앱을 내릴 때: 창 밖에 남은 입력을 한 번 다시 저장해 본다 */
function retryUnsaved() {
  if (!navigator.onLine) return
  for (const [date, p] of [...unsaved]) {
    // 창이 열려 있으면 그 화면이 저장한다. 이미 다시 저장하는 중이면 기다린다
    if (openEditors.has(date) || retrying.has(date)) continue
    const latest = useStore.getState().notes[date]
    const content = clean(p.draft)
    if (!stillCurrent(p, latest) || same(content, latest) || (!latest && isEmpty(content))) {
      dropUnsaved(date)
      continue
    }
    const done = saveContent(date, content, p.base)
    retrying.set(date, { pending: p, content, done })
    void done.then(({ saved, newer }) => {
      retrying.delete(date)
      // 그사이 창을 다시 열었으면 그 화면이 결과를 이어받았다 (p 가 이미 빠져 있음)
      if (saved || newer) dropUnsaved(date, p)
    })
  }
}

/** 창 안에서 스크롤되는 상자 */
function scrollBox(el: HTMLElement): HTMLElement | null {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY
    if (o === 'auto' || o === 'scroll') return n
  }
  return null
}

/* ───────────── 입력 화면 ───────────── */

export type NoteSection = 'newcomers' | 'visitors'

/**
 * 그 주일의 기타 기록 (새신자·방문·바나바·메모).
 * - 입력하면 0.6초 뒤, 그리고 입력칸을 벗어날 때 저장
 * - 입력 중에는 다른 기기에서 바뀐 내용이 와도 덮어쓰지 않는다 (벗어난 뒤에 반영)
 * - 날짜마다 key 를 바꿔 새로 그리고, 사라질 때(창을 닫을 때 포함) 남은 내용을 저장한다
 * - focusSection 이 '방문'이면 방문 칸으로 내려서 연다
 * - 테두리·제목은 감싸는 창(WeekNoteSheet)이 맡는다
 */
export function WeekNoteEditor({ date, focusSection }: { date: ISODate; focusSection?: NoteSection }) {
  const note = useStore((s) => s.notes[date])
  const [restored] = useState(() => pendingFor(date, note))
  const [draft, setDraft] = useState<Draft>(() => restored?.draft ?? toDraft(note))
  const [focusKey, setFocusKey] = useState<string | null>(null)

  const draftRef = useRef(draft)
  /** 지금 입력 화면이 바탕으로 삼은 저장본 (다른 기기 변경과 합칠 때 기준) */
  const base = useRef<WeekNote | null>(restored ? restored.base : (note ?? null))
  /** 저장 안 된 입력이 있음 */
  const dirty = useRef(restored !== undefined)
  /** 화면에 떠 있음 (창을 닫아 사라진 뒤에 저장이 실패하면 unsaved 에 남긴다) */
  const alive = useRef(true)
  /** 입력칸에 커서가 있음 */
  const focused = useRef(false)
  /** 저장 요청이 진행 중인 개수 */
  const saving = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 이 화면이 unsaved 에 남긴 것 */
  const kept = useRef<Pending | null>(null)
  /** 이어받은 입력을 처리했음 (개발 모드에서 두 번 실행돼도 한 번만) */
  const tookRestored = useRef(false)
  const visitorsHead = useRef<HTMLHeadingElement>(null)

  const replaceDraft = useCallback((next: Draft) => {
    draftRef.current = next
    setDraft(next)
  }, [])

  /** 저장 중에 또 저장할 일이 생겼음 (끝나면 이어서 저장) */
  const flushAgain = useRef(false)
  const flushRef = useRef<() => void>(() => {})

  /** 저장 결과 처리 (이 화면의 저장, 또는 이어받은 다시 저장) */
  const track = useCallback(
    (done: Promise<SaveResult>, content: NoteContent) => {
      saving.current++
      void done
        .then(({ saved, newer }) => {
          if (!saved) {
            // 입력한 내용을 지우지 않고 다음에 다시 저장한다
            dirty.current = true
            // 창을 닫은 뒤면 남겨 둔다. 그사이 더 새 저장이 시작됐으면 그쪽이 최신이라 남기지 않는다
            if (!alive.current && !newer) {
              const p: Pending = { draft: draftRef.current, base: base.current, seen: useStore.getState().notes[date] ?? null }
              kept.current = p
              keepUnsaved(date, p)
            }
            return
          }
          if (!alive.current && kept.current) dropUnsaved(date, kept.current)
          base.current = saved
          const next = withRemoteRows(draftRef.current, content, saved)
          if (next !== draftRef.current) replaceDraft(next)
        })
        .finally(() => {
          saving.current--
          // 저장하는 사이 더 입력했으면 이어서 저장
          if (!same(clean(draftRef.current), useStore.getState().notes[date])) dirty.current = true
          if (flushAgain.current) {
            flushAgain.current = false
            flushRef.current()
          }
        })
    },
    [date, replaceDraft],
  )

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (!dirty.current) return
    // 앞의 저장이 끝나기 전에 또 보내면 기준(base)이 어긋나 반쯤 친 이름이 따로 저장될 수 있다
    if (saving.current > 0) {
      flushAgain.current = true
      return
    }
    dirty.current = false
    const content = clean(draftRef.current)
    const latest = useStore.getState().notes[date]
    if (same(content, latest)) return
    if (!latest && isEmpty(content)) return
    track(saveContent(date, content, base.current), content)
  }, [date, track])
  flushRef.current = flush

  /** 입력 중이 아닐 때만 저장된 내용(다른 기기에서 바뀐 것 포함)을 화면에 반영 */
  const syncFromStore = useCallback(() => {
    if (focused.current || dirty.current || saving.current > 0) return
    const latest = useStore.getState().notes[date]
    base.current = latest ?? null
    if (same(clean(draftRef.current), latest)) return
    replaceDraft(toDraft(latest))
  }, [date, replaceDraft])

  useEffect(() => {
    syncFromStore()
  }, [note, syncFromStore])

  // 화면을 떠나거나(창 닫기 포함) 앱을 내릴 때, 인터넷이 다시 연결될 때 남은 내용을 저장
  useEffect(() => {
    alive.current = true
    // 앞서 닫은 창의 저장이 나중에 실패하면 이 화면이 이어받는다 (입력 중이 아닐 때만)
    const adopt = (p: Pending) => {
      if (dirty.current || focused.current || saving.current > 0) return false
      base.current = p.base
      replaceDraft(p.draft)
      dirty.current = true
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => flushRef.current(), SAVE_DELAY)
      return true
    }
    openEditors.set(date, adopt)
    // 지난번에 저장하지 못한 입력을 이어받았으면: 다시 저장하는 중이면 그 결과를 기다리고, 아니면 바로 저장해 본다
    if (restored && !tookRestored.current) {
      tookRestored.current = true
      dropUnsaved(date, restored)
      const r = retrying.get(date)
      if (r?.pending === restored) {
        dirty.current = false
        track(r.done, r.content)
      } else {
        flush()
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    window.addEventListener('online', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('online', flush)
      if (openEditors.get(date) === adopt) openEditors.delete(date)
      alive.current = false
      flush()
    }
  }, [date, flush, restored, replaceDraft, track])

  // '방문' 칸을 눌러 열었으면 방문 칸으로 내린다 (그리기 전에 맞춰서 화면이 튀지 않게)
  useLayoutEffect(() => {
    const el = visitorsHead.current
    if (focusSection !== 'visitors' || !el) return
    const box = scrollBox(el)
    if (box) box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 8
  }, [focusSection])

  // 초점도 방문 칸으로. 창이 먼저 초점을 잡은 뒤에 옮겨야 닫을 때 누른 칸으로 돌아간다
  useEffect(() => {
    const el = visitorsHead.current
    if (focusSection !== 'visitors' || !el) return
    const t = setTimeout(() => el.focus({ preventScroll: true }), 0)
    return () => clearTimeout(t)
  }, [focusSection])

  const update = useCallback(
    (fn: (d: Draft) => Draft) => {
      replaceDraft(fn(draftRef.current))
      dirty.current = true
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, SAVE_DELAY)
    },
    [flush, replaceDraft],
  )

  // 글을 쓰는 칸에 커서가 있을 때만 '입력 중' (제목·버튼에 초점이 있을 때는 다른 기기 변경을 반영해도 된다)
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLElement && e.target.matches('input, textarea')) focused.current = true
  }
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget
    const stillInside = next instanceof Node && e.currentTarget.contains(next)
    flush()
    if (!stillInside) {
      focused.current = false
      syncFromStore()
    }
  }

  type ListKey = 'newcomers' | 'visitors'
  const addRow = (list: ListKey) => {
    const k = rowKey()
    setFocusKey(k)
    update((d) => ({ ...d, [list]: [...d[list], { k, name: '', note: '' }] }))
  }
  const changeRow = (list: ListKey, k: string, patch: Partial<Row>) =>
    update((d) => ({ ...d, [list]: d[list].map((r) => (r.k === k ? { ...r, ...patch } : r)) }))
  const removeRow = (list: ListKey, k: string) => update((d) => ({ ...d, [list]: d[list].filter((r) => r.k !== k) }))

  const newcomerCount = draft.newcomers.filter((r) => r.name.trim()).length
  const visitorCount = draft.visitors.filter((r) => r.name.trim()).length

  return (
    <div onFocus={onFocus} onBlur={onBlur}>
      <NamedList
        title="새신자 / 새친구"
        tone="bg-accent-soft text-accent-soft-ink"
        count={newcomerCount}
        rows={draft.newcomers}
        notePlaceholder="인도자"
        addLabel="새신자 추가"
        focusKey={focusKey}
        onAdd={() => addRow('newcomers')}
        onChange={(k, patch) => changeRow('newcomers', k, patch)}
        onRemove={(k) => removeRow('newcomers', k)}
      />

      <div className="my-5 h-px bg-line" />

      <NamedList
        title="방문"
        tone="bg-brand-soft text-brand-ink"
        headingRef={visitorsHead}
        count={visitorCount}
        rows={draft.visitors}
        notePlaceholder="메모"
        addLabel="방문 추가"
        focusKey={focusKey}
        onAdd={() => addRow('visitors')}
        onChange={(k, patch) => changeRow('visitors', k, patch)}
        onRemove={(k) => removeRow('visitors', k)}
      />

      <div className="my-5 h-px bg-line" />

      <div className="grid gap-4">
        <TextArea
          label="바나바 현황"
          rows={2}
          value={draft.barnabas}
          onChange={(e) => {
            const v = e.target.value
            update((d) => ({ ...d, barnabas: v }))
          }}
          placeholder="예: 한소망(출석4주차, 바나바-1주차)"
        />
        <TextArea
          label="메모"
          rows={2}
          value={draft.memo}
          onChange={(e) => {
            const v = e.target.value
            update((d) => ({ ...d, memo: v }))
          }}
          placeholder="그 밖에 남겨 둘 내용이 있으면 적어 주세요"
        />
      </div>
    </div>
  )
}

/* ───────────── 이름 + 메모 목록 ───────────── */

const INPUT =
  'h-11 min-w-0 rounded-xl border border-line bg-hover px-3 outline-none transition placeholder:text-ink-3 focus:border-brand focus:bg-surface'

function NamedList({
  title,
  tone,
  headingRef,
  count,
  rows,
  notePlaceholder,
  addLabel,
  focusKey,
  onAdd,
  onChange,
  onRemove,
}: {
  title: string
  /** 인원 수 알약 색 */
  tone: string
  /** 이 칸으로 바로 열 때 초점을 받는 제목 */
  headingRef?: Ref<HTMLHeadingElement>
  count: number
  rows: Row[]
  notePlaceholder: string
  addLabel: string
  focusKey: string | null
  onAdd: () => void
  onChange: (k: string, patch: Partial<Row>) => void
  onRemove: (k: string) => void
}) {
  return (
    <div>
      <h3
        ref={headingRef}
        tabIndex={headingRef ? -1 : undefined}
        className="mb-2 flex items-center gap-1.5 rounded-md text-[15px] font-bold"
      >
        {title}
        <span className={`tabular rounded-full px-2 py-0.5 text-[13px] font-bold ${tone}`}>{count}명</span>
      </h3>
      {rows.length > 0 && (
        <div className="mb-2 flex flex-col gap-2">
          {rows.map((r) => (
            <div key={r.k} className="flex items-center gap-2 md:max-w-xl">
              <input
                autoFocus={r.k === focusKey}
                value={r.name}
                onChange={(e) => onChange(r.k, { name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    const noteInput = e.currentTarget.parentElement?.querySelector<HTMLInputElement>('[data-note]')
                    noteInput?.focus()
                  }
                }}
                enterKeyHint="next"
                placeholder="이름"
                aria-label={`${title} 이름`}
                className={`${INPUT} w-[36%] shrink-0 font-semibold`}
              />
              <input
                data-note
                value={r.note}
                onChange={(e) => onChange(r.k, { note: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    onAdd()
                  }
                }}
                enterKeyHint="next"
                placeholder={notePlaceholder}
                aria-label={`${title} 메모`}
                className={`${INPUT} flex-1`}
              />
              <button
                type="button"
                aria-label="이 줄 지우기"
                onClick={() => onRemove(r.k)}
                className="-mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-3 hover:bg-hover hover:text-danger"
              >
                <Icon name="x" size={18} />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={onAdd}
        className="inline-flex h-11 items-center gap-1.5 rounded-xl px-1 text-sm font-semibold text-brand-ink hover:text-brand-deep"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-white">
          <Icon name="plus" size={15} strokeWidth={2.4} />
        </span>
        {addLabel}
      </button>
    </div>
  )
}
