import type { ISODate } from './types'

/** 한국 시간 기준 오늘 날짜 (YYYY-MM-DD) */
export function todayKST(now: Date = new Date()): ISODate {
  // UTC+9, 서머타임 없음
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

function parse(d: ISODate): Date {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day))
}

function fmt(d: Date): ISODate {
  return d.toISOString().slice(0, 10)
}

export function addDays(d: ISODate, n: number): ISODate {
  const x = parse(d)
  x.setUTCDate(x.getUTCDate() + n)
  return fmt(x)
}

export function dayOfWeek(d: ISODate): number {
  return parse(d).getUTCDay()
}

/** 그 날짜가 속한 주의 주일 (주일이면 그대로, 아니면 지난 주일) */
export function sundayOnOrBefore(d: ISODate): ISODate {
  return addDays(d, -dayOfWeek(d))
}

/** 지금 열어야 할 출석부 날짜: 오늘이 주일이면 오늘, 아니면 가장 최근 주일 */
export function currentSunday(now: Date = new Date()): ISODate {
  return sundayOnOrBefore(todayKST(now))
}

export function isSunday(d: ISODate): boolean {
  return dayOfWeek(d) === 0
}

/** from ~ to 사이의 모든 주일 (양 끝 포함) */
export function sundaysBetween(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = []
  let d = sundayOnOrBefore(from)
  if (d < from) d = addDays(d, 7)
  while (d <= to) {
    out.push(d)
    d = addDays(d, 7)
  }
  return out
}

/** YYYY-MM */
export function monthKey(d: ISODate): string {
  return d.slice(0, 7)
}

export function monthRange(ym: string): { from: ISODate; to: ISODate } {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` }
}

/** 11월 15일 */
export function labelMD(d: ISODate): string {
  const [, m, day] = d.split('-').map(Number)
  return `${m}월 ${day}일`
}

/** 2026년 11월 15일 (주일) */
export function labelFull(d: ISODate): string {
  const [y, m, day] = d.split('-').map(Number)
  const w = ['일', '월', '화', '수', '목', '금', '토'][dayOfWeek(d)]
  return `${y}년 ${m}월 ${day}일 (${w === '일' ? '주일' : w})`
}

/** 11.15 */
export function labelDot(d: ISODate): string {
  return `${d.slice(5, 7)}.${d.slice(8, 10)}`
}

/** 2026년 11월 */
export function labelMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${y}년 ${m}월`
}
