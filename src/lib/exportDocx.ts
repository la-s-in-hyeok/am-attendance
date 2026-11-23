/**
 * Word(.docx) 출석부 만들기
 * - 1쪽(A4 가로): 엑셀과 같은 모양의 출석부 표 (1부 출석 = 노랑 FFD700, 2부 출석 = 민트 9BE5C8) + 범례
 * - 2쪽부터(A4 세로): 목장별 출결 현황 (단톡방 보고 글 형식, 온 사람은 1부·2부로 나눠서)
 *
 * 이 파일은 화면에서 동적으로 불러온다 (docx 라이브러리가 커서 따로 나뉜다).
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeightRule,
  LineRuleType,
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
  VerticalMergeType,
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
  nameWidthEm,
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
  type SheetBlock,
  type SheetCell,
  type SheetData,
} from './report'
import { downloadBlob, MIME } from '../components/report/share'

export const FONT = '맑은 고딕'

/** 문서 기본 글자 크기 (half-point, 10pt) */
const DEFAULT_SIZE = 20

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

/**
 * 칸 안 문단 줄 높이 = 글자 크기 × 1.3
 * (맑은 고딕은 기본 줄 간격이 글자의 1.73배라 10pt 한 줄이 이름 줄 17pt 를 넘는다. 줄 높이를 딱 정해 칸 안에 들어가게 한다)
 */
const LINE_RATIO = 1.3

function para(text: string, o: TextOpts = {}): Paragraph {
  const size = o.size ?? 9
  return new Paragraph({
    alignment: o.align ?? AlignmentType.CENTER,
    spacing: { before: 0, after: 0, line: Math.round(size * 20 * LINE_RATIO), lineRule: LineRuleType.EXACT },
    children: [new TextRun({ text, bold: o.bold, size: Math.round(size * 2), color: o.color, font: FONT })],
  })
}

interface CellOpts extends TextOpts {
  col: number
  colSpan?: number
  fill?: string
}

/** 칸 안쪽 좌우 여백 (twip) */
const CELL_PAD = 40

function cell(text: string, o: CellOpts): TableCell {
  const span = o.colSpan ?? 1
  return new TableCell({
    children: [para(text, o)],
    columnSpan: span > 1 ? span : undefined,
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

/** 목장 이름 줄 하나의 높이 (twip) */
const ROW_HEIGHT = 340

/** 칸 테두리 (0.5pt = 10twip) / 세로로 이어진 칸 안쪽은 선 없음 */
const LINE = { style: BorderStyle.SINGLE, size: 4, color: 'auto' }
/** 선 굵기를 twip 으로 (테두리 size 는 1/8pt 단위) */
const LINE_TWIP = (LINE.size / 8) * 20
const NO_LINE = { style: BorderStyle.NIL, size: 0, color: 'auto' }

function fillOf(c: SheetCell | null): string | undefined {
  return c?.status === 'present' ? SERVICE_FILL[c.service ?? 1] : undefined
}

interface RunCellOpts extends TextOpts {
  fill?: string
  vAlign?: (typeof VerticalAlignTable)[keyof typeof VerticalAlignTable]
  /** 위·아래 테두리 (기본: 첫 칸 위, 끝 칸 아래만) */
  top?: boolean
  bottom?: boolean
}

/**
 * 세로로 count 줄을 합친 칸의 i번째 조각 (count = 1 이면 보통 칸)
 * 글은 첫 조각에만 쓰고, 색은 모든 조각에 칠한다. 아이폰 미리보기(Quick Look)는 세로 병합을 몰라서
 * 조각마다 따로 그리는데, 그래도 색이 이어져 보이게 하려는 것
 */
function runCell(text: string, col: number, i: number, count: number, o: RunCellOpts = {}): TableCell {
  const first = i === 0
  return new TableCell({
    children: [first ? para(text, o) : para('', { size: 1 })],
    verticalMerge: count > 1 ? (first ? VerticalMergeType.RESTART : VerticalMergeType.CONTINUE) : undefined,
    width: { size: COLS[col], type: WidthType.DXA },
    verticalAlign: o.vAlign ?? VerticalAlignTable.CENTER,
    shading: o.fill ? shade(o.fill) : undefined,
    margins: { top: 0, bottom: 0, left: CELL_PAD, right: CELL_PAD },
    borders: {
      top: (o.top ?? first) ? LINE : NO_LINE,
      bottom: (o.bottom ?? i === count - 1) ? LINE : NO_LINE,
      left: LINE,
      right: LINE,
    },
  })
}

/** 목장 가족 이름 칸 (C~L열) */
function nameCell(c: SheetCell | null, col: number): TableCell {
  const fill = fillOf(c)
  return new TableCell({
    children: [para(c?.name ?? '', { size: c ? nameSize(c.name, col) : 9 })],
    width: { size: COLS[col], type: WidthType.DXA },
    verticalAlign: VerticalAlignTable.CENTER,
    shading: fill ? shade(fill) : undefined,
    margins: { top: 0, bottom: 0, left: CELL_PAD, right: CELL_PAD },
  })
}

/**
 * 반쪽 문단의 공백 글자 크기 (half-point, 6pt). 줄 간격을 무시하는 Quick Look 에서도 반 줄 높이를 넘지 않게 작게 둔다
 * (브라우저 뷰어 docx-preview 는 이 줄만 몇 px 길어지고, 두 반쪽 차이는 1~2px 안쪽이다)
 */
const HALF_MARK_SIZE = 12

/**
 * 반쪽 문단 줄 간격 (twip). Word 는 칸 위 테두리를 없애도 줄 위에 테두리 몫(0.5pt)을 비워 두고 문단을 시작하므로
 * 줄 높이 340 = 위 테두리 몫 10 + 반 160 + 가운데 선 10 + 반 160
 */
const HALF_LINE = Math.floor((ROW_HEIGHT - 2 * LINE_TWIP) / 2) // w:line 은 정수만 받는다 (ROW_HEIGHT 를 바꾸면 340 − 20 이 짝수인지 확인)

/**
 * 홀수 줄 목장의 가운데 줄 B칸: 위 반 = 목자, 아래 반 = 총무
 * 반 줄 높이 문단 두 개에 각자 색을 칠하고, 위 문단 아래 테두리로 가운데 선을 긋는다
 * 줄 위 테두리 몫(0.5pt)은 문단 색이 덮지 못해서, 목자가 출석이면 그 자리에 목자 색 선을 그어 흰 줄이 생기지 않게 한다
 * (윗줄 칸의 아래 테두리는 없음이라, 맞닿은 두 테두리 중 이 색 선이 그려진다)
 * Quick Look 은 문단 색을 그리지 않아, 두 반쪽 색이 다르면 이 칸이 흰 바탕에 가운데 선만 보인다 (나눈 위치는 그대로 5:5)
 */
function splitLeadCell(leader: SheetCell | null, manager: SheetCell | null): TableCell {
  const half = (c: SheetCell | null, divider: boolean) => {
    const fill = fillOf(c)
    return new Paragraph({
      spacing: { before: 0, after: 0, line: HALF_LINE, lineRule: LineRuleType.EXACT },
      shading: fill ? shade(fill) : undefined,
      border: divider ? { bottom: { ...LINE, space: 0 } } : undefined,
      run: { size: HALF_MARK_SIZE },
      // 빈 문단은 Quick Look 이 높이 0 으로 그려서 가운데 선이 칸 맨 위로 올라간다. 보이지 않는 공백 한 칸으로 반 줄 높이를 지킨다
      children: [new TextRun({ text: '\u00A0', size: HALF_MARK_SIZE, font: FONT })],
    })
  }
  // Word 는 문단 색이 칸을 다 덮어 칸 색이 보이지 않는다. 문단 색을 못 그리는 Quick Look 을 위해 두 반쪽 색이 같을 때만 칸에도 칠한다
  const leaderFill = fillOf(leader)
  const same = leaderFill === fillOf(manager) ? leaderFill : undefined
  return new TableCell({
    children: [half(leader, true), half(manager, false)],
    width: { size: COLS[1], type: WidthType.DXA },
    verticalAlign: VerticalAlignTable.TOP,
    shading: same ? shade(same) : undefined,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    borders: { top: leaderFill ? { ...LINE, color: leaderFill } : NO_LINE, bottom: NO_LINE, left: LINE, right: LINE },
  })
}

/**
 * B열 i번째 줄 칸. 목자(위)·총무(아래) 두 칸, 높이 5:5
 * - 짝수 줄(2k): 위 k줄 = 목자, 아래 k줄 = 총무 (세로 병합)
 * - 홀수 줄(2k+1): 위 k줄 = 목자, 가운데 줄은 반씩 나누고, 아래 k줄 = 총무.
 *   이름은 반쪽 가운데에 가깝게: 한 줄짜리면 가운데 줄 쪽으로 붙인다
 */
function leadCell(block: SheetBlock, i: number): TableCell {
  const n = block.rows.length
  const k = Math.floor(n / 2)
  const odd = n % 2 === 1
  if (odd && i === k) return splitLeadCell(block.leader, block.manager)
  const top = i < k
  const c = top ? block.leader : block.manager
  const j = top ? i : i - (odd ? k + 1 : k)
  const look = { fill: fillOf(c), size: c ? nameSize(c.name, 1) : 9 }
  if (!odd) return runCell(c?.name ?? '', 1, j, k, look)
  return runCell(c?.name ?? '', 1, j, k, {
    ...look,
    vAlign: k === 1 ? (top ? VerticalAlignTable.BOTTOM : VerticalAlignTable.TOP) : VerticalAlignTable.CENTER,
    // 가운데 줄과 맞닿은 쪽은 같은 사람 칸이라 선을 긋지 않는다
    top: top && j === 0,
    bottom: !top && j === k - 1,
  })
}

/** 목장명 글자 크기 (pt): 10pt 에서 시작해, 줄 바꿈까지 생각해 목장 높이에 들어갈 때까지 줄인다 */
function groupNameSize(name: string, rowCount: number): number {
  const width = ((COLS[0] - CELL_PAD * 2) / 20) * 0.92
  const height = (rowCount * ROW_HEIGHT) / 20 - 1
  for (let size = 10; size > 6; size -= 0.5) {
    const lines = Math.ceil((nameWidthEm(name) * size) / width)
    if (lines * size * LINE_RATIO <= height) return size
  }
  return 6
}

function sheetTable(sheet: SheetData): Table {
  const rows: TableRow[] = []
  const rowHeight = { value: ROW_HEIGHT, rule: HeightRule.ATLEAST }

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

  // 목장별: 이름 줄마다 표 한 줄. 목장명·총원·출석 칸은 세로로 합치고, B열은 목자·총무 두 칸 5:5 (leadCell)
  // 줄 높이 EXACT = 반쪽 높이를 고정한다. cantSplit + keepNext = 목장 하나가 쪽 사이에서 갈리지 않는다
  for (const block of sheet.blocks) {
    const n = block.rows.length
    const groupSize = groupNameSize(block.group.name, n)
    block.rows.forEach((row, i) => {
      rows.push(
        new TableRow({
          height: { value: ROW_HEIGHT, rule: HeightRule.EXACT },
          cantSplit: true,
          keepNext: i < n - 1,
          children: [
            runCell(block.group.name, 0, i, n, { bold: true, size: groupSize }),
            leadCell(block, i),
            ...row.cells.map((c, k) => nameCell(c, 2 + k)),
            runCell(String(block.total), 12, i, n, { size: 10 }),
            // 출석 칸은 숫자만 (1부·2부는 이름 칸 색으로 구분)
            runCell(String(block.present), 13, i, n, { bold: true, size: 10 }),
          ],
        }),
      )
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
    styles: { default: { document: { run: { font: FONT, size: DEFAULT_SIZE } } } },
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
