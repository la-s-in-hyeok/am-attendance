/**
 * 결석 심방보고 Word(.docx) — 엑셀과 같은 표 (A4 가로)
 * 제목 · 목장 | 타지 | 기타(사유) | 연락두절 | 출석 · 합계, 미확인이 있으면 표 아래에 한 줄
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
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType,
} from 'docx'
import { labelFull } from './dates'
import {
  ABSENCE_CATEGORIES,
  ABSENCE_HEX,
  ABSENCE_LABEL,
  absenceFileName,
  presentOfTotal,
  serviceSplitText,
  uncheckedLine,
  type AbsencePerson,
  type AbsenceReport,
} from './report'
import { A4, COLOR, FONT, MARGIN, shade } from './exportDocx'
import { downloadBlob, MIME } from '../components/report/share'

/** 목장 | 타지 | 기타(사유) | 연락두절 | 출석 (합계 15,700 twip ≒ A4 가로 본문 폭) */
const COLS = [1500, 4300, 5300, 3500, 1100]

type Align = (typeof AlignmentType)[keyof typeof AlignmentType]

function run(text: string, o: { bold?: boolean; size?: number; color?: string } = {}): TextRun {
  return new TextRun({ text, bold: o.bold, size: Math.round((o.size ?? 10) * 2), color: o.color, font: FONT })
}

function cell(children: TextRun[], col: number, o: { fill?: string; align?: Align; colSpan?: number } = {}): TableCell {
  const span = o.colSpan ?? 1
  return new TableCell({
    children: [new Paragraph({ alignment: o.align ?? AlignmentType.CENTER, children, spacing: { line: 276 } })],
    columnSpan: span > 1 ? span : undefined,
    width: { size: COLS.slice(col, col + span).reduce((a, b) => a + b, 0), type: WidthType.DXA },
    verticalAlign: VerticalAlignTable.CENTER,
    shading: o.fill ? shade(o.fill) : undefined,
    margins: { top: 70, bottom: 70, left: 100, right: 100 },
  })
}

/** '최지훈(안산), 정하나' — 메모는 회색으로 */
function peopleRuns(list: AbsencePerson[]): TextRun[] {
  const out: TextRun[] = []
  list.forEach((p, i) => {
    if (i > 0) out.push(run(', '))
    out.push(run(p.name))
    if (p.memo) out.push(run(`(${p.memo})`, { color: COLOR.muted }))
  })
  return out
}

function reportTable(report: AbsenceReport): Table {
  const rows: TableRow[] = []
  const last = COLS.length - 1

  rows.push(
    new TableRow({
      tableHeader: true,
      height: { value: 620, rule: HeightRule.ATLEAST },
      children: [cell([run(report.title, { bold: true, size: 15 })], 0, { colSpan: COLS.length, fill: COLOR.title })],
    }),
  )
  rows.push(
    new TableRow({
      tableHeader: true,
      height: { value: 420, rule: HeightRule.ATLEAST },
      children: [
        cell([run('목장', { bold: true })], 0, { fill: COLOR.header }),
        ...ABSENCE_CATEGORIES.map((c, i) => cell([run(ABSENCE_LABEL[c], { bold: true })], 1 + i, { fill: ABSENCE_HEX[c] })),
        cell([run('출석', { bold: true })], last, { fill: COLOR.header }),
      ],
    }),
  )

  for (const g of report.groups) {
    rows.push(
      new TableRow({
        cantSplit: true,
        height: { value: 480, rule: HeightRule.ATLEAST },
        children: [
          cell([run(g.group.name, { bold: true })], 0),
          ...ABSENCE_CATEGORIES.map((c, i) => cell(peopleRuns(g[c]), 1 + i, { align: AlignmentType.LEFT })),
          cell([run(presentOfTotal(g.summary), { size: 9, color: COLOR.muted })], last),
        ],
      }),
    )
  }
  if (report.groups.length === 0) {
    rows.push(new TableRow({ children: [cell([run('목장원이 없어요')], 0, { colSpan: COLS.length })] }))
  }

  const t = report.totals
  rows.push(
    new TableRow({
      cantSplit: true,
      height: { value: 420, rule: HeightRule.ATLEAST },
      children: [
        cell([run('합계', { bold: true })], 0, { fill: COLOR.title }),
        ...ABSENCE_CATEGORIES.map((c, i) => cell([run(`${t[c]}명`, { bold: true })], 1 + i, { fill: COLOR.title })),
        cell([run(presentOfTotal(t), { bold: true, size: 9 })], last, { fill: COLOR.title }),
      ],
    }),
  )

  return new Table({
    rows,
    columnWidths: COLS,
    width: { size: COLS.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
  })
}

export async function buildAbsenceDocx(report: AbsenceReport): Promise<Blob> {
  const t = report.totals
  const after: Paragraph[] = []
  const unchecked = uncheckedLine(report)
  if (unchecked) {
    after.push(new Paragraph({ spacing: { before: 140 }, children: [run(`* 미확인 : ${unchecked}`, { size: 9, color: COLOR.muted })] }))
  }
  after.push(
    new Paragraph({
      spacing: { before: unchecked ? 60 : 140 },
      children: [
        run(`${labelFull(report.date)} · 목장원 ${t.present}/${t.total}명 출석 (${serviceSplitText(t, '명')})`, {
          size: 9,
          color: COLOR.muted,
        }),
      ],
    }),
  )

  const doc = new Document({
    creator: 'AM청년회 출석부',
    title: report.title,
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: A4.width, height: A4.height, orientation: PageOrientation.LANDSCAPE },
            margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
          },
        },
        children: [reportTable(report), ...after],
      },
    ],
  })

  const blob = await Packer.toBlob(doc)
  return new Blob([blob], { type: MIME.docx })
}

export async function exportAbsenceDocx(report: AbsenceReport): Promise<void> {
  const blob = await buildAbsenceDocx(report)
  downloadBlob(blob, absenceFileName(report.date, 'docx'))
}
