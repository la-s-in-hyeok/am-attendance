/**
 * 엑셀(.xlsx) 출석부 만들기 — 원래 쓰던 엑셀 출석부와 같은 모양
 * 시트 1 (예: '11.15'): 제목(A2:N3 병합) · 머리글 · 목장별 명단 · 새신자/방문/바나바 · 총 출석 · 범례
 *   1부 출석 = 노란 칸(FFFFD700), 2부 출석 = 민트 칸(FF9BE5C8) — 원래 엑셀과 같은 색
 * 시트 2 '출석 명단': 목장 | 이름 | 예배  +  오른쪽에 목장별 1부·2부 인원표
 * 시트 3 '결석 사유': 목장 | 이름 | 상태 | 사유
 *
 * 이 파일은 화면에서 동적으로 불러온다 (exceljs 라이브러리가 커서 따로 나뉜다).
 */
import type * as Excel from 'exceljs'
import type { GroupWeek, WeekTotals } from './compute'
import type { ISODate, Service, WeekNote } from './types'
import { SERVICE_LABEL } from './types'
import { labelDot } from './dates'
import {
  absenceRows,
  attendeeRows,
  buildSheet,
  GRAND_TOTAL_LABEL,
  GRAND_TOTAL_NOTE,
  leadSplit,
  reportFileName,
  SERVICE_COLOR_NAME,
  SERVICE_HEX,
  SERVICES,
  type SheetCell,
  type SheetData,
} from './report'
import { downloadBlob, MIME } from '../components/report/share'

type ExcelModule = typeof import('exceljs')

/** 브라우저용 exceljs 는 CommonJS 묶음이라 default 로 올 때와 아닐 때가 있다 */
export async function loadExcel(): Promise<ExcelModule> {
  const mod = (await import('exceljs')) as ExcelModule & { default?: ExcelModule }
  return mod.default ?? mod
}

export const FONT = '맑은 고딕'

export const FILL = {
  title: 'FFFFE7D8',
  header: 'FFFFCEB0',
  grand: 'FFFFFF00',
}

/** 예배별 출석 칸: 1부 = FFFFD700(노랑), 2부 = FF9BE5C8(민트) */
const SERVICE_FILL: Record<Service, string> = { 1: `FF${SERVICE_HEX[1]}`, 2: `FF${SERVICE_HEX[2]}` }

/** '노랑: 1부 예배 / 민트: 2부 예배' */
const LEGEND_TEXT = SERVICES.map((s) => `${SERVICE_COLOR_NAME[s]}: ${SERVICE_LABEL[s]} 예배`).join(' / ')

const THIN: Partial<Excel.Border> = { style: 'thin', color: { argb: 'FF000000' } }
export const BORDER: Partial<Excel.Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN }

export interface CellStyle {
  bold?: boolean
  size?: number
  fill?: string
  align?: 'left' | 'center' | 'right'
  /** 글자 색 (ARGB) */
  color?: string
}

export function put(ws: Excel.Worksheet, row: number, col: number, value: string | number | null, s: CellStyle = {}) {
  const c = ws.getCell(row, col)
  c.value = value === '' ? null : value
  c.font = { name: FONT, size: s.size ?? 10, bold: s.bold ?? false, ...(s.color ? { color: { argb: s.color } } : {}) }
  c.alignment = { horizontal: s.align ?? 'center', vertical: 'middle', wrapText: true }
  if (s.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: s.fill } }
}

/** 이름 칸: 줄을 바꾸지 않고, 칸보다 길면 엑셀이 글자를 줄여 한 줄로 ('박지환A' 처럼 같은 이름 표시가 붙은 이름) */
function putName(ws: Excel.Worksheet, row: number, col: number, c: SheetCell | null) {
  put(ws, row, col, c?.name ?? null, { fill: c?.status === 'present' ? SERVICE_FILL[c.service ?? 1] : undefined })
  ws.getCell(row, col).alignment = { horizontal: 'center', vertical: 'middle', wrapText: false, shrinkToFit: true }
}

/** 세로로 rows 줄을 합친 이름 칸 (rows = 1 이면 합치지 않는다). 출석 색은 합친 칸 전체에 */
function putNameSpan(ws: Excel.Worksheet, row: number, col: number, rows: number, c: SheetCell | null) {
  if (rows > 1) ws.mergeCells(row, col, row + rows - 1, col)
  putName(ws, row, col, c)
  if (rows > 1 && c?.status === 'present') fillRange(ws, row, col, row + rows - 1, col, SERVICE_FILL[c.service ?? 1])
}

/** 병합 범위 안 모든 칸에 같은 배경 (병합된 칸 테두리·배경이 끊기지 않게) */
export function fillRange(ws: Excel.Worksheet, r1: number, c1: number, r2: number, c2: number, argb: string) {
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++) ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

function buildAttendanceSheet(wb: Excel.Workbook, sheet: SheetData) {
  const ws = wb.addWorksheet(labelDot(sheet.date), {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    },
    views: [{ showGridLines: false }],
  })

  ws.columns = [
    { width: 12 }, // A 목장명
    { width: 9 }, // B 목자/총무
    ...Array.from({ length: 10 }, () => ({ width: 8.6 })), // C~L
    { width: 7.5 }, // M 총원
    { width: 7.5 }, // N 출석
  ]

  ws.getRow(1).height = 8

  // 제목 A2:N3
  ws.mergeCells(2, 1, 3, 14)
  put(ws, 2, 1, sheet.title, { bold: true, size: 16, fill: FILL.title })
  fillRange(ws, 2, 1, 3, 14, FILL.title)

  // 머리글
  const H = 4
  ws.getRow(H).height = 22
  put(ws, H, 1, '목장명', { bold: true, fill: FILL.header })
  put(ws, H, 2, '목자', { bold: true, fill: FILL.header })
  ws.mergeCells(H, 3, H, 12)
  put(ws, H, 3, '목 장 가 족', { bold: true, fill: FILL.header })
  fillRange(ws, H, 3, H, 12, FILL.header)
  put(ws, H, 13, '총  원', { bold: true, fill: FILL.header })
  put(ws, H, 14, '출  석', { bold: true, fill: FILL.header })

  // 목장별
  // B열은 늘 두 칸 (목자 / 총무, 높이 5:5). 이름 줄이 3줄처럼 홀수면 줄마다 반 높이 두 줄로 그려서 가운데에서 가른다
  let r = H + 1
  for (const block of sheet.blocks) {
    const top = r
    const { sub, span } = leadSplit(block.rows.length)
    const units = block.rows.length * sub
    for (let u = 0; u < units; u++) ws.getRow(top + u).height = 20 / sub
    block.rows.forEach((row, i) => row.cells.forEach((c, k) => putNameSpan(ws, top + i * sub, 3 + k, sub, c)))
    putNameSpan(ws, top, 2, span, block.leader)
    putNameSpan(ws, top + span, 2, span, block.manager)
    ws.mergeCells(top, 1, top + units - 1, 1)
    put(ws, top, 1, block.group.name, { bold: true })
    ws.mergeCells(top, 13, top + units - 1, 13)
    put(ws, top, 13, block.total)
    ws.mergeCells(top, 14, top + units - 1, 14)
    put(ws, top, 14, block.present, { bold: true })
    r += units
  }

  // 새신자 / 방문 / 바나바
  for (const f of sheet.footer) {
    const line = f.text ? `${f.label} : ${f.text}` : `${f.label} :`
    // 글이 길면(바나바 명단 등) 줄이 바뀌므로 줄 수만큼 높인다 (A~M 병합 칸에 한글 약 60자)
    const lines = line.split('\n').reduce((n, part) => n + Math.max(1, Math.ceil(part.length / 60)), 0)
    ws.getRow(r).height = Math.min(409, 22 * lines)
    ws.mergeCells(r, 1, r, 13)
    put(ws, r, 1, line, { align: 'left' })
    put(ws, r, 14, f.count, { bold: true })
    r++
  }

  // 총 출석
  ws.getRow(r).height = 24
  ws.mergeCells(r, 1, r, 12)
  put(ws, r, 1, `${GRAND_TOTAL_LABEL} ${GRAND_TOTAL_NOTE}`, { bold: true, align: 'right' })
  put(ws, r, 13, sheet.memberTotal, { bold: true })
  put(ws, r, 14, sheet.grandTotal, { bold: true, size: 12, fill: FILL.grand })
  const last = r

  // 얇은 테두리
  for (let y = 2; y <= last; y++) for (let x = 1; x <= 14; x++) ws.getCell(y, x).border = BORDER

  // 범례 (한 줄 띄우고): 범례 | [1부 예배] | [2부 예배] | 노랑: 1부 예배 / 민트: 2부 예배 · 목장원 30/40명 출석
  // (출석부에는 숫자만: 1부·2부 인원은 나누지 않는다)
  ws.getRow(last + 1).height = 6
  const L = last + 2
  ws.getRow(L).height = 20
  put(ws, L, 1, '범례', { bold: true, size: 9 })
  SERVICES.forEach((s, i) => put(ws, L, 2 + i, `${SERVICE_LABEL[s]} 예배`, { bold: true, size: 9, fill: SERVICE_FILL[s] }))
  for (let x = 1; x <= 3; x++) ws.getCell(L, x).border = BORDER
  ws.mergeCells(L, 4, L, 14)
  put(ws, L, 4, `${LEGEND_TEXT}   ·   목장원 ${sheet.memberPresent}/${sheet.memberTotal}명 출석`, { size: 9, align: 'left' })

  ws.pageSetup.printArea = `A1:N${L}`
}

/** 출석 명단: 목장 | 이름 | 예배, 오른쪽(E~I)에 목장별 1부·2부 인원 */
function buildAttendeeSheet(wb: Excel.Workbook, week: GroupWeek[]) {
  const ws = wb.addWorksheet('출석 명단', {
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    },
    views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
  })
  ws.columns = [{ width: 14 }, { width: 12 }, { width: 9 }, { width: 3 }, { width: 14 }, { width: 8 }, { width: 8 }, { width: 8 }, { width: 8 }]
  ws.getRow(1).height = 22
  ;['목장', '이름', '예배'].forEach((h, i) => put(ws, 1, i + 1, h, { bold: true, fill: FILL.header }))

  const rows = attendeeRows(week)
  let r = 2
  if (rows.length === 0) {
    ws.mergeCells(r, 1, r, 3)
    put(ws, r, 1, '이번 주는 출석한 사람이 없어요')
    r++
  }
  for (const a of rows) {
    put(ws, r, 1, a.group)
    put(ws, r, 2, a.name, { fill: SERVICE_FILL[a.service] })
    put(ws, r, 3, a.serviceLabel, { fill: SERVICE_FILL[a.service] })
    r++
  }
  for (let y = 1; y < r; y++) for (let x = 1; x <= 3; x++) ws.getCell(y, x).border = BORDER
  // 자동 필터는 걸지 않는다: 같은 줄에 있는 오른쪽 인원표까지 숨겨지기 때문 (명단은 이미 목장 → 1부·2부 순)

  // 목장별 인원표 (E~I)
  const head: [string, string | undefined][] = [
    ['목장', FILL.header],
    ['총원', FILL.header],
    [SERVICE_LABEL[1], SERVICE_FILL[1]],
    [SERVICE_LABEL[2], SERVICE_FILL[2]],
    ['출석', FILL.header],
  ]
  head.forEach(([h, fill], i) => put(ws, 1, 5 + i, h, { bold: true, fill }))
  let y = 2
  const sum = { total: 0, service1: 0, service2: 0, present: 0 }
  for (const gw of week) {
    if (gw.entries.length === 0) continue
    const c = gw.summary
    ;[gw.group.name, c.total, c.service1, c.service2, c.present].forEach((v, i) => put(ws, y, 5 + i, v, { bold: i === 0 || i === 4 }))
    sum.total += c.total
    sum.service1 += c.service1
    sum.service2 += c.service2
    sum.present += c.present
    y++
  }
  ;['합계', sum.total, sum.service1, sum.service2, sum.present].forEach((v, i) => put(ws, y, 5 + i, v, { bold: true, fill: FILL.title }))
  for (let yy = 1; yy <= y; yy++) for (let x = 5; x <= 9; x++) ws.getCell(yy, x).border = BORDER
  put(ws, y + 2, 5, LEGEND_TEXT, { size: 9, align: 'left' })
  ws.mergeCells(y + 2, 5, y + 2, 9)
}

function buildAbsenceSheet(wb: Excel.Workbook, week: GroupWeek[]) {
  const ws = wb.addWorksheet('결석 사유', {
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    },
    views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
  })
  ws.columns = [{ width: 14 }, { width: 12 }, { width: 11 }, { width: 56 }]
  const head = ['목장', '이름', '상태', '사유']
  ws.getRow(1).height = 22
  head.forEach((h, i) => put(ws, 1, i + 1, h, { bold: true, fill: FILL.header }))

  const rows = absenceRows(week)
  let r = 2
  if (rows.length === 0) {
    ws.mergeCells(r, 1, r, 4)
    put(ws, r, 1, '이번 주는 결석자가 없어요')
    r++
  }
  for (const a of rows) {
    put(ws, r, 1, a.group)
    put(ws, r, 2, a.name)
    put(ws, r, 3, a.statusLabel)
    put(ws, r, 4, a.reason, { align: 'left' })
    r++
  }
  for (let y = 1; y < r; y++) for (let x = 1; x <= 4; x++) ws.getCell(y, x).border = BORDER
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: r - 1, column: 4 } }
}

export async function buildXlsx(date: ISODate, week: GroupWeek[], totals: WeekTotals, note: WeekNote | undefined): Promise<Blob> {
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'AM청년회 출석부'
  wb.created = new Date()
  buildAttendanceSheet(wb, buildSheet(date, week, totals, note))
  buildAttendeeSheet(wb, week)
  buildAbsenceSheet(wb, week)
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: MIME.xlsx })
}

export async function exportXlsx(date: ISODate, week: GroupWeek[], totals: WeekTotals, note: WeekNote | undefined): Promise<void> {
  const blob = await buildXlsx(date, week, totals, note)
  downloadBlob(blob, reportFileName(date, 'xlsx'))
}
