/**
 * 목장심방 현황 엑셀(.xlsx) — 26년 'AM청년회 목장심방 현황' 엑셀과 같은 모양 (A4 가로, 시트 하나)
 *   1줄: 제목 'AM청년회 목장심방 현황 (26.11.15)'
 *   2줄: 목장 | 출석자 | 결석자 | 기타 (사유) | 총 원 | 총 출석 수 | 총 결석수
 *   목장마다 한 줄, 맨 아래 합계. 미확인이 있으면 표 아래에 한 줄
 * 총 출석 수·총 결석수는 원본처럼 '쉼표로 이름 세기' 수식이라, 이름을 고치면 숫자도 따라 바뀌어요.
 *
 * 이 파일은 화면에서 동적으로 불러온다 (exceljs 라이브러리가 커서 따로 나뉜다).
 */
import type * as Excel from 'exceljs'
import {
  absenceFileName,
  absentCount,
  uncheckedLine,
  VISIT_HEADERS,
  visitAbsent,
  visitNames,
  visitReasonText,
  type AbsenceReport,
} from './report'
import { BORDER, loadExcel, put } from './exportXlsx'
import { downloadBlob, MIME } from '../components/report/share'

/**
 * 열 너비 (원본 엑셀과 같음): 목장 | 출석자 | 결석자 | 기타 (사유) | 총 원 | 총 출석 수 | 총 결석수
 * (총 원은 원본 9 인데, exceljs 는 너비 9 를 '기본값'으로 보고 적지 않아서 9.1 로 둬요)
 */
const COL_WIDTH = [11, 41.3, 37.3, 76.1, 9.1, 12.4, 11.9] as const

/** 원본 색: 머리글 파랑 바탕·흰 글자, 목장 칸 연노랑, 총 결석수 주황 글자 */
const HEAD_FILL = 'FF4472C4'
const HEAD_TEXT = 'FFFFFFFF'
const GROUP_FILL = 'FFFFFFC4'
const ABSENT_TEXT = 'FFEB5800'
const MUTED = 'FF555555'

/** 엑셀 열 너비 단위로 본 글자 폭 (한글·한자 ≈ 1.9칸, 나머지 ≈ 1칸) */
function textWidth(t: string): number {
  let w = 0
  for (const ch of t) w += /[ᄀ-ᇿ㄰-㆏가-힯㐀-鿿豈-﫿！-｠]/.test(ch) ? 1.9 : 1
  return w
}

/** 칸 너비에 넣었을 때 몇 줄이 되는지 (줄바꿈은 그대로, 쉼표·빗금 뒤에서 줄이 바뀐다고 보고 채운다) */
export function estimateLines(text: string, colWidth: number): number {
  if (!text) return 1
  const usable = Math.max(4, colWidth - 1.5)
  let total = 0
  for (const para of text.split('\n')) {
    let lines = 1
    let cur = 0
    for (const part of para.split(/(?<=[,/]) /)) {
      const w = textWidth(part)
      const add = cur === 0 ? w : w + 1
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
    total += lines
  }
  return total
}

/** 줄 수에 맞춘 행 높이 (pt): 10pt 글자 한 줄 ≈ 14pt */
function rowHeight(lines: number, min = 24): number {
  return Math.max(min, lines * 14 + 10)
}

/** 원본과 같은 '쉼표로 이름 세기' 수식 (비었으면 빈칸) */
function countFormula(ref: string): string {
  return `IF(${ref}="","",LEN(${ref})-LEN(SUBSTITUTE(${ref},",",""))+1)`
}

function buildReportSheet(wb: Excel.Workbook, report: AbsenceReport) {
  const ws = wb.addWorksheet(report.title.replace(/^AM청년회 목장심방 현황 \((.*)\)$/, '$1'), {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.4, header: 0.3, footer: 0.3 },
    },
    views: [{ state: 'frozen', ySplit: 2, showGridLines: false, zoomScale: 90 }],
  })
  ws.columns = COL_WIDTH.map((width) => ({ width }))
  const last = COL_WIDTH.length

  // 제목 A1:G1 (테두리·바탕 없이 크게)
  ws.getRow(1).height = 50.25
  ws.mergeCells(1, 1, 1, last)
  put(ws, 1, 1, report.title, { bold: true, size: 22 })

  // 머리글
  ws.getRow(2).height = 19.5
  VISIT_HEADERS.forEach((h, i) => put(ws, 2, i + 1, h, { bold: true, size: 11, fill: HEAD_FILL, color: HEAD_TEXT }))

  // 목장마다 한 줄
  const first = 3
  let r = first
  for (const g of report.groups) {
    const present = visitNames(g.present)
    const absent = visitNames(visitAbsent(g))
    const reason = visitReasonText(g)
    put(ws, r, 1, g.group.name, { fill: GROUP_FILL })
    put(ws, r, 2, present, { align: 'left' })
    put(ws, r, 3, absent, { align: 'left' })
    put(ws, r, 4, reason, { align: 'left' })
    put(ws, r, 5, g.summary.total, { bold: true })
    put(ws, r, 6, null, { bold: true })
    put(ws, r, 7, null, { bold: true, color: ABSENT_TEXT })
    ws.getCell(r, 6).value = { formula: countFormula(`B${r}`), result: g.present.length || '' }
    ws.getCell(r, 7).value = { formula: countFormula(`C${r}`), result: absentCount(g.summary) || '' }
    const lines = Math.max(estimateLines(present, COL_WIDTH[1]), estimateLines(absent, COL_WIDTH[2]), estimateLines(reason, COL_WIDTH[3]))
    ws.getRow(r).height = rowHeight(lines)
    r++
  }
  if (report.groups.length === 0) {
    ws.mergeCells(r, 1, r, last)
    put(ws, r, 1, '목장원이 없어요')
    ws.getRow(r).height = 24
    r++
  }

  // 합계 (원본처럼 SUM 수식)
  const t = report.totals
  ws.getRow(r).height = 18
  put(ws, r, 1, '합계', { bold: true })
  for (let c = 2; c <= 4; c++) put(ws, r, c, null)
  const sum = (col: string, result: number) => ({ formula: `SUM(${col}${first}:${col}${Math.max(first, r - 1)})`, result })
  put(ws, r, 5, null, { bold: true })
  put(ws, r, 6, null, { bold: true })
  put(ws, r, 7, null, { bold: true })
  ws.getCell(r, 5).value = sum('E', t.total)
  ws.getCell(r, 6).value = sum('F', t.present)
  ws.getCell(r, 7).value = sum('G', absentCount(t))
  const end = r

  // 얇은 테두리 (제목 줄 빼고)
  for (let y = 2; y <= end; y++) for (let x = 1; x <= last; x++) ws.getCell(y, x).border = BORDER

  // 미확인 (있을 때만, 한 줄 띄우고)
  let printEnd = end
  const unchecked = uncheckedLine(report)
  if (unchecked) {
    const y = end + 2
    ws.getRow(end + 1).height = 6
    ws.mergeCells(y, 1, y, last)
    const text = `* 미확인 (아직 체크 안 함) : ${unchecked}`
    put(ws, y, 1, text, { size: 9, align: 'left', color: MUTED })
    ws.getRow(y).height = rowHeight(estimateLines(text, COL_WIDTH.reduce((a, b) => a + b, 0)), 18)
    printEnd = y
  }

  ws.pageSetup.printArea = `A1:G${printEnd}`
  ws.pageSetup.printTitlesRow = '1:2'
}

export async function buildAbsenceXlsx(report: AbsenceReport): Promise<Blob> {
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'AM청년회 출석부'
  wb.created = new Date()
  buildReportSheet(wb, report)
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: MIME.xlsx })
}

export async function exportAbsenceXlsx(report: AbsenceReport): Promise<void> {
  const blob = await buildAbsenceXlsx(report)
  downloadBlob(blob, absenceFileName(report.date, 'xlsx'))
}
