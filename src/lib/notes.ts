import type { NamedNote, WeekNote } from './types'

type NoteBody = Omit<WeekNote, 'updatedAt'>

export const noteRowKey = (n: { name: string; note: string }) => `${n.name.trim()}\u0000${n.note.trim()}`

/** 같은 줄이 몇 개씩 있는지 (같은 이름·메모 두 줄도 구분하려고 개수로 센다) */
export function countRows(rows: { name: string; note: string }[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) {
    const k = noteRowKey(r)
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}

/**
 * 줄 목록 3자 합치기 (base = 편집을 시작할 때, mine = 내 화면, theirs = 서버 최신).
 * - 내 화면 순서를 그대로 지킨다 (고친 줄이 맨 뒤로 가지 않게)
 * - 다른 기기에서 그사이 지운 줄은 내 화면에서도 뺀다 (내가 손대지 않은 줄만)
 * - 다른 기기에서 그사이 넣은 줄은 뒤에 붙인다
 */
export function mergeRows(base: NamedNote[], mine: NamedNote[], theirs: NamedNote[]): NamedNote[] {
  const baseC = countRows(base)
  const theirsC = countRows(theirs)
  const mineC = countRows(mine)

  // 다른 기기에서 지운 개수
  const removedThere = new Map<string, number>()
  for (const [k, c] of baseC) {
    const d = c - (theirsC.get(k) ?? 0)
    if (d > 0) removedThere.set(k, d)
  }
  const out: NamedNote[] = []
  for (const r of mine) {
    const k = noteRowKey(r)
    const n = removedThere.get(k) ?? 0
    if (n > 0) {
      removedThere.set(k, n - 1)
      continue
    }
    out.push(r)
  }

  // 다른 기기에서 넣은 줄 (내가 같은 줄을 따로 넣었으면 그만큼은 이미 있다)
  const added = new Map<string, number>()
  for (const [k, c] of theirsC) {
    const theirExtra = c - (baseC.get(k) ?? 0)
    const myExtra = Math.max(0, (mineC.get(k) ?? 0) - (baseC.get(k) ?? 0))
    if (theirExtra - myExtra > 0) added.set(k, theirExtra - myExtra)
  }
  for (const r of theirs) {
    const k = noteRowKey(r)
    const n = added.get(k) ?? 0
    if (n > 0) {
      out.push(r)
      added.set(k, n - 1)
    }
  }
  return out
}

/** 주간 기타 기록 3자 합치기. 글 칸(바나바·메모)은 내가 고쳤으면 내 것, 아니면 서버 것 */
export function mergeWeekNote(base: WeekNote | null, mine: NoteBody, theirs: WeekNote | undefined): NoteBody {
  if (!theirs) return mine
  const b: NoteBody = base ?? { date: mine.date, newcomers: [], visitors: [], barnabas: '', memo: '' }
  return {
    date: mine.date,
    newcomers: mergeRows(b.newcomers, mine.newcomers, theirs.newcomers),
    visitors: mergeRows(b.visitors, mine.visitors, theirs.visitors),
    barnabas: mine.barnabas !== b.barnabas ? mine.barnabas : theirs.barnabas,
    memo: mine.memo !== b.memo ? mine.memo : theirs.memo,
  }
}
