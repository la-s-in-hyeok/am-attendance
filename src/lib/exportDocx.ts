/**
 * Word(.docx) 출석부 만들기
 * - 1쪽(A4 가로): 엑셀과 같은 모양의 출석부 표 (1부 출석 = 노랑 FFD700, 2부 출석 = 민트 9BE5C8) + 범례
 * - 2쪽부터(A4 세로): 목장별 출결 현황 (단톡방 보고 글 형식, 온 사람은 1부·2부로 나눠서)
 *
 * 이 파일은 화면에서 동적으로 불러온다 (docx 라이브러리가 커서 따로 나뉜다).
 */
import {
  AlignmentType,
  Document,
  HeightRule,
  Packer,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType,
} from 'docx'
import type { GroupWeek, WeekTotals } from './compute'
import type { ISODate, Service, WeekNote } from './types'
import { SERVICE_LABEL } from './types'
import { labelFull } from './dates'
import {
  buildSheet,
  extraReportLines,
  fitNameSize,
  GRAND_TOTAL_LABEL,
  GRAND_TOTAL_NOTE,
  groupReport,
  groupReportLines,
  reportFileName,
  SERVICE_COLOR_NAME,
  SERVICE_HEX,
  SERVICES,
  summaryLines,
  type ReportLine,
  type SheetCell,
  type SheetData,
} from './report'
import { downloadBlob, MIME } from '../components/report/share'

export const FONT = '맑은 고딕'

export const COLOR = {
  title: 'FFE7D8',
  header: 'FFCEB0',
  grand: 'FFFF00',
  muted: '6B6F78',
}

/** 예배별 출석 칸 (엑셀 원본과 같은 색): 1부 = FFD700, 2부 = 9BE5C8 */
const SERVICE_FILL: Record<Service, string> = SERVICE_HEX

export function shade(fill: string) {
  return { type: ShadingType.CLEAR, color: 'auto', fill }
}

/** A4 (세로 기준, twip) */
export const A4 = { width: 11906, height: 16838 }
export const MARGIN = 567 // 1cm

/** 목장명 | 목자 | 이름 10칸 | 총원 | 출석 (합계 15,690 twip ≒ A4 가로 본문 폭) */
const COLS = [1400, 1150, ...Array<number>(10).fill(1150), 820, 820]

function spanWidth(from: number, span: number): number {
  return COLS.slice(from, from + span).reduce((a, b) => a + b, 0)
}

interface TextOpts {
  bold?: boolean
  /** pt */
  size?: number
  color?: string
  align?: (typeof AlignmentType)[keyof typeof AlignmentType]
}

function para(text: string, o: TextOpts = {}): Paragraph {
  return new Paragraph({
    alignment: o.align ?? AlignmentType.CENTER,
    children: [new TextRun({ text, bold: o.bold, size: Math.round((o.size ?? 9) * 2), color: o.color, font: FONT })],
  })
}

interface CellOpts extends TextOpts {
  col: number
  colSpan?: number
  rowSpan?: number
  fill?: string
}

/** 칸 안쪽 좌우 여백 (twip) */
const CELL_PAD = 40

function cell(text: string, o: CellOpts): TableCell {
  const span = o.colSpan ?? 1
  return new TableCell({
    children: [para(text, o)],
    columnSpan: span > 1 ? span : undefined,
    rowSpan: o.rowSpan && o.rowSpan > 1 ? o.rowSpan : undefined,
    width: { size: spanWidth(o.col, span), type: WidthType.DXA },
    verticalAlign: VerticalAlignTable.CENTER,
    shading: o.fill ? shade(o.fill) : undefined,
    margins: { top: 30, bottom: 30, left: CELL_PAD, right: CELL_PAD },
  })
}

/** 이름 글자 크기 (pt): 기본 9pt, 칸보다 길면 한 줄에 들어가게 줄인다 (0.5pt 단위, 가장 작게 5pt) */
function nameSize(name: string, col: number): number {
  // 칸 폭 (twip → pt) − 좌우 여백, 글꼴 차이를 생각해 8% 여유
  const width = ((COLS[col] - CELL_PAD * 2) / 20) * 0.92
  return Math.max(5, Math.floor(fitNameSize(name, width, 9) * 2) / 2)
}

/** 이름 칸 (rowSpan: 목자·총무 칸처럼 세로로 합친 줄 수) */
function nameCell(c: SheetCell | null, col: number, rowSpan = 1): TableCell {
  if (!c) return cell('', { col, rowSpan })
  return cell(c.name, { col, rowSpan, fill: c.status === 'present' ? SERVICE_FILL[c.service ?? 1] : undefined, size: nameSize(c.name, col) })
}

/** 범례 줄: [1부 예배] [2부 예배]  노랑: 1부 예배 / 민트: 2부 예배 · 목장원 30/40명 출석 (출석부에는 1부·2부 인원을 나누지 않는다) */
function legendParagraph(sheet: SheetData): Paragraph {
  const size = 17
  const children: TextRun[] = []
  for (const s of SERVICES) {
    children.push(
      new TextRun({ text: `\u00A0${SERVICE_LABEL[s]} 예배\u00A0`, bold: true, shading: shade(SERVICE_FILL[s]), size, font: FONT }),
      new TextRun({ text: '\u00A0\u00A0', size, font: FONT }),
    )
  }
  const legend = SERVICES.map((s) => `${SERVICE_COLOR_NAME[s]}: ${SERVICE_LABEL[s]} 예배`).join(' / ')
  children.push(
    new TextRun({
      text: `${legend}   ·   목장원 ${sheet.memberPresent}/${sheet.memberTotal}명 출석`,
      size,
      font: FONT,
      color: COLOR.muted,
    }),
  )
  return new Paragraph({ spacing: { before: 120 }, children })
}

function sheetTable(sheet: SheetData): Table {
  const rows: TableRow[] = []
  const rowHeight = { value: 340, rule: HeightRule.ATLEAST }

  // 제목 (엑셀 A2:N3 병합 칸)
  rows.push(
    new TableRow({
      tableHeader: true,
      height: { value: 620, rule: HeightRule.ATLEAST },
      children: [cell(sheet.title, { col: 0, colSpan: 14, fill: COLOR.title, bold: true, size: 15 })],
    }),
  )
  // 머리글
  rows.push(
    new TableRow({
      tableHeader: true,
      height: { value: 400, rule: HeightRule.ATLEAST },
      children: [
        cell('목장명', { col: 0, fill: COLOR.header, bold: true, size: 10 }),
        cell('목자', { col: 1, fill: COLOR.header, bold: true, size: 10 }),
        cell('목 장 가 족', { col: 2, colSpan: 10, fill: COLOR.header, bold: true, size: 10 }),
        cell('총  원', { col: 12, fill: COLOR.header, bold: true, size: 10 }),
        cell('출  석', { col: 13, fill: COLOR.header, bold: true, size: 10 }),
      ],
    }),
  )

  // 목장별 (목장명·총원·출석은 세로로 병합, 목자·총무는 늘 두 칸)
  for (const block of sheet.blocks) {
    const n = block.rows.length
    block.rows.forEach((row, i) => {
      const children: TableCell[] = []
      if (i === 0) children.push(cell(block.group.name, { col: 0, rowSpan: n, bold: true, size: 10 }))
      // 위 칸이 이 줄까지 내려와 있으면 넣지 않는다 (Table 이 이어진 칸을 채운다)
      if (row.lead) children.push(nameCell(row.lead.cell, 1, row.lead.span))
      row.cells.forEach((c, k) => children.push(nameCell(c, 2 + k)))
      if (i === 0) {
        children.push(cell(String(block.total), { col: 12, rowSpan: n, size: 10 }))
        // 출석 칸은 숫자만 (1부·2부는 이름 칸 색으로 구분)
        children.push(cell(String(block.present), { col: 13, rowSpan: n, bold: true, size: 10 }))
      }
      // 한 목장이 두 쪽으로 갈라지지 않게
      rows.push(new TableRow({ children, height: rowHeight, cantSplit: true, keepNext: i < n - 1 }))
    })
  }

  // 새신자 / 방문 / 바나바
  for (const f of sheet.footer) {
    rows.push(
      new TableRow({
        height: rowHeight,
        cantSplit: true,
        children: [
          cell(f.text ? `${f.label} : ${f.text}` : `${f.label} :`, { col: 0, colSpan: 13, align: AlignmentType.LEFT, size: 9 }),
          cell(String(f.count), { col: 13, bold: true, size: 10 }),
        ],
      }),
    )
  }

  // 총 출석 (노란 칸)
  rows.push(
    new TableRow({
      height: { value: 420, rule: HeightRule.ATLEAST },
      cantSplit: true,
      children: [
        cell(`${GRAND_TOTAL_LABEL} ${GRAND_TOTAL_NOTE}`, { col: 0, colSpan: 12, bold: true, size: 10, align: AlignmentType.RIGHT }),
        cell(String(sheet.memberTotal), { col: 12, bold: true, size: 10 }),
        cell(String(sheet.grandTotal), { col: 13, fill: COLOR.grand, bold: true, size: 11 }),
      ],
    }),
  )

  return new Table({
    rows,
    columnWidths: COLS,
    width: { size: spanWidth(0, 14), type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
  })
}

/** 보고 글 한 줄. 1부·2부 줄은 들여 쓰고 예배 색 음영을 넣는다 */
function lineParagraph(l: ReportLine): Paragraph {
  const children = [
    new TextRun({
      text: l.service ? `\u00A0${l.label}\u00A0` : l.label,
      bold: true,
      font: FONT,
      size: 21,
      shading: l.service ? shade(SERVICE_FILL[l.service]) : undefined,
    }),
  ]
  if (l.value !== null) children.push(new TextRun({ text: l.value ? ` : ${l.value}` : ' :', font: FONT, size: 21 }))
  return new Paragraph({ children, spacing: { after: 60, line: 300 }, indent: l.service ? { left: 240 } : undefined })
}

export async function buildDocx(date: ISODate, week: GroupWeek[], totals: WeekTotals, note: WeekNote | undefined): Promise<Blob> {
  const sheet = buildSheet(date, week, totals, note)
  const [, ...summary] = summaryLines(date, totals)

  const reportChildren: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: '목장별 출결 현황', bold: true, size: 32, font: FONT })],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: labelFull(date), size: 21, font: FONT, color: COLOR.muted })],
      spacing: { after: 160 },
    }),
    ...summary.map(
      (s) => new Paragraph({ children: [new TextRun({ text: s, size: 21, font: FONT })], spacing: { after: 40 } }),
    ),
  ]
  for (const gw of week) {
    if (gw.entries.length === 0) continue
    const r = groupReport(date, gw)
    reportChildren.push(
      new Paragraph({
        children: [new TextRun({ text: r.heading, bold: true, size: 23, font: FONT })],
        spacing: { before: 320, after: 100 },
        keepNext: true,
      }),
      ...groupReportLines(r).map(lineParagraph),
    )
  }
  const extras = extraReportLines(note)
  if (extras.length) {
    reportChildren.push(
      new Paragraph({
        children: [new TextRun({ text: '새친구 · 방문 · 바나바', bold: true, size: 23, font: FONT })],
        spacing: { before: 320, after: 100 },
        keepNext: true,
      }),
      ...extras.map(lineParagraph),
    )
  }

  const doc = new Document({
    creator: 'AM청년회 출석부',
    title: sheet.title,
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: A4.width, height: A4.height, orientation: PageOrientation.LANDSCAPE },
            margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
          },
        },
        children: [sheetTable(sheet), legendParagraph(sheet)],
      },
      {
        properties: {
          page: {
            size: { width: A4.width, height: A4.height, orientation: PageOrientation.PORTRAIT },
            margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 },
          },
        },
        children: reportChildren,
      },
    ],
  })

  const blob = await Packer.toBlob(doc)
  return new Blob([blob], { type: MIME.docx })
}

export async function exportDocx(date: ISODate, week: GroupWeek[], totals: WeekTotals, note: WeekNote | undefined): Promise<void> {
  const blob = await buildDocx(date, week, totals, note)
  downloadBlob(blob, reportFileName(date, 'docx'))
}
