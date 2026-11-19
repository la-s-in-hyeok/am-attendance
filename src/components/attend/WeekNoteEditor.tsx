import { useCallback, useEffect, useRef, useState, type FocusEvent } from 'react'
import type { ISODate, NamedNote, WeekNote } from '../../lib/types'
import { currentSunday, labelMD } from '../../lib/dates'
import { useStore } from '../../store'
import { countRows, noteRowKey } from '../../lib/notes'
import { Card, Icon, TextArea } from '../ui'

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

/**
 * 그 주일의 기타 기록 (새신자·방문·바나바·메모).
 * - 입력하면 0.6초 뒤, 그리고 입력칸을 벗어날 때 저장
 * - 입력 중에는 다른 기기에서 바뀐 내용이 와도 덮어쓰지 않는다 (벗어난 뒤에 반영)
 * - 날짜마다 key 를 바꿔 새로 그리고, 사라질 때 남은 내용을 저장한다
 */
export function WeekNoteEditor({ date }: { date: ISODate }) {
  const note = useStore((s) => s.notes[date])
  const [draft, setDraft] = useState<Draft>(() => toDraft(note))
  const [focusKey, setFocusKey] = useState<string | null>(null)

  const draftRef = useRef(draft)
  /** 지금 입력 화면이 바탕으로 삼은 저장본 (다른 기기 변경과 합칠 때 기준) */
  const base = useRef<WeekNote | null>(note ?? null)
  /** 저장 안 된 입력이 있음 */
  const dirty = useRef(false)
  /** 입력칸에 커서가 있음 */
  const focused = useRef(false)
  /** 저장 요청이 진행 중인 개수 */
  const saving = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const replaceDraft = useCallback((next: Draft) => {
    draftRef.current = next
    setDraft(next)
  }, [])

  /** 저장 중에 또 저장할 일이 생겼음 (끝나면 이어서 저장) */
  const flushAgain = useRef(false)
  const flushRef = useRef<() => void>(() => {})

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
    const store = useStore.getState()
    const latest = store.notes[date]
    if (same(content, latest)) return
    if (!latest && isEmpty(content)) return
    saving.current++
    void store
      .saveNote({ date, ...content }, base.current)
      .then(async (merged) => {
        if (!merged) {
          // 저장 실패: 응답만 잃고 서버에는 들어갔을 수 있으니 한 번 확인한다.
          // 들어가 있으면 그것을 기준으로 삼고, 아니면 입력한 내용을 지우지 않고 다음에 다시 저장한다
          try {
            const fetched = (await useStore.getState().backend.fetchWeekNotes(date, date)).find((n) => n.date === date)
            if (fetched && same(content, fetched)) {
              base.current = fetched
              return
            }
          } catch {
            /* 확인도 안 되면 다음에 다시 저장 */
          }
          dirty.current = true
          return
        }
        base.current = merged
        const next = withRemoteRows(draftRef.current, content, merged)
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
  }, [date, replaceDraft])
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

  // 화면을 떠나거나 앱을 내릴 때 남은 내용을 저장
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [flush])

  const update = useCallback(
    (fn: (d: Draft) => Draft) => {
      replaceDraft(fn(draftRef.current))
      dirty.current = true
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, SAVE_DELAY)
    },
    [flush, replaceDraft],
  )

  const onFocus = () => {
    focused.current = true
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
  const isThisWeek = date === currentSunday()

  return (
    <Card className="p-5" onFocus={onFocus} onBlur={onBlur}>
      <div className="mb-4">
        <h2 className="text-lg font-extrabold">{isThisWeek ? '이번 주' : labelMD(date)} 기타 기록</h2>
      </div>

      <NamedList
        title="새신자 / 새친구"
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

      <div className="grid gap-4 lg:grid-cols-2">
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
    </Card>
  )
}

/* ───────────── 이름 + 메모 목록 ───────────── */

const INPUT =
  'h-11 min-w-0 rounded-xl border border-line bg-[#fafaf8] px-3 outline-none transition placeholder:text-ink-3 focus:border-ink focus:bg-surface'

function NamedList({
  title,
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
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[15px] font-bold">
          {title}
          <span className="tabular ml-1.5 rounded-full bg-present-soft px-2 py-0.5 text-[13px] font-bold text-present-ink">{count}명</span>
        </p>
      </div>
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
                className="-mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-3 hover:bg-black/5 hover:text-danger"
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
        className="inline-flex h-11 items-center gap-1.5 rounded-xl px-1 text-sm font-semibold text-ink-2 hover:text-ink"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-bg">
          <Icon name="plus" size={15} strokeWidth={2.4} />
        </span>
        {addLabel}
      </button>
    </div>
  )
}
