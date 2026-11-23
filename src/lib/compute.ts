import type { AttendanceRecord, Group, ISODate, Member, Service, Status, WeekNote } from './types'
import { currentSunday, monthKey, monthRange, sundaysBetween } from './dates'
import { barnabasCount, barnabasNameKeys, nameKey, parseBarnabas } from './barnabas'

/** 그 주일 출석부에 들어가는 사람인가 */
export function isOnRoster(m: Member, date: ISODate): boolean {
  return m.joinedOn <= date && (m.removedOn === null || m.removedOn > date)
}

/** 목자 → 총무 → 나머지(순서) */
export function compareMembers(a: Member, b: Member): number {
  const rank = (m: Member) => (m.role === 'leader' ? 0 : m.role === 'manager' ? 1 : 2)
  return rank(a) - rank(b) || a.order - b.order || a.name.localeCompare(b.name, 'ko')
}

export function sortGroups(groups: Group[]): Group[] {
  return [...groups].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ko'))
}

/** date+memberId → record */
export function indexRecords(records: AttendanceRecord[]): Map<string, AttendanceRecord> {
  const map = new Map<string, AttendanceRecord>()
  for (const r of records) map.set(recKey(r.date, r.memberId), r)
  return map
}

export function recKey(date: ISODate, memberId: string): string {
  return `${date}|${memberId}`
}

export interface RosterEntry {
  member: Member
  record: AttendanceRecord | undefined
  status: Status | 'unchecked'
}

export interface GroupWeek {
  group: Group
  entries: RosterEntry[]
  summary: Counts
}

export interface Counts {
  total: number
  /** 출석 = 1부 + 2부 */
  present: number
  /** 1부 예배 출석 */
  service1: number
  /** 2부 예배 출석 */
  service2: number
  away: number
  nocontact: number
  other: number
  unchecked: number
}

export function emptyCounts(): Counts {
  return { total: 0, present: 0, service1: 0, service2: 0, away: 0, nocontact: 0, other: 0, unchecked: 0 }
}

/** 출석 기록의 예배 구분 (옛 기록처럼 값이 없으면 1부) */
export function serviceOf(r: AttendanceRecord | undefined): Service | null {
  if (!r || r.status !== 'present') return null
  return r.service === 2 ? 2 : 1
}

export function countEntries(entries: RosterEntry[]): Counts {
  const c = emptyCounts()
  for (const e of entries) {
    c.total++
    c[e.status]++
    if (e.status === 'present') {
      if (serviceOf(e.record) === 2) c.service2++
      else c.service1++
    }
  }
  return c
}

export function addCounts(a: Counts, b: Counts): Counts {
  return {
    total: a.total + b.total,
    present: a.present + b.present,
    service1: a.service1 + b.service1,
    service2: a.service2 + b.service2,
    away: a.away + b.away,
    nocontact: a.nocontact + b.nocontact,
    other: a.other + b.other,
    unchecked: a.unchecked + b.unchecked,
  }
}

/**
 * 한 주일의 목장별 출석부.
 * - 그 주일 명단에 있던 사람만 (가입일·삭제일 기준)
 * - 그 주에 기록이 있으면 기록 당시 목장에, 없으면 지금 목장에 넣는다
 * - 보관된 목장은 그 주 기록이 있을 때만 보여 준다
 */
export function buildWeek(
  groups: Group[],
  members: Member[],
  records: Map<string, AttendanceRecord>,
  date: ISODate,
): GroupWeek[] {
  const byGroup = new Map<string, RosterEntry[]>()
  for (const m of members) {
    if (!isOnRoster(m, date)) continue
    const record = records.get(recKey(date, m.id))
    const gid = record?.groupId ?? m.groupId
    const entry: RosterEntry = { member: m, record, status: record?.status ?? 'unchecked' }
    const list = byGroup.get(gid)
    if (list) list.push(entry)
    else byGroup.set(gid, [entry])
  }
  const out: GroupWeek[] = []
  for (const g of sortGroups(groups)) {
    const entries = byGroup.get(g.id) ?? []
    if (g.archived && !entries.some((e) => e.record)) continue
    entries.sort((a, b) => compareMembers(a.member, b.member))
    out.push({ group: g, entries, summary: countEntries(entries) })
  }
  return out
}

export interface WeekTotals extends Counts {
  /** 새신자 명단 인원 (바나바 명단과 겹치는 사람 포함) */
  newcomers: number
  /** 바나바 명단에 없는 새신자 (총 출석에는 이 수만 더한다. 겹치는 사람은 바나바에서 센다) */
  newcomersOnly: number
  visitors: number
  /** 바나바 명단 인원 (명단에 있는 사람은 모두 그 주에 온 사람) */
  barnabas: number
  /** 목장원 출석 + 새신자(바나바와 겹치지 않는) + 방문 + 바나바 (엑셀의 맨 아래 노란 칸) */
  grandTotal: number
}

export function weekTotals(week: GroupWeek[], note: WeekNote | undefined): WeekTotals {
  const c = week.reduce((acc, g) => addCounts(acc, g.summary), emptyCounts())
  const newcomerList = note?.newcomers.filter((n) => n.name.trim()) ?? []
  const visitors = note?.visitors.filter((n) => n.name.trim()).length ?? 0
  const b = parseBarnabas(note?.barnabas)
  const barnabas = barnabasCount(b)
  // 등록한 주에는 새신자와 바나바 명단에 같이 적히기도 해요: 그 사람은 한 번만 센다
  const inBarnabas = barnabasNameKeys(b)
  const newcomersOnly = newcomerList.filter((n) => !inBarnabas.has(nameKey(n.name))).length
  return {
    ...c,
    newcomers: newcomerList.length,
    newcomersOnly,
    visitors,
    barnabas,
    grandTotal: c.present + newcomersOnly + visitors + barnabas,
  }
}

/** 출석률 (0~1). 총원이 0이면 null */
export function rate(present: number, total: number): number | null {
  return total > 0 ? present / total : null
}

export function pct(r: number | null, digits = 0): string {
  return r === null ? '-' : `${(r * 100).toFixed(digits)}%`
}

/**
 * 출석 기록이 한 건이라도 있는 주일 = 실제로 출석을 받은 주일.
 * 다음 주일을 미리 체크해 둔 것은 아직 지나지 않았으므로 통계에서 뺀다 (cutoff 이후 제외).
 */
export function heldSundays(records: AttendanceRecord[], cutoff: ISODate = currentSunday()): Set<ISODate> {
  const out = new Set<ISODate>()
  for (const r of records) if (r.date <= cutoff) out.add(r.date)
  return out
}

export interface MonthStat {
  month: string
  /** 실제로 출석을 받은 주일들 */
  sundays: ISODate[]
  present: number
  /** 주일별 총원의 합 */
  possible: number
  rate: number | null
  byGroup: Map<string, { present: number; possible: number; rate: number | null }>
}

/**
 * 월별 출석률 = (그 달 출석 받은 주일들의 출석 인원 합) ÷ (그 주일들의 총원 합)
 * 목장별 출석률은 각 주일의 목장 명단 기준.
 */
export function monthlyStats(
  groups: Group[],
  members: Member[],
  records: AttendanceRecord[],
  months: string[],
): MonthStat[] {
  const index = indexRecords(records)
  const held = heldSundays(records)
  return months.map((ym) => {
    const { from, to } = monthRange(ym)
    const sundays = sundaysBetween(from, to).filter((d) => held.has(d))
    let present = 0
    let possible = 0
    const byGroup = new Map<string, { present: number; possible: number; rate: number | null }>()
    for (const d of sundays) {
      for (const gw of buildWeek(groups, members, index, d)) {
        present += gw.summary.present
        possible += gw.summary.total
        const cur = byGroup.get(gw.group.id) ?? { present: 0, possible: 0, rate: null }
        cur.present += gw.summary.present
        cur.possible += gw.summary.total
        byGroup.set(gw.group.id, cur)
      }
    }
    for (const v of byGroup.values()) v.rate = rate(v.present, v.possible)
    return { month: ym, sundays, present, possible, rate: rate(present, possible), byGroup }
  })
}

/** 기록이 있는 달들 + 이번 달, 오래된 순 */
export function monthsWithData(records: AttendanceRecord[], today: ISODate): string[] {
  const set = new Set(records.map((r) => monthKey(r.date)))
  set.add(monthKey(today))
  return [...set].sort()
}

export interface MemberStat {
  member: Member
  /** 명단에 있었던, 출석 받은 주일 수 */
  weeks: number
  present: number
  away: number
  nocontact: number
  other: number
  unchecked: number
  rate: number | null
}

/** 기간 안에서 사람별 출석 현황 */
export function memberStats(
  members: Member[],
  records: AttendanceRecord[],
  from: ISODate,
  to: ISODate,
): MemberStat[] {
  const index = indexRecords(records)
  const sundays = [...heldSundays(records)].filter((d) => d >= from && d <= to).sort()
  return members.map((m) => {
    const s: MemberStat = { member: m, weeks: 0, present: 0, away: 0, nocontact: 0, other: 0, unchecked: 0, rate: null }
    for (const d of sundays) {
      if (!isOnRoster(m, d)) continue
      s.weeks++
      const r = index.get(recKey(d, m.id))
      s[r?.status ?? 'unchecked']++
    }
    s.rate = rate(s.present, s.weeks)
    return s
  })
}
