import type { CalEvent, DayISO } from '../../lib/types'
import { addDays, dayOfWeek, monthRange, sundayOnOrBefore } from '../../lib/dates'

/*
 * 달력 계산 (순수 함수). 날짜는 모두 'YYYY-MM-DD' 문자열로만 다뤄요.
 * 기기 시간대가 달라도(예: 미국) 칸이 하루 밀리지 않도록 new Date 의 '현지 시간'은 쓰지 않아요.
 */

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const

/** 휴대폰 칸 하나에 보이는 막대 줄 수 (넘치면 '+N') */
export const MAX_LANES = 3

/** 두 날짜 사이 날 수 (b - a) */
export function diffDays(a: DayISO, b: DayISO): number {
  const [y1, m1, d1] = a.split('-').map(Number)
  const [y2, m2, d2] = b.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
}

/** 'YYYY-MM' 에서 n 달 뒤 */
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

/** 그 달을 덮는 주들 (일요일 시작, 5~6주). 각 주는 7개의 날짜 */
export function monthWeeks(ym: string): DayISO[][] {
  const { from, to } = monthRange(ym)
  const weeks: DayISO[][] = []
  let d = sundayOnOrBefore(from)
  while (d <= to) {
    const week: DayISO[] = []
    for (let i = 0; i < 7; i++) week.push(addDays(d, i))
    weeks.push(week)
    d = addDays(d, 7)
  }
  return weeks
}

/** 그 날에 걸친 일정인지 */
export function covers(e: Pick<CalEvent, 'startDate' | 'endDate'>, day: DayISO): boolean {
  return e.startDate <= day && day <= e.endDate
}

/** 시작일 → 긴 것 → 제목 순 (달력·목록이 같은 순서) */
export function compareEvents(a: CalEvent, b: CalEvent): number {
  if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1
  const la = diffDays(a.startDate, a.endDate)
  const lb = diffDays(b.startDate, b.endDate)
  if (la !== lb) return lb - la
  if (a.title !== b.title) return a.title < b.title ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export interface Segment {
  event: CalEvent
  /** 몇 번째 줄 (0 부터) */
  lane: number
  /** 시작 칸 (0 = 일요일) */
  col: number
  /** 몇 칸 */
  span: number
  /** 지난주부터 이어짐 (왼쪽 모서리를 각지게) */
  contLeft: boolean
  /** 다음 주로 이어짐 */
  contRight: boolean
  /** 칸에 그릴 수 있는지 (줄이 넘치면 '+N' 으로) */
  visible: boolean
}

export interface WeekLayout {
  segments: Segment[]
  /** 칸마다 가려진 일정 수 (0 이면 '+N' 없음) */
  hidden: number[]
}

/** 한 주에 일정 막대를 줄(lane)로 배치해요. 먼저 시작하는 것, 긴 것이 위로 */
export function weekLayout(week: DayISO[], events: CalEvent[], maxLanes = MAX_LANES): WeekLayout {
  const first = week[0]
  const last = week[6]
  const list = events.filter((e) => e.startDate <= last && e.endDate >= first).sort(compareEvents)
  const used: boolean[][] = [] // used[lane][col]
  const segments: Segment[] = []
  for (const event of list) {
    const col = Math.max(0, diffDays(first, event.startDate))
    const end = Math.min(6, diffDays(first, event.endDate))
    let lane = 0
    for (; ; lane++) {
      const row = (used[lane] ??= Array(7).fill(false))
      let free = true
      for (let c = col; c <= end; c++) if (row[c]) free = false
      if (free) {
        for (let c = col; c <= end; c++) row[c] = true
        break
      }
    }
    segments.push({
      event,
      lane,
      col,
      span: end - col + 1,
      contLeft: event.startDate < first,
      contRight: event.endDate > last,
      visible: true,
    })
  }
  // 칸 하나라도 maxLanes 줄을 넘으면, 그 칸에 걸친 막대는 마지막 줄을 '+N' 에 내주고 숨겨요
  const overflow = Array(7).fill(false) as boolean[]
  for (const s of segments) if (s.lane >= maxLanes) for (let c = s.col; c < s.col + s.span; c++) overflow[c] = true
  const hidden = Array(7).fill(0) as number[]
  for (const s of segments) {
    let show = s.lane < maxLanes - 1
    if (s.lane === maxLanes - 1) {
      show = true
      for (let c = s.col; c < s.col + s.span; c++) if (overflow[c]) show = false
    }
    s.visible = show
    if (!show) for (let c = s.col; c < s.col + s.span; c++) hidden[c]++
  }
  return { segments, hidden }
}

/** 받침이 있는 글자인지 (ㄹ 받침은 '로'를 쓰므로 따로) */
function finalConsonant(ch: string): 'none' | 'rieul' | 'other' {
  const code = ch.charCodeAt(0) - 0xac00
  if (code < 0 || code > 11171) return 'none'
  const jong = code % 28
  if (jong === 0) return 'none'
  return jong === 8 ? 'rieul' : 'other'
}

/** '11월 21일(토)' → '11월 21일(토)로', '19일(목)' → '19일(목)으로' */
export function withRo(word: string): string {
  const plain = word.replace(/[)\]\s]+$/, '')
  const k = finalConsonant(plain.slice(-1))
  return `${word}${k === 'other' ? '으로' : '로'}`
}

/** '11월 21일(토)' */
export function labelDayShort(d: DayISO): string {
  const [, m, day] = d.split('-').map(Number)
  return `${m}월 ${day}일(${WEEKDAYS[dayOfWeek(d)]})`
}

/** '11월 21일 토요일' (고른 날 목록 제목) */
export function labelDayLong(d: DayISO): string {
  const [, m, day] = d.split('-').map(Number)
  return `${m}월 ${day}일 ${WEEKDAYS[dayOfWeek(d)]}요일`
}

/**
 * 기간 라벨. 하루면 '2월 25일(목)', 같은 달이면 '2월 25일(목) ~ 27일(토)',
 * 달이 다르면 '1월 29일(금) ~ 2월 2일(화)', 해가 다르면 앞에 연도도
 */
export function labelRange(start: DayISO, end: DayISO, withYear = false): string {
  const [y1, m1, d1] = start.split('-').map(Number)
  const [y2, m2, d2] = end.split('-').map(Number)
  const w1 = WEEKDAYS[dayOfWeek(start)]
  const w2 = WEEKDAYS[dayOfWeek(end)]
  const head = `${withYear || y1 !== y2 ? `${y1}년 ` : ''}${m1}월 ${d1}일(${w1})`
  if (start === end) return head
  if (y1 !== y2) return `${head} ~ ${y2}년 ${m2}월 ${d2}일(${w2})`
  if (m1 !== m2) return `${head} ~ ${m2}월 ${d2}일(${w2})`
  return `${head} ~ ${d2}일(${w2})`
}

/** '11월' (withYear 면 '2027년 1월') */
export function labelMonthShort(ym: string, withYear = false): string {
  const [y, m] = ym.split('-').map(Number)
  return withYear ? `${y}년 ${m}월` : `${m}월`
}

/** 그 달(YYYY-MM)에 걸친 일정 (정렬해서) */
export function eventsInMonth(events: CalEvent[], ym: string): CalEvent[] {
  const { from, to } = monthRange(ym)
  return events.filter((e) => e.startDate <= to && e.endDate >= from).sort(compareEvents)
}

/** ym 다음으로 일정이 있는 달 (없으면 null) */
export function nextMonthWithEvents(events: CalEvent[], ym: string): string | null {
  const { to } = monthRange(ym)
  let best: DayISO | null = null
  for (const e of events) if (e.startDate > to && (best === null || e.startDate < best)) best = e.startDate
  return best ? best.slice(0, 7) : null
}

/** ym 앞으로 일정이 있는 가장 가까운 달 (없으면 null) */
export function prevMonthWithEvents(events: CalEvent[], ym: string): string | null {
  const from = `${ym}-01`
  let best: DayISO | null = null
  for (const e of events) if (e.endDate < from && (best === null || e.endDate > best)) best = e.endDate
  return best ? best.slice(0, 7) : null
}
