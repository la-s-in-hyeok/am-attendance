import { SERVICE_LABEL } from '../../lib/types'
import type { SheetBlock, SheetCell, SheetData } from '../../lib/report'
import { cellStatusText, SERVICES, serviceSplitText } from '../../lib/report'
import { ServiceSwatch } from './ServiceBits'
import { SERVICE_FILL, type SheetVariant } from './serviceStyle'

/**
 * 엑셀 출석부와 같은 모양의 표
 * 목장명 | 목자 | 목장 가족 (10칸) | 총원 | 출석
 * - screen: 앱 화면용 (1부 출석 = 노란 칸, 2부 출석 = 민트 칸, 결석은 상태 색 글씨)
 * - print: 인쇄용 (검은 글씨·검은 테두리, 엑셀과 같은 노랑 FFD700 / 민트 9BE5C8)
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

function cellLook(c: SheetCell, variant: Variant): string {
  if (c.status === 'present') return `${SERVICE_FILL[variant][c.service ?? 1]} font-semibold ${variant === 'screen' ? 'text-ink' : ''}`
  return variant === 'screen' ? SCREEN_STATUS[c.status] : ''
}

function cellTitle(c: SheetCell): string {
  const s = cellStatusText(c)
  return c.reason ? `${c.name} · ${s} (${c.reason})` : `${c.name} · ${s}`
}

/** 출석 칸: 합계 + 그 아래 작게 1부 / 2부 */
function PresentCount({ b, variant }: { b: SheetBlock; variant: Variant }) {
  const screen = variant === 'screen'
  return (
    <>
      <span className={`block ${screen ? 'text-[14px]' : 'text-[10pt]'}`}>{b.present}</span>
      {b.present > 0 && (
        <span className={`mt-0.5 inline-flex flex-col items-start font-semibold ${screen ? 'gap-px text-[12px] text-ink-3' : 'text-[6.6pt] leading-[1.25]'}`}>
          {SERVICES.map((s) => (
            <span key={s} className="inline-flex items-center gap-[3px] whitespace-nowrap">
              <ServiceSwatch
                service={s}
                variant={variant}
                className={screen ? 'h-[7px] w-[7px] rounded-[2px]' : 'h-[1.6mm] w-[1.6mm] outline outline-[0.2mm] outline-black/40'}
              />
              {SERVICE_LABEL[s]} {s === 1 ? b.service1 : b.service2}
            </span>
          ))}
        </span>
      )}
    </>
  )
}

function NameCell({
  c,
  variant,
  onCellClick,
}: {
  c: SheetCell | null
  variant: Variant
  onCellClick?: (c: SheetCell) => void
}) {
  const base = `${CELL[variant]} break-all`
  if (variant === 'print') {
    return <td className={`${base} h-[6.2mm] px-[0.4mm] ${c ? cellLook(c, variant) : ''}`}>{c?.name ?? ''}</td>
  }
  if (!c) return <td className={`${base} h-9`} />
  // 좌우 여백 없이: 좁은 칸(약 46px)에도 '김민규B' 같은 네 글자 이름이 한 줄에 들어가게
  return (
    <td
      className={`${base} h-9 px-0 ${cellLook(c, variant)} ${onCellClick ? 'cursor-pointer' : ''}`}
      title={cellTitle(c)}
      onClick={onCellClick ? () => onCellClick(c) : undefined}
    >
      {c.name}
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
              <NameCell c={row.lead} variant={variant} onCellClick={onCellClick} />
              {row.cells.map((c, k) => (
                <NameCell key={k} c={c} variant={variant} onCellClick={onCellClick} />
              ))}
              {i === 0 && (
                <>
                  <td rowSpan={b.rows.length} className={`${cell} tabular font-semibold ${screen ? 'text-ink-2' : ''}`}>
                    {b.total}
                  </td>
                  <td
                    rowSpan={b.rows.length}
                    className={`${cell} tabular font-extrabold ${screen ? 'px-0' : 'px-0.5'}`}
                    title={`출석 ${b.present}명 (${serviceSplitText(b, '명')})`}
                  >
                    <PresentCount b={b} variant={variant} />
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
              <td className={`${cell} tabular font-bold`}>{f.count ?? ''}</td>
            </tr>
          ))}
          <tr>
            {/* 휴대폰에서는 표가 옆으로 밀려 있으므로 왼쪽 정렬해야 글자가 보인다 */}
            <td colSpan={12} className={`${cell} px-3 font-bold ${screen ? 'h-11 text-left text-[13px] md:text-right' : 'h-[7mm] text-right'}`}>
              총 출석 <span className={screen ? 'font-medium text-ink-3' : 'font-normal'}>(목장원 + 새신자 + 방문)</span>
            </td>
            <td className={`${cell} tabular font-bold ${screen ? 'text-ink-2' : ''}`}>{sheet.memberTotal}</td>
            <td
              className={`${cell} tabular font-extrabold ${screen ? 'bg-bg text-[16px]' : `${PRINT_FILL.grand} text-[11pt]`}`}
              title={`목장원 ${serviceSplitText({ service1: sheet.memberService1, service2: sheet.memberService2 }, '명')} + 새신자·방문`}
            >
              {sheet.grandTotal}
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  )
}
