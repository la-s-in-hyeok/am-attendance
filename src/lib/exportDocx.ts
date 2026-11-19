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
  groupReport,
  groupReportLines,
  reportFileName,
  SERVICE_COLOR_NAME,
  SERVICE_HEX,
  SERVICES,
  serviceSplitText,
  summaryLines,
  type ReportLine,
  type SheetBlock,
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
  /** 첫 문단 아래에 더 붙일 문단 (예: 출석 칸의 1부·2부) */
  extra?: Paragraph[]
}

function cell(text: string, o: CellOpts): TableCell {
  const span = o.colSpan ?? 1
  return new TableCell({
    children: [para(text, o), ...(o.extra ?? [])],
    columnSpan: span > 1 ? span : undefined,
    rowSpan: o.rowSpan && o.rowSpan > 1 ? o.rowSpan : undefined,
    width: { size: spanWidth(o.col, span), type: WidthType.DXA },
    verticalAlign: VerticalAlignTable.CENTER,
    shading: o.fill ? shade(o.fill) : undefined,
    margins: { top: 30, bottom: 30, left: 40, right: 40 },
  })
}

function nameCell(c: SheetCell | null, col: number): TableCell {
  if (!c) return cell('', { col })
  return cell(c.name, { col, fill: c.status === 'present' ? SERVICE_FILL[c.service ?? 1] : undefined, size: 9 })
}

/** 예배 색 네모 + 글 (예: '■ 1부 7') — 네모는 음영 넣은 빈칸 */
function swatchRuns(s: Service, text: string, size: number): TextRun[] {
  return [
    new TextRun({ text: '\u00A0\u00A0', shading: shade(SERVICE_FILL[s]), size: Math.round(size * 2), font: FONT }),
    new TextRun({ text: `\u00A0${text}`, size: Math.round(size * 2), font: FONT, color: COLOR.muted }),
  ]
}

/** 출석 칸: 합계 아래에 작게 '1부 7' / '2부 5' */
function presentCell(block: SheetBlock, rowSpan: number): TableCell {
  const extra =
    block.present > 0
      ? SERVICES.map(
          (s) =>
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: swatchRuns(s, `${SERVICE_LABEL[s]} ${s === 1 ? block.service1 : block.service2}`, 6.5),
            }),
        )
      : []
  return cell(String(block.present), { col: 13, rowSpan, bold: true, size: 10, extra })
}

/** 범례 줄: [1부 예배] [2부 예배]  노랑: 1부 예배 / 민트: 2부 예배 · 목장원 30/40명 출석 (1부 18명 · 2부 12명) */
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
  const split = serviceSplitText({ service1: sheet.memberService1, service2: sheet.memberService2 }, '명')
  children.push(
    new TextRun({
      text: `${legend}   ·   목장원 ${sheet.memberPresent}/${sheet.memberTotal}명 출석 (${split})`,
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

  // 목장별 (목장명·총원·출석은 세로로 병합)
  for (const block of sheet.blocks) {
    const n = block.rows.length
    block.rows.forEach((row, i) => {
      const children: TableCell[] = []
      if (i === 0) children.push(cell(block.group.name, { col: 0, rowSpan: n, bold: true, size: 10 }))
      children.push(nameCell(row.lead, 1))
      row.cells.forEach((c, k) => children.push(nameCell(c, 2 + k)))
      if (i === 0) {
        children.push(cell(String(block.total), { col: 12, rowSpan: n, size: 10 }))
        children.push(presentCell(block, n))
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
          cell(f.count === null ? '' : String(f.count), { col: 13, bold: true, size: 10 }),
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
        cell('총 출석 (목장원 + 새신자 + 방문)', { col: 0, colSpan: 12, bold: true, size: 10, align: AlignmentType.RIGHT }),
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
