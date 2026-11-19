import type { KeyboardEvent } from 'react'
import type { ISODate, Member } from '../../lib/types'
import { useStore } from '../../store'
import { currentSunday, labelMD, todayKST } from '../../lib/dates'
import { rosterChangeFrom } from '../../lib/roster'
import type { ParsedGroup } from '../../lib/excelRoster'
import type { Group } from '../../lib/types'
import { newId } from '../../lib/id'

/* ───────────── 이름 ───────────── */

/** 이름 비교용: 띄어쓰기를 없애고 영문은 소문자로 */
export function normName(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase()
}

/** 뒤에 붙은 구분 글자(A, B, 2 …)를 뗀 이름. 김철수A → 김철수 */
function baseName(s: string): string {
  const n = normName(s)
  const b = n.replace(/[a-z0-9]+$/, '')
  return b.length >= 2 ? b : n
}

/** 입력한 이름 정리: 앞뒤 공백 제거, 가운데 공백은 하나로 */
export function cleanName(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
}

/** 쉼표·띄어쓰기·줄바꿈으로 나눈 이름들 */
export function parseNames(text: string): string[] {
  return text
    .split(/[\s,，、;·]+/u)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * 같은 이름, 또는 '김철수'와 '김철수A'처럼 뒤의 구분 글자만 다른 이름을 찾는다.
 * (김철수A와 김철수B는 이미 구분된 것이므로 찾지 않는다)
 */
export function findSameName(name: string, pool: Member[], excludeId?: string): Member[] {
  const n = normName(name)
  if (!n) return []
  const b = baseName(name)
  return pool.filter((m) => {
    if (m.id === excludeId) return false
    const mn = normName(m.name)
    return mn === n || baseName(m.name) === n || (b !== n && mn === b)
  })
}

/** 같은 이름을 구분하는 예시: 김철수 → '김철수A, 김철수B' */
export function suffixExample(name: string): string {
  const t = cleanName(name)
  const stripped = t.replace(/[A-Za-z0-9]+$/, '')
  const base = stripped.length >= 2 ? stripped : t
  return `${base}A, ${base}B`
}

/** 받침에 맞는 '로/으로' (한글이 아니면 '(으)로') */
export function roOf(word: string): string {
  const c = word.trim().slice(-1).charCodeAt(0)
  if (!(c >= 0xac00 && c <= 0xd7a3)) return '(으)로'
  const jong = (c - 0xac00) % 28
  return jong === 0 || jong === 8 ? '로' : '으로'
}

/* ───────────── 날짜 ───────────── */

/** 11월 15일 (올해가 아니면 2025년 11월 15일) */
export function labelDay(d: ISODate): string {
  const y = d.slice(0, 4)
  return y === currentSunday().slice(0, 4) ? labelMD(d) : `${y}년 ${labelMD(d)}`
}

/**
 * 목장 이동·명단에서 빼기가 보고 있는 주일이 아니라 다음 주일부터 적용될 때의 안내 (lib/roster.ts 의 평일 규칙).
 * 월~토요일에 이번 주 출석부를 보고 있으면, 이미 보고한 그 주일 출석부는 바꾸지 않는다. 해당하지 않으면 null.
 */
export function weekdayRuleNote(viewDate: ISODate): string | null {
  if (rosterChangeFrom(viewDate) === viewDate) return null
  return `평일에는 이미 보고한 ${labelDay(viewDate)} 출석부를 바꾸지 않고, 다음 주일 출석부부터 적용돼요.`
}

/**
 * 다시 넣을 때 '빠져 있던 기간'이 생기는지.
 * 명단 기간은 시작~끝 하나뿐이라, 다시 넣으면 빠져 있던 주일 출석부에도 (미확인으로) 다시 나온다.
 */
export function restoreGapNote(m: Member, viewing: ISODate): string | null {
  if (!m.removedOn || m.removedOn >= viewing) return null
  return `${labelDay(m.removedOn)}부터 빠져 있던 동안의 지난 출석부에도 ‘미확인’으로 다시 나와요. 그 기간 출석률이 조금 낮게 보일 수 있어요.`
}

/* ───────────── 입력 도우미 ───────────── */

/** Enter 로 실행 (한글 조합 중 Enter 는 무시해서 마지막 글자가 남는 문제를 막는다) */
export function onEnter(fn: () => void) {
  return (e: KeyboardEvent<Element>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    fn()
  }
}

/** 알아듣기 쉬운 오류 문구만 그대로 보여 준다 */
export function friendlyError(e: unknown, fallback: string): string {
  if (e instanceof Error && /[가-힣]/.test(e.message)) return e.message
  return fallback
}

/* ───────────── 엑셀 명단 불러오기 ───────────── */

/**
 * 엑셀에서 읽은 명단을 한 번에 넣는다. joinedOn = 이 주일 출석부부터 명단에 나온다.
 * 서버가 한 번에(원자적으로) 넣으므로, 다른 분이 먼저 넣었으면 아무것도 넣지 않고 'exists'.
 */
export async function importParsedRoster(
  parsed: ParsedGroup[],
  joinedOn: ISODate,
): Promise<{ result: 'done' | 'exists'; groups: number; members: number }> {
  const { backend, refresh } = useStore.getState()
  const groups: Group[] = []
  const members: Member[] = []
  parsed.forEach((pg, gi) => {
    const g: Group = { id: newId(), name: pg.name, order: gi, archived: false }
    groups.push(g)
    pg.members.forEach((pm, mi) =>
      members.push({ id: newId(), name: pm.name, groupId: g.id, role: pm.role, order: mi, joinedOn, removedOn: null, note: '' }),
    )
  })
  const result = await backend.importRoster(groups, members)
  // 'done' 이면 방금 넣은 명단을, 'exists' 이면 먼저 들어가 있던 명단을 받아 와서 보여 준다
  await refresh('roster')
  return { result, groups: groups.length, members: members.length }
}

/* ───────────── 백업 ───────────── */

const ALL_FROM = '1900-01-01'
const ALL_TO = '9999-12-31'

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/**
 * 목장·명단·출석 기록·주간 메모 전체를 JSON 파일로 내려받는다.
 * 가능하면 서버에서 '전체 기간'을 새로 받아서 저장하고, 안 되면 화면에 불러온 내용으로 저장한다.
 */
export async function downloadBackup(): Promise<{ records: number; partial: boolean }> {
  const s = useStore.getState()
  let groups = s.groups
  let members = s.members
  let records = Object.values(s.records)
  let notes = Object.values(s.notes)
  let partial = false
  try {
    const [roster, att, nts] = await Promise.all([
      s.backend.fetchRoster(),
      s.backend.fetchAttendance(ALL_FROM, ALL_TO),
      s.backend.fetchWeekNotes(ALL_FROM, ALL_TO),
    ])
    groups = roster.groups
    members = roster.members
    records = att
    notes = nts
  } catch (e) {
    console.error(e)
    partial = true
  }
  records = [...records].sort((a, b) => a.date.localeCompare(b.date) || a.memberId.localeCompare(b.memberId))
  notes = [...notes].sort((a, b) => a.date.localeCompare(b.date))
  const data = {
    app: 'AM청년회 출석부',
    format: 1,
    exportedAt: new Date().toISOString(),
    mode: s.backend.mode,
    counts: { groups: groups.length, members: members.length, records: records.length, notes: notes.length },
    groups,
    members,
    records,
    notes,
  }
  downloadFile(`AM출석부-백업-${todayKST()}.json`, JSON.stringify(data, null, 2), 'application/json')
  return { records: records.length, partial }
}

/* ───────────── 체험 모드 초기화 ───────────── */

/** backend/local.ts 가 쓰는 저장 키 */
const LOCAL_KEY = 'am-attendance:v1'

export function resetDemoData() {
  try {
    localStorage.removeItem(LOCAL_KEY)
  } catch {
    /* 무시 */
  }
  location.reload()
}
