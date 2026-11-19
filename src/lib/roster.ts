import type { AttendanceRecord, ISODate } from './types'
import { addDays, currentSunday, isSunday, todayKST } from './dates'

/**
 * 목장 이동·명단에서 빼기가 '어느 주일 출석부부터' 적용되는지.
 *
 * - 이번 주 출석부를 보고 있을 때
 *   · 주일 당일이면 오늘 출석부부터 (예배 후 목장을 잘못 넣은 것을 바로 고칠 수 있게)
 *   · 월~토요일이면 다음 주일부터 (이미 보고한 지난 주일 출석부가 바뀌지 않게)
 * - 지난 주일이나 다음 주일 출석부를 일부러 열어 두었으면 그 주일부터
 */
export function rosterChangeFrom(viewDate: ISODate, now: Date = new Date()): ISODate {
  const cs = currentSunday(now)
  if (viewDate !== cs) return viewDate
  return isSunday(todayKST(now)) ? cs : addDays(cs, 7)
}

/**
 * 명단에서 빼는 날짜 (이 주일 출석부부터 빠진다).
 * 적용 주일 또는 그 뒤에 이미 출석 기록이 있으면, 마지막 기록 다음 주일부터 빠진다
 * (기록이 숨겨지지 않도록).
 */
export function removalDate(memberId: string, records: AttendanceRecord[], viewDate: ISODate, now: Date = new Date()): ISODate {
  const from = rosterChangeFrom(viewDate, now)
  let latest: ISODate | null = null
  for (const r of records) {
    if (r.memberId === memberId && (latest === null || r.date > latest)) latest = r.date
  }
  if (latest !== null && latest >= from) return addDays(latest, 7)
  return from
}
