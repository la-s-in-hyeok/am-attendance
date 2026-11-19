import type { AttendanceRecord, Group, ISODate, Member, NamedNote, WeekNote } from '../../lib/types'
import { buildWeek, isOnRoster, rate, recKey, serviceOf, weekTotals, type MonthStat, type WeekTotals } from '../../lib/compute'
import { addDays, currentSunday, monthKey, monthRange, sundaysBetween } from '../../lib/dates'

/* 통계 탭에서만 쓰는 계산 모음. 출석률의 정의는 lib/compute.ts 를 그대로 따른다. */

/** 그 해의 12달 (YYYY-MM) */
export function monthsOfYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
}

/** 바로 앞 달 (YYYY-MM) */
export function prevMonth(ym: string): string {
  return monthKey(addDays(`${ym}-01`, -1))
}

/** 고를 수 있는 해 (최근 해가 먼저). 명단·기록에서 가장 오래된 해부터, 최대 10년 */
export function availableYears(members: Member[], records: AttendanceRecord[], maxYear: number): number[] {
  let first = maxYear
  for (const m of members) first = Math.min(first, Number(m.joinedOn.slice(0, 4)) || maxYear)
  for (const r of records) first = Math.min(first, Number(r.date.slice(0, 4)) || maxYear)
  first = Math.max(first, maxYear - 10)
  const out: number[] = []
  for (let y = maxYear; y >= first; y--) out.push(y)
  return out
}

/** 처음 열 때 보여 줄 달: 이번 해면 가장 최근 주일의 달, 지난 해면 기록이 있는 마지막 달 */
export function defaultMonthFor(year: number, curSunday: ISODate, stats: MonthStat[]): string {
  if (curSunday.startsWith(`${year}-`)) return monthKey(curSunday)
  for (let i = stats.length - 1; i >= 0; i--) if (stats[i].sundays.length > 0) return stats[i].month
  return year > Number(curSunday.slice(0, 4)) ? `${year}-01` : `${year}-12`
}

export interface WeekPoint {
  date: ISODate
  totals: WeekTotals
  rate: number | null
}

/** 주일별 합계 (목장원 출석 + 새신자 + 방문) */
export function weekPoints(
  groups: Group[],
  members: Member[],
  index: Map<string, AttendanceRecord>,
  notes: Record<ISODate, WeekNote>,
  sundays: ISODate[],
): WeekPoint[] {
  return sundays.map((d) => {
    const totals = weekTotals(buildWeek(groups, members, index, d), notes[d])
    return { date: d, totals, rate: rate(totals.present, totals.total) }
  })
}

function uniqueNames(list: NamedNote[][]): number {
  const set = new Set<string>()
  for (const l of list) for (const n of l) if (n.name.trim()) set.add(n.name.trim())
  return set.size
}

/** 그 달에 적힌 새신자·방문 (같은 사람이 여러 주 적혀도 한 번만 센다) */
export function monthNoteCounts(notes: Record<ISODate, WeekNote>, ym: string): { newcomers: number; visitors: number } {
  const { from, to } = monthRange(ym)
  const inMonth = Object.values(notes).filter((n) => n.date >= from && n.date <= to)
  return {
    newcomers: uniqueNames(inMonth.map((n) => n.newcomers)),
    visitors: uniqueNames(inMonth.map((n) => n.visitors)),
  }
}

/** 그 달 주일 수 (이번 달이면 지금까지 지난 주일만) */
export function sundaysInMonthSoFar(ym: string, curSunday: ISODate): number {
  const { from, to } = monthRange(ym)
  return sundaysBetween(from, to < curSunday ? to : curSunday).length
}

/* ───────────── 1부 / 2부 ───────────── */

export interface ServiceSplit {
  /** 1부 예배 출석 (인원·횟수의 합) */
  service1: number
  /** 2부 예배 출석 */
  service2: number
}

/**
 * 월별 출석 인원 합(MonthStat.present)을 1부·2부로 나눈다.
 * monthlyStats 와 같은 기준(그 달 출석 받은 주일, 그 주 명단, 기록 당시 목장)으로 2부만 세고,
 * 나머지를 1부로 둔다 → 1부 + 2부 가 항상 출석 인원 합과 같다.
 */
export function monthServiceSplit(
  groups: Group[],
  members: Member[],
  records: AttendanceRecord[],
  stats: MonthStat[],
): ServiceSplit[] {
  const memberById = new Map(members.map((m) => [m.id, m]))
  const groupIds = new Set(groups.map((g) => g.id))
  const monthOf = new Map<ISODate, number>()
  stats.forEach((s, i) => {
    for (const d of s.sundays) monthOf.set(d, i)
  })
  const s2 = stats.map(() => 0)
  for (const r of records) {
    if (serviceOf(r) !== 2) continue
    const i = monthOf.get(r.date)
    if (i === undefined || !groupIds.has(r.groupId)) continue
    const m = memberById.get(r.memberId)
    if (!m || !isOnRoster(m, r.date)) continue
    s2[i]++
  }
  return stats.map((s, i) => {
    const v = Math.min(s.present, s2[i])
    return { service1: s.present - v, service2: v }
  })
}

/** 그 달 출석률(%)을 1부·2부 몫으로 — 두 값의 합이 반올림한 출석률과 같도록 */
export function servicePcts(s: MonthStat | undefined, sp: ServiceSplit | undefined): [number, number] {
  if (!s || s.possible <= 0 || !sp) return [0, 0]
  const [a, b] = roundParts([(sp.service1 / s.possible) * 100, (sp.service2 / s.possible) * 100])
  return [a, b]
}

/** 기간 안에서 사람별 2부 출석 횟수 (memberStats 와 같은 기준). 1부 = 출석 - 2부 */
export function memberService2(members: Member[], records: AttendanceRecord[], from: ISODate, to: ISODate): Map<string, number> {
  const memberById = new Map(members.map((m) => [m.id, m]))
  const out = new Map<string, number>()
  const cutoff = currentSunday()
  for (const r of records) {
    // 미리 체크해 둔 다음 주일은 아직 지나지 않았으므로 세지 않는다 (heldSundays 와 같은 기준)
    if (r.date < from || r.date > to || r.date > cutoff || serviceOf(r) !== 2) continue
    const m = memberById.get(r.memberId)
    if (!m || !isOnRoster(m, r.date)) continue
    out.set(m.id, (out.get(m.id) ?? 0) + 1)
  }
  return out
}

/**
 * 평균처럼 소수인 값들을 정수로 반올림하되, 합이 '합계의 반올림'과 같도록 맞춘다 (최대 나머지 방식).
 * 예) 17.5 + 8.5 = 26 → 18 + 8 (18 + 9 = 27 이 되지 않게)
 */
export function roundParts(parts: number[]): number[] {
  const total = Math.round(parts.reduce((a, b) => a + b, 0))
  const floors = parts.map((p) => Math.floor(p))
  let left = total - floors.reduce((a, b) => a + b, 0)
  const order = parts.map((p, i) => ({ i, frac: p - Math.floor(p) })).sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const o of order) {
    if (left <= 0) break
    floors[o.i]++
    left--
  }
  return floors
}

/* ───────────── 관심이 필요한 사람 ───────────── */

export interface CareItem {
  member: Member
  /** 연속으로 못 나온 주일 수 */
  streak: number
  /** 가장 최근 결석 기록 (미확인이면 없음) */
  latest: AttendanceRecord | undefined
  /** 연속 결석 중 가장 최근에 적힌 사유 */
  latestReason: { date: ISODate; status: AttendanceRecord['status']; reason: string } | null
  /** 마지막으로 출석한 주일 (불러온 기록 안에서) */
  lastPresent: ISODate | null
}

export const CARE_MIN_STREAK = 3

/**
 * 지금 명단에 있는 사람 중, 출석을 받은 주일에 연속으로 출석하지 않은 사람.
 * - 타지·연락두절·기타·미확인 모두 '못 나옴'으로 센다
 * - 그 사람의 목장이 그 주에 출석을 전혀 안 받았으면 그 주는 건너뛴다 (목장 사정이라 개인 결석이 아님)
 * - 오늘이 주일이고 아직 확인 전이면 오늘은 건너뛴다
 */
export function careList(
  groups: Group[],
  members: Member[],
  records: AttendanceRecord[],
  index: Map<string, AttendanceRecord>,
  curSunday: ISODate,
  isSundayToday: boolean,
): CareItem[] {
  const active = new Set(groups.filter((g) => !g.archived).map((g) => g.id))
  const groupHeld = new Set<string>()
  const heldSet = new Set<ISODate>()
  for (const r of records) {
    if (r.date > curSunday) continue
    heldSet.add(r.date)
    groupHeld.add(`${r.date}|${r.groupId}`)
  }
  const heldDesc = [...heldSet].sort().reverse()
  const out: CareItem[] = []
  for (const m of members) {
    if (!active.has(m.groupId) || !isOnRoster(m, curSunday)) continue
    let streak = 0
    let latest: AttendanceRecord | undefined
    let latestReason: CareItem['latestReason'] = null
    let lastPresent: ISODate | null = null
    for (const d of heldDesc) {
      if (!isOnRoster(m, d)) break
      const r = index.get(recKey(d, m.id))
      if (!r) {
        if (isSundayToday && d === curSunday) continue
        if (!groupHeld.has(`${d}|${m.groupId}`)) continue
      }
      if (r?.status === 'present') {
        lastPresent = d
        break
      }
      streak++
      if (!latest && r) latest = r
      if (!latestReason && r?.reason.trim()) latestReason = { date: d, status: r.status, reason: r.reason.trim() }
    }
    if (streak >= CARE_MIN_STREAK) out.push({ member: m, streak, latest, latestReason, lastPresent })
  }
  return out
}
