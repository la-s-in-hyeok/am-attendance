/**
 * 보고서용 순수 함수 모음
 * - 임원 단톡방에 붙여 넣는 목장별 보고 글 ([11월 15일 목장심방 : 믿음])
 * - 목장심방 현황 (출석자 / 결석자 / 기타(사유: 타지역·연락두절·기타)) — 화면·인쇄·Word·엑셀이 함께 쓴다
 * - 엑셀 출석부 모양의 표 데이터 (화면·인쇄·Word·엑셀이 함께 쓴다)
 */
import type { Group, ISODate, NamedNote, Role, Service, Status, WeekNote } from './types'
import { SERVICE_LABEL, STATUS_LABEL } from './types'
import type { Counts, GroupWeek, RosterEntry, WeekTotals } from './compute'
import { addCounts, emptyCounts, pct, rate, serviceOf } from './compute'
import { labelDot, labelMD } from './dates'
import { barnabasLineText, cleanPeople, parseBarnabas } from './barnabas'

/* ───────────── 공통 ───────────── */

/** 엑셀 출석부의 한 줄 이름 칸 수 (C~L) */
export const SHEET_NAME_COLS = 10

/** 이름(사유) — 사유가 없으면 이름만 */
export function nameWithReason(e: RosterEntry): string {
  const reason = e.record?.reason?.trim()
  return reason ? `${e.member.name}(${reason})` : e.member.name
}

/** 새신자·방문: 이름(메모) */
export function namedNoteText(n: NamedNote): string {
  const name = n.name.trim()
  const memo = n.note.trim()
  return memo ? `${name}(${memo})` : name
}

function cleanNotes(list: NamedNote[] | undefined): NamedNote[] {
  return (list ?? []).filter((n) => n.name.trim())
}

/**
 * 이름의 글자 폭 (글자 크기 1 = 1em 기준). 한글은 약 1em, 영문·숫자는 약 0.6em (대문자는 조금 넓게)
 * '박지환A' = 3 + 0.65 = 3.65em — 칸이 좁으면 이 폭에 맞춰 글자를 줄여 한 줄로 쓴다 (화면·인쇄·Word)
 */
export function nameWidthEm(name: string): number {
  let w = 0
  for (const ch of name) {
    if (/[A-Z]/.test(ch)) w += 0.65
    else if (/[a-z0-9]/.test(ch)) w += 0.58
    else if (ch === ' ') w += 0.3
    else if (/[.\-()·]/.test(ch)) w += 0.4
    else w += 1
  }
  return Math.max(w, 1)
}

/** 칸 폭(width)에 이름이 한 줄로 들어가는 글자 크기 — 기본 크기(base)보다 커지지는 않는다 (단위는 width 와 같게) */
export function fitNameSize(name: string, width: number, base: number): number {
  return Math.min(base, width / nameWidthEm(name))
}

/** 2026.11.15 */
export function fileStamp(date: ISODate): string {
  return date.replaceAll('-', '.')
}

/** AM청년회 출석부 2026.11.15.docx */
export function reportFileName(date: ISODate, ext: 'docx' | 'xlsx'): string {
  return `AM청년회 출석부 ${fileStamp(date)}.${ext}`
}

/** 2026 AM 청년회 출석부 (11.15) */
export function sheetTitle(date: ISODate): string {
  return `${date.slice(0, 4)} AM 청년회 출석부 (${labelDot(date)})`
}

/* ───────────── 예배(1부·2부) ───────────── */

export const SERVICES: readonly Service[] = [1, 2]

/** 엑셀 원본과 같은 출석 칸 색 (1부 = 노랑, 2부 = 민트) — 인쇄·Word·엑셀이 함께 쓴다 */
export const SERVICE_HEX: Record<Service, string> = { 1: 'FFD700', 2: '9BE5C8' }

/** 범례 글: '노랑 = 1부 예배 · 민트 = 2부 예배' */
export const SERVICE_COLOR_NAME: Record<Service, string> = { 1: '노랑', 2: '민트' }

/** '1부 18 · 2부 12' (unit 을 주면 '1부 18명 · 2부 12명') */
export function serviceSplitText(c: Pick<Counts, 'service1' | 'service2'>, unit = '', sep = ' · '): string {
  return `1부 ${c.service1}${unit}${sep}2부 ${c.service2}${unit}`
}

/* ───────────── 보고 글 (단톡방에 붙여 넣는 글) ───────────── */

export interface GroupReport {
  group: Group
  /** [11월 15일 목장심방 : 믿음] */
  heading: string
  /** 온 사람 전체 (1부 → 2부 순) */
  present: string[]
  /** 1부 예배 온 사람 */
  present1: string[]
  /** 2부 예배 온 사람 */
  present2: string[]
  away: string[]
  nocontact: string[]
  other: string[]
  unchecked: string[]
  summary: Counts
}

/** 한 목장의 보고 내용 (이름 목록) */
export function groupReport(date: ISODate, gw: GroupWeek): GroupReport {
  const r: GroupReport = {
    group: gw.group,
    heading: `[${labelMD(date)} 목장심방 : ${gw.group.name}]`,
    present: [],
    present1: [],
    present2: [],
    away: [],
    nocontact: [],
    other: [],
    unchecked: [],
    summary: gw.summary,
  }
  for (const e of gw.entries) {
    if (e.status === 'present') (serviceOf(e.record) === 2 ? r.present2 : r.present1).push(e.member.name)
    else if (e.status === 'unchecked') r.unchecked.push(e.member.name)
    else r[e.status].push(nameWithReason(e))
  }
  r.present = [...r.present1, ...r.present2]
  return r
}

export interface ReportTextOptions {
  /** 미확인(아직 체크 안 한 사람) 줄을 넣을지. 기본: 미확인이 있으면 넣는다 */
  showUnchecked?: boolean
}

/** 보고 글의 한 줄. value 가 null 이면 ' : ' 없이 제목만 (예: '- 안 온 사람') */
export interface ReportLine {
  label: string
  value: string | null
  /** '- 온 사람' 아래 1부/2부 줄 (한 칸 들여 쓴다) */
  service?: Service
}

export const REPORT_LABEL = {
  present: '- 온 사람',
  absent: '- 안 온 사람',
  none: '없음',
  away: '*타지역',
  nocontact: '*연락두절',
  other: '*기타 (사유)',
  unchecked: '*미확인',
} as const

/**
 * 온 사람 줄들
 * - 온 사람 (4명)
 *  1부 : 홍길동, 김철수
 *  2부 : 박민수, 이영희
 * (빈 예배 줄은 빼고, 아무도 안 왔으면 '- 온 사람 : 없음')
 */
function presentLines(r: GroupReport): ReportLine[] {
  if (r.present.length === 0) return [{ label: REPORT_LABEL.present, value: REPORT_LABEL.none }]
  const lines: ReportLine[] = [{ label: `${REPORT_LABEL.present} (${r.present.length}명)`, value: null }]
  for (const s of SERVICES) {
    const names = s === 1 ? r.present1 : r.present2
    if (names.length) lines.push({ label: SERVICE_LABEL[s], value: names.join(', '), service: s })
  }
  return lines
}

export function groupReportLines(r: GroupReport, opts: ReportTextOptions = {}): ReportLine[] {
  const join = (names: string[]) => names.join(', ')
  const lines: ReportLine[] = [
    ...presentLines(r),
    { label: REPORT_LABEL.absent, value: null },
    { label: REPORT_LABEL.away, value: join(r.away) },
    { label: REPORT_LABEL.nocontact, value: join(r.nocontact) },
    { label: REPORT_LABEL.other, value: join(r.other) },
  ]
  if (r.unchecked.length > 0 && opts.showUnchecked !== false) {
    lines.push({ label: REPORT_LABEL.unchecked, value: join(r.unchecked) })
  }
  return lines
}

/** '*타지역 : 최지훈' / 비어 있으면 '*타지역 :' / 제목 줄은 그대로 / 1부·2부 줄은 한 칸 들여서 ' 1부 : 홍길동' */
export function lineText(l: ReportLine): string {
  const label = l.service ? ` ${l.label}` : l.label
  if (l.value === null) return label
  return l.value ? `${label} : ${l.value}` : `${label} :`
}

/** 보고 글 한 줄이 1부/2부 줄이면 그 예배 (미리보기에서 색 표시용) */
export function serviceOfLine(line: string): Service | null {
  const m = /^ ([12])부 : /.exec(line)
  return m ? (Number(m[1]) as Service) : null
}

/**
 * 목장 하나의 보고 글
 *
 * [11월 15일 목장심방 : 믿음]
 * - 온 사람 (4명)
 *  1부 : 홍길동, 김철수
 *  2부 : 박민수, 이영희
 * - 안 온 사람
 * *타지역 : 최지훈, 정하나(안산)
 * *연락두절 : 윤서준
 * *기타 (사유) : 강다은(연락은 되는데 부담), 조은비(일)
 * *미확인 : 홍길동      ← 미확인이 있을 때만
 */
export function groupReportText(date: ISODate, gw: GroupWeek, opts: ReportTextOptions = {}): string {
  const r = groupReport(date, gw)
  return [r.heading, ...groupReportLines(r, opts).map(lineText)].join('\n')
}

/** 바나바 현황 줄의 글: '김예진-3주, 김휘민-출석2주(바나바1주)' */
export function barnabasText(note: WeekNote | undefined): string {
  return barnabasLineText(parseBarnabas(note?.barnabas))
}

/** 새신자·방문·바나바 줄 (내용이 있는 것만) */
export function extraReportLines(note: WeekNote | undefined): ReportLine[] {
  const out: ReportLine[] = []
  const newcomers = cleanNotes(note?.newcomers)
  const visitors = cleanNotes(note?.visitors)
  const barnabas = barnabasText(note)
  if (newcomers.length) out.push({ label: `* 새친구 / 새신자 (${newcomers.length}명)`, value: newcomers.map(namedNoteText).join(', ') })
  if (visitors.length) out.push({ label: `* 방문 (${visitors.length}명)`, value: visitors.map(namedNoteText).join(', ') })
  if (barnabas) out.push({ label: '* 바나바 현황', value: barnabas })
  return out
}

/**
 * 전체 현황 머리말 줄들
 * [11월 15일 AM청년회 출석 현황]
 * - 총 출석 : 36명 (1부 18명 · 2부 12명, 새신자 2명, 방문 1명, 바나바 4명(새신자 1명 겹침))
 * - 출석률 : 75% (목장원 30/40명)
 * - 미확인 : 3명      ← 미확인이 있을 때만
 * (새신자이면서 바나바 명단에도 있는 사람은 총 출석에 한 번만 들어가요: '겹침'으로 알려 준다)
 */
export function summaryLines(date: ISODate, totals: WeekTotals): string[] {
  const parts = [serviceSplitText(totals, '명')]
  if (totals.newcomers) parts.push(`새신자 ${totals.newcomers}명`)
  if (totals.visitors) parts.push(`방문 ${totals.visitors}명`)
  if (totals.barnabas) {
    const overlap = totals.newcomers - totals.newcomersOnly
    parts.push(overlap > 0 ? `바나바 ${totals.barnabas}명(새신자 ${overlap}명 겹침)` : `바나바 ${totals.barnabas}명`)
  }
  const lines = [
    `[${labelMD(date)} AM청년회 출석 현황]`,
    `- 총 출석 : ${totals.grandTotal}명 (${parts.join(', ')})`,
    `- 출석률 : ${pct(rate(totals.present, totals.total))} (목장원 ${totals.present}/${totals.total}명)`,
  ]
  if (totals.unchecked > 0) lines.push(`- 미확인 : ${totals.unchecked}명`)
  return lines
}

/**
 * 전체 보고 글: 머리말 + 목장별 보고 + 새신자/방문/바나바
 * (목장원이 한 명도 없는 목장은 뺀다)
 */
export function allReportText(
  date: ISODate,
  week: GroupWeek[],
  totals: WeekTotals,
  note: WeekNote | undefined,
  opts: ReportTextOptions = {},
): string {
  const blocks: string[] = [summaryLines(date, totals).join('\n')]
  for (const gw of week) {
    if (gw.entries.length === 0) continue
    blocks.push(groupReportText(date, gw, opts))
  }
  const extras = extraReportLines(note)
  if (extras.length) blocks.push(extras.map(lineText).join('\n'))
  return blocks.join('\n\n')
}

/* ───────────── 엑셀 모양 표 데이터 ───────────── */

export interface SheetCell {
  memberId: string
  name: string
  role: Role
  status: Status | 'unchecked'
  /** 출석이면 1부/2부, 아니면 null */
  service: Service | null
  reason: string
}

export interface SheetRow {
  /** C~L열: 항상 10칸 (빈 칸은 null) */
  cells: (SheetCell | null)[]
}

export interface SheetBlock {
  group: Group
  /**
   * B열은 줄 수와 상관없이 늘 두 칸, 높이 5:5 — 위 = 목자, 아래 = 총무 (없으면 빈 칸)
   * 짝수 줄이면 두 칸이 줄을 절반씩 나눠 갖는다. 홀수 줄이면 화면·인쇄는 줄 전체를 합친 칸 하나를 안에서 위아래 반으로
   * 나누고, 엑셀은 줄마다 반 높이 두 줄로 그려 가운데에서 가르고 (leadSplit), Word 는 가운데 줄의 칸만 위아래 반으로 나눈다
   */
  leader: SheetCell | null
  manager: SheetCell | null
  /** C~L열 줄들 (2줄 이상) */
  rows: SheetRow[]
  /** 총원 */
  total: number
  /** 출석 (= 1부 + 2부) */
  present: number
  summary: Counts
}

export interface SheetFooterRow {
  key: 'newcomers' | 'visitors' | 'barnabas'
  /** '* 새친구 / 새신자' */
  label: string
  text: string
  /** 출석 칸에 들어가는 숫자 (세 줄 + 목장원 출석 = 총 출석) */
  count: number
  /** 화면에서 숫자에 마우스를 올리면 보이는 설명 (없으면 '') */
  hint: string
}

export interface SheetData {
  date: ISODate
  title: string
  blocks: SheetBlock[]
  footer: SheetFooterRow[]
  /** 목장원 총원 합 */
  memberTotal: number
  /** 목장원 출석 합 (= 1부 + 2부) */
  memberPresent: number
  /** 목장원 출석 + 새신자 + 방문 + 바나바 (새신자·바나바에 같이 적힌 사람은 한 번만) */
  grandTotal: number
}

/** 총 출석 줄의 글 (화면·인쇄·Word·엑셀) */
export const GRAND_TOTAL_LABEL = '총 출석'
export const GRAND_TOTAL_NOTE = '(목장원 + 새신자 + 방문 + 바나바)'

function toCell(e: RosterEntry): SheetCell {
  return {
    memberId: e.member.id,
    name: e.member.name,
    role: e.member.role,
    status: e.status,
    service: serviceOf(e.record),
    reason: e.record?.reason?.trim() ?? '',
  }
}

/** 칸의 상태 글: '1부 출석' / '2부 출석' / '타지역' / … */
export function cellStatusText(c: Pick<SheetCell, 'status' | 'service'>): string {
  return c.status === 'present' ? `${SERVICE_LABEL[c.service ?? 1]} 출석` : statusText(c.status)
}

/**
 * B열 두 칸(목자 / 총무)을 5:5 로 나누는 법 (엑셀은 한 칸을 반으로 못 나누므로 sub 로 줄을 쪼갠다)
 * - sub: 이름 줄 하나를 몇 줄로 그릴지. 줄 수가 짝수면 1, 홀수면 2 (반 높이 두 줄)
 * - span: 목자 칸과 총무 칸이 각각 세로로 차지하는 줄 수 (sub 로 쪼갠 줄 기준)
 * 예) 2줄 → 1 + 1, 4줄 → 2 + 2, 3줄 → 반 줄 6개를 3 + 3 (이름 칸은 반 줄 두 개씩 합친다)
 */
export function leadSplit(rowCount: number): { sub: 1 | 2; span: number } {
  const sub = rowCount % 2 === 0 ? 1 : 2
  return { sub, span: (rowCount * sub) / 2 }
}

/**
 * 한 목장을 엑셀처럼 줄로 나눈다.
 * B열은 늘 두 칸 (위 = 목자, 아래 = 총무, 높이 5:5), 나머지는 C~L 에 10명씩.
 */
export function buildSheetBlock(gw: GroupWeek): SheetBlock {
  const entries = gw.entries
  const leader = entries.find((e) => e.member.role === 'leader')
  const manager = entries.find((e) => e.member.role === 'manager')
  const others = entries.filter((e) => e !== leader && e !== manager).map(toCell)
  const rowCount = Math.max(2, Math.ceil(others.length / SHEET_NAME_COLS))
  const rows: SheetRow[] = []
  for (let i = 0; i < rowCount; i++) {
    const slice: (SheetCell | null)[] = others.slice(i * SHEET_NAME_COLS, (i + 1) * SHEET_NAME_COLS)
    while (slice.length < SHEET_NAME_COLS) slice.push(null)
    rows.push({ cells: slice })
  }
  const s = gw.summary
  return {
    group: gw.group,
    leader: leader ? toCell(leader) : null,
    manager: manager ? toCell(manager) : null,
    rows,
    total: s.total,
    present: s.present,
    summary: s,
  }
}

export function buildSheet(date: ISODate, week: GroupWeek[], totals: WeekTotals, note: WeekNote | undefined): SheetData {
  const newcomers = cleanNotes(note?.newcomers)
  const visitors = cleanNotes(note?.visitors)
  const barnabas = parseBarnabas(note?.barnabas)
  const overlap = totals.newcomers - totals.newcomersOnly
  return {
    date,
    title: sheetTitle(date),
    blocks: week.map(buildSheetBlock),
    footer: [
      // 새친구 칸 숫자 = 바나바 명단에 없는 새신자만. 바나바 명단에도 있는 사람은 바나바 칸에서 센다
      // (그래야 출석 칸을 위에서부터 더한 값 = 총 출석. 교회 엑셀도 이 열을 더해서 총 출석을 낸다)
      {
        key: 'newcomers',
        label: '* 새친구 / 새신자',
        // 겹친 사람이 있으면 종이·엑셀·Word 에서도 숫자가 적은 이유가 보이게 줄 끝에 적는다
        text: [newcomers.map(namedNoteText).join(', '), overlap > 0 ? `(바나바 명단에도 있는 ${overlap}명은 바나바 칸에서 셈)` : '']
          .filter(Boolean)
          .join(' '),
        count: totals.newcomersOnly,
        hint: overlap > 0 ? `새신자 ${totals.newcomers}명 중 바나바 명단에도 있는 ${overlap}명은 바나바 칸에서 셌어요` : '',
      },
      { key: 'visitors', label: '* 방문', text: visitors.map(namedNoteText).join(', '), count: totals.visitors, hint: '' },
      {
        key: 'barnabas',
        label: '* 바나바 현황',
        text: barnabasLineText(barnabas),
        // 명단에 있는 사람 수 (명단으로 바꾸지 못한 예전 글은 세지 않는다)
        count: totals.barnabas,
        hint: [
          barnabas.legacy ? '예전에 적은 글은 인원에 넣지 않았어요' : '',
          totals.barnabas < cleanPeople(barnabas.people).length ? '같은 이름은 한 번만 셌어요' : '',
        ]
          .filter(Boolean)
          .join(' · '),
      },
    ],
    memberTotal: totals.total,
    memberPresent: totals.present,
    grandTotal: totals.grandTotal,
  }
}

/* ───────────── 결석 사유 목록 (엑셀 두 번째 시트) ───────────── */

export interface AbsenceRow {
  group: string
  name: string
  status: Status | 'unchecked'
  statusLabel: string
  reason: string
}

const ABSENT_ORDER: (Status | 'unchecked')[] = ['away', 'nocontact', 'other', 'unchecked']

export function statusText(s: Status | 'unchecked'): string {
  return s === 'unchecked' ? '미확인' : s === 'away' ? '타지역' : STATUS_LABEL[s]
}

/** 출석하지 않은 사람 (목장 순서 → 타지역·연락두절·기타·미확인 순) */
export function absenceRows(week: GroupWeek[]): AbsenceRow[] {
  const out: AbsenceRow[] = []
  for (const gw of week) {
    for (const s of ABSENT_ORDER) {
      for (const e of gw.entries) {
        if (e.status !== s) continue
        out.push({
          group: gw.group.name,
          name: e.member.name,
          status: s,
          statusLabel: statusText(s),
          reason: e.record?.reason?.trim() ?? '',
        })
      }
    }
  }
  return out
}

/* ───────────── 출석 명단 (엑셀 세 번째 시트) ───────────── */

export interface AttendeeRow {
  group: string
  name: string
  service: Service
  /** '1부' / '2부' */
  serviceLabel: string
}

/** 출석한 사람 (목장 순서 → 1부·2부 순 → 목장 안 순서) */
export function attendeeRows(week: GroupWeek[]): AttendeeRow[] {
  const out: AttendeeRow[] = []
  for (const gw of week) {
    for (const s of SERVICES) {
      for (const e of gw.entries) {
        if (e.status !== 'present' || serviceOf(e.record) !== s) continue
        out.push({ group: gw.group.name, name: e.member.name, service: s, serviceLabel: SERVICE_LABEL[s] })
      }
    }
  }
  return out
}

/* ───────────── 목장심방 현황 (출석자 / 결석자 / 기타(사유)) ───────────── */

/** 결석의 세 가지 — 26년 '목장심방 현황' 엑셀의 기타(사유) 칸과 같은 순서는 VISIT_CATEGORIES */
export type AbsenceCategory = 'away' | 'other' | 'nocontact'

export const ABSENCE_CATEGORIES: readonly AbsenceCategory[] = ['away', 'other', 'nocontact']

export const ABSENCE_LABEL: Record<AbsenceCategory, string> = {
  away: '타지',
  other: '기타(사유)',
  nocontact: '연락두절',
}

/** 머리글 칸 색 (엑셀·Word·인쇄): 타지 = 하늘, 기타 = 연보라, 연락두절 = 연회색 */
export const ABSENCE_HEX: Record<AbsenceCategory, string> = {
  away: 'DCEBFF',
  other: 'ECE3FF',
  nocontact: 'E6E8EC',
}

/** 목장심방 현황에 오르는 한 사람 */
export interface AbsencePerson {
  memberId: string
  name: string
  /** 사유·메모 (기타는 사유, 타지·연락두절은 선택 메모) */
  memo: string
}

export interface AbsenceGroup {
  group: Group
  /** 출석한 사람 (1부·2부) */
  present: AbsencePerson[]
  away: AbsencePerson[]
  other: AbsencePerson[]
  nocontact: AbsencePerson[]
  /** 아직 체크 안 한 사람 */
  unchecked: AbsencePerson[]
  /** 총원·출석(1부·2부)·결석 인원 */
  summary: Counts
}

export interface AbsenceReport {
  date: ISODate
  /** AM청년회 목장심방 현황 (26.11.15) */
  title: string
  /** 목장원이 있는 목장만, 목장 순서대로 */
  groups: AbsenceGroup[]
  /** 위 목장들의 합 */
  totals: Counts
}

/** 26.11.15 (목장심방 현황 제목·파일 이름에 쓰는 날짜) */
export function visitStamp(date: ISODate): string {
  return `${date.slice(2, 4)}.${labelDot(date)}`
}

/** AM청년회 목장심방 현황 (26.11.15) */
export function absenceTitle(date: ISODate): string {
  return `AM청년회 목장심방 현황 (${visitStamp(date)})`
}

/** AM청년회 목장심방 현황 (26.11.15).xlsx */
export function absenceFileName(date: ISODate, ext: 'docx' | 'xlsx'): string {
  return `${absenceTitle(date)}.${ext}`
}

/** 이름(메모) — 메모가 없으면 이름만 */
export function absencePersonText(p: AbsencePerson): string {
  return p.memo ? `${p.name}(${p.memo})` : p.name
}

/** 한 칸에 들어가는 글: '최지훈(안산), 정하나' */
export function absenceCellText(list: AbsencePerson[]): string {
  return list.map(absencePersonText).join(', ')
}

/** 목장 하나의 목장심방 현황 */
export function absenceGroup(gw: GroupWeek): AbsenceGroup {
  const g: AbsenceGroup = { group: gw.group, present: [], away: [], other: [], nocontact: [], unchecked: [], summary: gw.summary }
  for (const e of gw.entries) {
    const person: AbsencePerson = { memberId: e.member.id, name: e.member.name, memo: e.record?.reason?.trim() ?? '' }
    g[e.status].push(person)
  }
  return g
}

/** 이번 주 목장심방 현황 (목장원이 한 명도 없는 목장은 뺀다) */
export function buildAbsenceReport(date: ISODate, week: GroupWeek[]): AbsenceReport {
  const groups = week.filter((gw) => gw.entries.length > 0).map(absenceGroup)
  const totals = groups.reduce((acc, g) => addCounts(acc, g.summary), emptyCounts())
  return { date, title: absenceTitle(date), groups, totals }
}

/** 출석 칸: '6/10' */
export function presentOfTotal(c: Pick<Counts, 'present' | 'total'>): string {
  return `${c.present}/${c.total}`
}

/** 미확인 한 줄: '홍길동(믿음), 김철수(소망)' — 없으면 빈 글 */
export function uncheckedLine(report: AbsenceReport): string {
  return report.groups.flatMap((g) => g.unchecked.map((p) => `${p.name}(${g.group.name})`)).join(', ')
}

/** 구분 글 (현황 칸·합계) */
export const ABSENCE_KIND_LABEL: Record<AbsenceCategory | 'unchecked', string> = {
  away: '타지',
  other: '기타',
  nocontact: '연락두절',
  unchecked: '미확인',
}

/* ───────────── 목장심방 현황 표 (엑셀·Word·인쇄가 함께 쓴다) ───────────── */

/** 기타(사유) 칸의 순서와 이름: 26년 '목장심방 현황' 엑셀과 같다 */
export const VISIT_CATEGORIES: readonly AbsenceCategory[] = ['away', 'nocontact', 'other']

export const VISIT_LABEL: Record<AbsenceCategory, string> = {
  away: '타지역',
  nocontact: '연락두절',
  // 26년 목장심방 현황 양식 그대로 (목자가 사유를 적는 자리)
  other: '기타 (사유적어주세요)',
}

/** 표 머리글: 목장 | 출석자 | 결석자 | 기타 (사유) | 총 원 | 총 출석 수 | 총 결석수 */
export const VISIT_HEADERS = ['목장', '출석자', '결석자', '기타 (사유)', '총 원', '총 출석 수', '총 결석수'] as const

/** 결석한 사람 (타지역 → 연락두절 → 기타 순) */
export function visitAbsent(g: AbsenceGroup): AbsencePerson[] {
  return VISIT_CATEGORIES.flatMap((c) => g[c])
}

/** 결석 인원 = 타지 + 연락두절 + 기타 (미확인은 빼요) */
export function absentCount(c: Pick<Counts, 'away' | 'nocontact' | 'other'>): number {
  return c.away + c.nocontact + c.other
}

/** 출석자·결석자 칸: 이름만 ', ' 로 (엑셀이 쉼표로 인원을 세요) */
export function visitNames(list: AbsencePerson[]): string {
  return list.map((p) => p.name).join(', ')
}

/** 기타(사유) 칸의 한 줄: { label: '타지역', text: '최지훈(안산), 정하나' } — 사람이 없는 구분은 빼요 */
export function visitReasonParts(g: AbsenceGroup): { category: AbsenceCategory; label: string; people: AbsencePerson[]; text: string }[] {
  // 양식처럼 결석자가 있으면 세 구분을 모두 적고(사람이 없는 구분은 이름 칸만 비워요), 결석자가 없으면 칸을 비워요
  if (visitAbsent(g).length === 0) return []
  return VISIT_CATEGORIES.map((c) => ({
    category: c,
    label: VISIT_LABEL[c],
    people: g[c],
    // 기타는 사람마다 사유가 길어서 ' / ' 로 나눠요 (26년 엑셀과 같이)
    text: g[c].map(absencePersonText).join(c === 'other' ? ' / ' : ', '),
  }))
}

/** 기타(사유) 칸 글: '*타지역 : …\n*연락두절 : …\n*기타 (사유적어주세요) : 이름(사유) / …' */
export function visitReasonText(g: AbsenceGroup): string {
  return visitReasonParts(g)
    .map((p) => `*${p.label} : ${p.text}`)
    .join('\n')
}
