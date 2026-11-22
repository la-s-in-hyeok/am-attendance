/**
 * 목장심방 현황 Word(.docx) — 엑셀과 같은 표 (A4 가로)
 * 제목 · 목장 | 출석자 | 결석자 | 기타 (사유) | 총 원 | 총 출석 수 | 총 결석수 · 합계, 미확인이 있으면 표 아래에 한 줄
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
  absenceFileName,
  absentCount,
  serviceSplitText,
  uncheckedLine,
  VISIT_HEADERS,
  visitAbsent,
  visitNames,
  visitReasonParts,
  type AbsenceGroup,
  type AbsenceReport,
} from './report'
import { A4, COLOR, FONT, MARGIN, shade } from './exportDocx'
import { downloadBlob, MIME } from '../components/report/share'

/** 목장 | 출석자 | 결석자 | 기타 (사유) | 총 원 | 총 출석 수 | 총 결석수 (합계 15,700 twip ≒ A4 가로 본문 폭, 원본 엑셀 비율) */
const COLS = [900, 3150, 2850, 5900, 800, 1050, 1050]

/** 원본 엑셀 색: 머리글 파랑 바탕·흰 글자, 목장 칸 연노랑, 총 결석수 주황 글자 */
const HEAD_FILL = '4472C4'
const GROUP_FILL = 'FFFFC4'
const ABSENT_TEXT = 'EB5800'

type Align = (typeof AlignmentType)[keyof typeof AlignmentType]

function run(text: string, o: { bold?: boolean; size?: number; color?: string; breakBefore?: boolean } = {}): TextRun {
  return new TextRun({
    text,
    bold: o.bold,
    size: Math.round((o.size ?? 10) * 2),
    color: o.color,
    font: FONT,
    break: o.breakBefore ? 1 : undefined,
  })
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

/** 기타(사유) 칸: 구분마다 한 줄 ('*타지역 : …'), 사유는 회색 */
function reasonRuns(g: AbsenceGroup): TextRun[] {
  const out: TextRun[] = []
  visitReasonParts(g).forEach((part, i) => {
    out.push(run(`*${part.label} : `, { bold: true, breakBefore: i > 0 }))
    const sep = part.category === 'other' ? ' / ' : ', '
    part.people.forEach((p, j) => {
      if (j > 0) out.push(run(sep))
      out.push(run(p.name))
      if (p.memo) out.push(run(`(${p.memo})`, { color: COLOR.muted }))
    })
  })
  return out
}

function reportTable(report: AbsenceReport): Table {
  const rows: TableRow[] = []

  rows.push(
    new TableRow({
      tableHeader: true,
      height: { value: 760, rule: HeightRule.ATLEAST },
      children: [cell([run(report.title, { bold: true, size: 18 })], 0, { colSpan: COLS.length })],
    }),
  )
  rows.push(
    new TableRow({
      tableHeader: true,
      height: { value: 400, rule: HeightRule.ATLEAST },
      children: VISIT_HEADERS.map((h, i) => cell([run(h, { bold: true, color: 'FFFFFF' })], i, { fill: HEAD_FILL })),
    }),
  )

  for (const g of report.groups) {
    rows.push(
      new TableRow({
        cantSplit: true,
        height: { value: 560, rule: HeightRule.ATLEAST },
        children: [
          cell([run(g.group.name)], 0, { fill: GROUP_FILL }),
          cell([run(visitNames(g.present))], 1, { align: AlignmentType.LEFT }),
          cell([run(visitNames(visitAbsent(g)))], 2, { align: AlignmentType.LEFT }),
          cell(reasonRuns(g), 3, { align: AlignmentType.LEFT }),
          cell([run(String(g.summary.total), { bold: true })], 4),
          cell([run(g.present.length ? String(g.present.length) : '', { bold: true })], 5),
          cell([run(absentCount(g.summary) ? String(absentCount(g.summary)) : '', { bold: true, color: ABSENT_TEXT })], 6),
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
      height: { value: 400, rule: HeightRule.ATLEAST },
      children: [
        cell([run('합계', { bold: true })], 0),
        cell([], 1),
        cell([], 2),
        cell([], 3),
        cell([run(String(t.total), { bold: true })], 4),
        cell([run(String(t.present), { bold: true })], 5),
        cell([run(String(absentCount(t)), { bold: true })], 6),
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
    after.push(
      new Paragraph({ spacing: { before: 140 }, children: [run(`* 미확인 (아직 체크 안 함) : ${unchecked}`, { size: 9, color: COLOR.muted })] }),
    )
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
