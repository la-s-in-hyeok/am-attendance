/**
 * 결석 심방보고 엑셀(.xlsx) — 26년 회장이 정리하던 모양 그대로 세 칸으로 나눈다
 * 시트 1 '결석 심방보고 (11.15)': 제목 · 목장 | 타지 | 기타(사유) | 연락두절 | 출석 · 합계 (A4 가로)
 *   칸마다 '이름(메모)'를 ', ' 로 이어 쓰고, 글이 길면 줄을 바꾼다
 * 시트 2 '명단형': 한 사람에 한 줄 (목장 | 이름 | 구분 | 사유·메모) — 필터로 골라 보기 좋게
 *
 * 이 파일은 화면에서 동적으로 불러온다 (exceljs 라이브러리가 커서 따로 나뉜다).
 */
import type * as Excel from 'exceljs'
import { labelDot } from './dates'
import {
  ABSENCE_CATEGORIES,
  ABSENCE_HEX,
  ABSENCE_LABEL,
  absenceCellText,
  absenceFileName,
  absenceListRows,
  presentOfTotal,
  uncheckedLine,
  type AbsenceCategory,
  type AbsenceReport,
} from './report'
import { BORDER, FILL, fillRange, loadExcel, put } from './exportXlsx'
import { downloadBlob, MIME } from '../components/report/share'

/** 열 너비: 목장 | 타지 | 기타(사유) | 연락두절 | 출석 */
const COL_WIDTH = [12, 34, 42, 28, 10] as const

const CATEGORY_FILL: Record<AbsenceCategory, string> = {
  away: `FF${ABSENCE_HEX.away}`,
  other: `FF${ABSENCE_HEX.other}`,
  nocontact: `FF${ABSENCE_HEX.nocontact}`,
}

const MUTED = 'FF555555'

/** 엑셀 열 너비 단위로 본 글자 폭 (한글·한자 ≈ 1.9칸, 나머지 ≈ 1칸) */
function textWidth(t: string): number {
  let w = 0
  for (const ch of t) w += /[ᄀ-ᇿ㄰-㆏가-힯㐀-鿿豈-﫿！-｠]/.test(ch) ? 1.9 : 1
  return w
}

/** 칸 너비에 넣었을 때 몇 줄이 되는지 (쉼표 뒤에서 줄이 바뀐다고 보고 사람 단위로 채운다) */
export function estimateLines(text: string, colWidth: number): number {
  if (!text) return 1
  const usable = Math.max(4, colWidth - 1.5)
  let lines = 1
  let cur = 0
  for (const part of text.split(', ')) {
    const w = textWidth(part)
    const add = cur === 0 ? w : w + 2
    if (cur > 0 && cur + add > usable) {
      lines++
      cur = w
    } else {
      cur += add
    }
    // 한 사람 글이 칸보다 길면 그 안에서도 줄이 바뀐다
    while (cur > usable) {
      lines++
      cur -= usable
    }
  }
  return lines
}

/** 줄 수에 맞춘 행 높이 (pt): 10pt 글자 한 줄 ≈ 15pt */
function rowHeight(lines: number, min = 24): number {
  return Math.max(min, lines * 15 + 8)
}

function buildReportSheet(wb: Excel.Workbook, report: AbsenceReport) {
  const ws = wb.addWorksheet(`결석 심방보고 (${labelDot(report.date)})`, {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    },
    views: [{ state: 'frozen', ySplit: 2, showGridLines: false }],
  })
  ws.columns = COL_WIDTH.map((width) => ({ width }))
  const last = COL_WIDTH.length

  // 제목 A1:E1
  ws.getRow(1).height = 36
  ws.mergeCells(1, 1, 1, last)
  put(ws, 1, 1, report.title, { bold: true, size: 16, fill: FILL.title })
  fillRange(ws, 1, 1, 1, last, FILL.title)

  // 머리글: 목장 | 타지 | 기타(사유) | 연락두절 | 출석
  ws.getRow(2).height = 24
  put(ws, 2, 1, '목장', { bold: true, fill: FILL.header })
  ABSENCE_CATEGORIES.forEach((c, i) => put(ws, 2, 2 + i, ABSENCE_LABEL[c], { bold: true, fill: CATEGORY_FILL[c] }))
  put(ws, 2, last, '출석', { bold: true, fill: FILL.header })

  // 목장마다 한 줄
  let r = 3
  for (const g of report.groups) {
    let lines = 1
    put(ws, r, 1, g.group.name, { bold: true })
    ABSENCE_CATEGORIES.forEach((c, i) => {
      const text = absenceCellText(g[c])
      put(ws, r, 2 + i, text, { align: 'left' })
      lines = Math.max(lines, estimateLines(text, COL_WIDTH[1 + i]))
    })
    put(ws, r, last, presentOfTotal(g.summary), { size: 9, color: MUTED })
    ws.getRow(r).height = rowHeight(lines)
    r++
  }
  if (report.groups.length === 0) {
    ws.mergeCells(r, 1, r, last)
    put(ws, r, 1, '목장원이 없어요')
    ws.getRow(r).height = 24
    r++
  }

  // 합계
  const t = report.totals
  ws.getRow(r).height = 24
  put(ws, r, 1, '합계', { bold: true, fill: FILL.title })
  ABSENCE_CATEGORIES.forEach((c, i) => put(ws, r, 2 + i, `${t[c]}명`, { bold: true, fill: FILL.title }))
  put(ws, r, last, presentOfTotal(t), { bold: true, size: 9, fill: FILL.title })
  const end = r

  // 얇은 테두리
  for (let y = 1; y <= end; y++) for (let x = 1; x <= last; x++) ws.getCell(y, x).border = BORDER

  // 미확인 (있을 때만, 한 줄 띄우고)
  let printEnd = end
  const unchecked = uncheckedLine(report)
  if (unchecked) {
    const y = end + 2
    ws.getRow(end + 1).height = 6
    ws.mergeCells(y, 1, y, last)
    const text = `* 미확인 : ${unchecked}`
    put(ws, y, 1, text, { size: 9, align: 'left', color: MUTED })
    ws.getRow(y).height = rowHeight(estimateLines(text, COL_WIDTH.reduce((a, b) => a + b, 0)), 18)
    printEnd = y
  }

  ws.pageSetup.printArea = `A1:E${printEnd}`
  ws.pageSetup.printTitlesRow = '1:2'
}

/** 명단형: 한 사람에 한 줄 (구분 순 → 목장 순) */
function buildListSheet(wb: Excel.Workbook, report: AbsenceReport) {
  const ws = wb.addWorksheet('명단형', {
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
  ws.columns = [{ width: 14 }, { width: 12 }, { width: 11 }, { width: 52 }]
  const head = ['목장', '이름', '구분', '사유·메모']
  ws.getRow(1).height = 22
  head.forEach((h, i) => put(ws, 1, i + 1, h, { bold: true, fill: FILL.header }))

  const rows = absenceListRows(report)
  let r = 2
  if (rows.length === 0) {
    ws.mergeCells(r, 1, r, 4)
    put(ws, r, 1, '이번 주는 결석자가 없어요')
    r++
  }
  for (const a of rows) {
    const fill = a.category === 'unchecked' ? undefined : CATEGORY_FILL[a.category]
    put(ws, r, 1, a.group)
    put(ws, r, 2, a.name)
    put(ws, r, 3, a.label, { fill })
    put(ws, r, 4, a.memo, { align: 'left' })
    ws.getRow(r).height = rowHeight(estimateLines(a.memo, 52), 20)
    r++
  }
  for (let y = 1; y < r; y++) for (let x = 1; x <= 4; x++) ws.getCell(y, x).border = BORDER
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: r - 1, column: 4 } }
}

export async function buildAbsenceXlsx(report: AbsenceReport): Promise<Blob> {
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'AM청년회 출석부'
  wb.created = new Date()
  buildReportSheet(wb, report)
  buildListSheet(wb, report)
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: MIME.xlsx })
}

export async function exportAbsenceXlsx(report: AbsenceReport): Promise<void> {
  const blob = await buildAbsenceXlsx(report)
  downloadBlob(blob, absenceFileName(report.date, 'xlsx'))
}
