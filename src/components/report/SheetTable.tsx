import type { CSSProperties } from 'react'
import type { SheetBlock, SheetCell, SheetData } from '../../lib/report'
import { cellStatusText, GRAND_TOTAL_LABEL, GRAND_TOTAL_NOTE, leadSplit, nameWidthEm } from '../../lib/report'
import { SERVICE_FILL, type SheetVariant } from './serviceStyle'

/**
 * 엑셀 출석부와 같은 모양의 표
 * 목장명 | 목자 | 목장 가족 (10칸) | 총원 | 출석
 * - screen: 앱 화면용 (1부 출석 = 노란 칸, 2부 출석 = 민트 칸, 결석은 상태 색 글씨)
 * - print: 인쇄용 (검은 글씨·검은 테두리, 엑셀과 같은 노랑 FFD700 / 민트 9BE5C8)
 * - 목자 칸(B열)은 목장마다 늘 두 칸: 위 = 목자, 아래 = 총무 (줄이 몇 줄이든 높이 5:5)
 */

type Variant = SheetVariant

/** 열 너비 (%) — 목장명, 목자, 이름 10칸, 총원, 출석 */
const COL_WIDTH = [9, 7.4, ...Array<number>(10).fill(7), 6.8, 6.8]

const CELL: Record<Variant, string> = {
  screen: 'border-r border-b border-line',
  print: 'border border-black',
}

/** 인쇄 색 (엑셀 원본과 같은 값) */
const PRINT_FILL = {
  title: 'bg-[#FFE7D8]',
  header: 'bg-[#FFCEB0]',
  grand: 'bg-[#FFFF00]',
}

const SCREEN_STATUS: Record<Exclude<SheetCell['status'], 'present'>, string> = {
  away: 'bg-away-soft/70 text-away-ink',
  nocontact: 'bg-nocontact-soft/80 text-nocontact-ink',
  other: 'bg-other-soft/70 text-other-ink',
  unchecked: 'text-ink-3',
}

/**
 * 이름 글자 크기: 기본 크기, 그리고 칸 폭을 잴 수 없을 때 쓰는 가장 좁은 이름 칸 폭
 * - screen: 표 최소 폭 700px − 여백 40px 의 7% ≈ 46px
 * - print: A4 가로 본문 277mm 의 7% ≈ 19.3mm − 좌우 여백 0.8mm
 */
const NAME_SIZE: Record<Variant, { base: string; minBox: string }> = {
  screen: { base: '13px', minBox: '46px' },
  print: { base: '8.6pt', minBox: '18.4mm' },
}

function cellLook(c: SheetCell, variant: Variant): string {
  if (c.status === 'present') return `${SERVICE_FILL[variant][c.service ?? 1]} font-semibold ${variant === 'screen' ? 'text-ink' : ''}`
  return variant === 'screen' ? SCREEN_STATUS[c.status] : ''
}

function cellTitle(c: SheetCell): string {
  const s = cellStatusText(c)
  return c.reason ? `${c.name} · ${s} (${c.reason})` : `${c.name} · ${s}`
}

/** 이름: 줄을 바꾸지 않고, 칸보다 길면 칸 폭에 맞춰 글자를 줄인다 (index.css .sheet-name) */
function NameText({ name, variant }: { name: string; variant: Variant }) {
  const size = NAME_SIZE[variant]
  // 글꼴마다 폭이 조금씩 달라서 6% 여유를 둔다
  const style = { '--name-em': (nameWidthEm(name) * 1.06).toFixed(3), '--name-base': size.base, '--name-min-box': size.minBox } as CSSProperties
  return (
    <span className="sheet-name-box block">
      <span className="sheet-name" style={style}>
        {name}
      </span>
    </span>
  )
}

function NameCell({
  c,
  variant,
  rowSpan = 1,
  onCellClick,
}: {
  c: SheetCell | null
  variant: Variant
  /** 세로로 합친 줄 수 (줄 수가 짝수인 목장의 목자·총무 칸) */
  rowSpan?: number
  onCellClick?: (c: SheetCell) => void
}) {
  const base = CELL[variant]
  const span = rowSpan > 1 ? rowSpan : undefined
  if (variant === 'print') {
    // 줄 높이는 짝수 px (22px ≈ 5.8mm). mm 로 주면 PDF 로 바꿀 때 줄마다 23px·24px 로 달리 반올림돼 목자·총무 칸이 1px 어긋난다
    // 홀수 줄 목장의 합친 칸 안쪽 = n×22 − 위아래 테두리 반씩(1) − 가운데 선(1) = 짝수 → 반쪽이 정수 px 로 딱 나뉜다
    return (
      <td rowSpan={span} className={`${base} h-[22px] px-[0.4mm] ${c ? cellLook(c, variant) : ''}`}>
        {c && <NameText name={c.name} variant={variant} />}
      </td>
    )
  }
  if (!c) return <td rowSpan={span} className={`${base} h-9`} />
  // 좌우 여백 없이: 좁은 칸(약 46px)에도 '김민규B' 같은 네 글자 이름이 한 줄에 들어가게 (그래도 길면 글자를 줄인다)
  return (
    <td
      rowSpan={span}
      className={`${base} h-9 px-0 ${cellLook(c, variant)} ${onCellClick ? 'cursor-pointer' : ''}`}
      title={cellTitle(c)}
      onClick={onCellClick ? () => onCellClick(c) : undefined}
    >
      <NameText name={c.name} variant={variant} />
    </td>
  )
}

/** 목자 칸(B열) 위아래 반쪽 하나 */
function LeadHalf({ c, variant, onCellClick }: { c: SheetCell | null; variant: Variant; onCellClick?: (c: SheetCell) => void }) {
  const pad = variant === 'screen' ? 'px-0' : 'px-[0.4mm]'
  const click = variant === 'screen' && c && onCellClick ? () => onCellClick(c) : undefined
  return (
    <div
      className={`flex min-h-0 min-w-0 flex-col justify-center ${pad} ${c ? cellLook(c, variant) : ''} ${click ? 'cursor-pointer' : ''}`}
      title={variant === 'screen' && c ? cellTitle(c) : undefined}
      onClick={click}
    >
      {c && <NameText name={c.name} variant={variant} />}
    </div>
  )
}

/**
 * 목자 칸(B열) 중 i번째 줄에서 시작하는 칸. 위 = 목자, 아래 = 총무, 높이는 늘 5:5
 * - 줄 수가 짝수(2·4줄): 예전처럼 칸 두 개가 줄을 절반씩 (가운데 선이 옆 이름 칸 줄선과 딱 맞는다)
 * - 홀수(3·5줄): 목장 줄 전체를 합친 칸 하나를 안에서 위아래 반반으로 나눈다 (칸 높이는 같은 줄 이름 칸들이 정한다)
 */
function LeadCellAt({
  block,
  i,
  variant,
  onCellClick,
}: {
  block: SheetBlock
  i: number
  variant: Variant
  onCellClick?: (c: SheetCell) => void
}) {
  const n = block.rows.length
  const { sub, span } = leadSplit(n)
  if (sub === 1) {
    if (i === 0) return <NameCell c={block.leader} rowSpan={span} variant={variant} onCellClick={onCellClick} />
    if (i === span) return <NameCell c={block.manager} rowSpan={span} variant={variant} onCellClick={onCellClick} />
    return null
  }
  if (i !== 0) return null
  return (
    <td rowSpan={n} className={`${CELL[variant]} relative p-0`}>
      {/* 가운데 선도 1px 짜리 자기 줄을 가져야 위아래 두 칸 높이가 정확히 같다 */}
      <div className="absolute inset-0 grid grid-rows-[1fr_1px_1fr]">
        <LeadHalf c={block.leader} variant={variant} onCellClick={onCellClick} />
        <div className={variant === 'screen' ? 'bg-line' : 'bg-black'} />
        <LeadHalf c={block.manager} variant={variant} onCellClick={onCellClick} />
      </div>
    </td>
  )
}

export function SheetTable({
  sheet,
  blocks = sheet.blocks,
  variant,
  title,
  showFooter = true,
  onCellClick,
}: {
  sheet: SheetData
  /** 일부 목장만 (목장별 인쇄) */
  blocks?: SheetBlock[]
  variant: Variant
  /** 표 맨 위 제목 줄 (인쇄용). 없으면 제목 줄을 그리지 않는다 */
  title?: string
  /** 새신자·방문·바나바·총 출석 줄 */
  showFooter?: boolean
  onCellClick?: (c: SheetCell) => void
}) {
  const screen = variant === 'screen'
  const cell = CELL[variant]
  // 화면용 최소 폭은 감싸는 쪽(SheetPanel)이 정한다
  const table = screen
    ? 'w-full table-fixed border-separate border-spacing-0 border-l border-t border-line text-center text-[13px] leading-tight'
    : 'w-full table-fixed border-collapse text-center text-[8.6pt] leading-tight text-black'
  const th = screen ? `${cell} h-9 bg-bg px-1 text-[13px] font-bold text-ink-2` : `${cell} ${PRINT_FILL.header} h-[7mm] font-bold`
  const sticky = screen ? 'sticky left-0 z-[1] bg-surface' : ''

  return (
    <table className={table}>
      <colgroup>
        {COL_WIDTH.map((w, i) => (
          <col key={i} style={{ width: `${w}%` }} />
        ))}
      </colgroup>
      <thead>
        {title && (
          <tr>
            <th colSpan={14} className={screen ? `${cell} h-12 text-[16px] font-extrabold` : `${cell} ${PRINT_FILL.title} h-[11mm] text-[14pt] font-extrabold`}>
              {title}
            </th>
          </tr>
        )}
        <tr>
          <th className={`${th} ${screen ? 'sticky left-0 z-[2]' : ''}`}>목장명</th>
          <th className={th}>목자</th>
          <th className={th} colSpan={10}>
            목 장 가 족
          </th>
          <th className={th}>총원</th>
          <th className={th}>출석</th>
        </tr>
      </thead>

      {blocks.map((b) => (
        <tbody key={b.group.id} className={screen ? '' : 'print-avoid-break'}>
          {b.rows.map((row, i) => (
            <tr key={i}>
              {i === 0 && (
                <td
                  rowSpan={b.rows.length}
                  className={`${cell} ${sticky} px-1 font-bold break-keep [overflow-wrap:anywhere] ${screen ? 'text-[13px] text-ink' : 'text-[9.5pt]'}`}
                >
                  {b.group.name}
                </td>
              )}
              {/* 목자·총무 칸: 위 칸이 이 줄까지 내려와 있으면 그리지 않는다 */}
              <LeadCellAt block={b} i={i} variant={variant} onCellClick={onCellClick} />
              {row.cells.map((c, k) => (
                <NameCell key={k} c={c} variant={variant} onCellClick={onCellClick} />
              ))}
              {i === 0 && (
                <>
                  <td rowSpan={b.rows.length} className={`${cell} tabular font-semibold ${screen ? 'text-ink-2' : ''}`}>
                    {b.total}
                  </td>
                  {/* 출석 칸은 숫자만 (1부·2부는 이름 칸 색으로 구분) */}
                  <td
                    rowSpan={b.rows.length}
                    className={`${cell} tabular font-extrabold ${screen ? 'px-0 text-[14px]' : 'px-0.5 text-[10pt]'}`}
                    title={screen ? `출석 ${b.present}명` : undefined}
                  >
                    {b.present}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      ))}

      {showFooter && (
        <tfoot>
          {sheet.footer.map((f) => (
            <tr key={f.key}>
              <td colSpan={13} className={`${cell} px-2 text-left ${screen ? 'h-10 text-[13px] text-ink-2' : 'h-[6.5mm]'}`}>
                <span className={screen ? 'font-semibold text-ink' : 'font-semibold'}>{f.label} :</span>
                {f.text ? ` ${f.text}` : ''}
              </td>
              <td className={`${cell} tabular font-bold`} title={screen && f.hint ? f.hint : undefined}>
                {f.count}
              </td>
            </tr>
          ))}
          <tr>
            {/* 휴대폰에서는 표가 옆으로 밀려 있으므로 왼쪽 정렬해야 글자가 보인다 */}
            <td colSpan={12} className={`${cell} px-3 font-bold ${screen ? 'h-11 text-left text-[13px] md:text-right' : 'h-[7mm] text-right'}`}>
              {GRAND_TOTAL_LABEL} <span className={screen ? 'font-medium text-ink-3' : 'font-normal'}>{GRAND_TOTAL_NOTE}</span>
            </td>
            <td className={`${cell} tabular font-bold ${screen ? 'text-ink-2' : ''}`}>{sheet.memberTotal}</td>
            <td
              className={`${cell} tabular font-extrabold ${screen ? 'bg-bg text-[16px]' : `${PRINT_FILL.grand} text-[11pt]`}`}
              title={screen ? `목장원 ${sheet.memberPresent}명 + 새신자·방문·바나바` : undefined}
            >
              {sheet.grandTotal}
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  )
}
