import type { ISODate } from '../../lib/types'
import { labelFull } from '../../lib/dates'
import {
  ABSENCE_CATEGORIES,
  ABSENCE_HEX,
  ABSENCE_LABEL,
  presentOfTotal,
  serviceSplitText,
  uncheckedLine,
  type AbsencePerson,
  type AbsenceReport,
} from '../../lib/report'

/** 열 너비 (%) — 목장 | 타지 | 기타(사유) | 연락두절 | 출석 (엑셀·Word 와 같은 비율) */
const COL_WIDTH = [9.5, 27.5, 34, 21, 8]

const CELL = 'border border-black'

/** '최지훈(안산), 정하나' — 메모는 회색으로 */
function People({ list }: { list: AbsencePerson[] }) {
  return (
    <>
      {list.map((p, i) => (
        <span key={p.memberId}>
          {i > 0 && ', '}
          {p.name}
          {p.memo && <span className="text-[#555]">({p.memo})</span>}
        </span>
      ))}
    </>
  )
}

/** 인쇄용 결석 심방보고 표 (A4 가로) — 엑셀·Word 와 같은 모양 */
export function AbsencePrint({ report, date }: { report: AbsenceReport; date: ISODate }) {
  const t = report.totals
  const unchecked = uncheckedLine(report)
  return (
    <div>
      <table className="w-full table-fixed border-collapse text-[9.5pt] leading-[1.5] text-black">
        <colgroup>
          {COL_WIDTH.map((w, i) => (
            <col key={i} style={{ width: `${w}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th colSpan={5} className={`${CELL} h-[11mm] bg-[#FFE7D8] text-[14pt] font-extrabold`}>
              {report.title}
            </th>
          </tr>
          <tr>
            <th className={`${CELL} h-[7mm] bg-[#FFCEB0] font-bold`}>목장</th>
            {ABSENCE_CATEGORIES.map((c) => (
              <th key={c} className={`${CELL} font-bold`} style={{ background: `#${ABSENCE_HEX[c]}` }}>
                {ABSENCE_LABEL[c]}
              </th>
            ))}
            <th className={`${CELL} bg-[#FFCEB0] font-bold`}>출석</th>
          </tr>
        </thead>
        <tbody>
          {report.groups.map((g) => (
            <tr key={g.group.id} className="print-avoid-break">
              <td className={`${CELL} h-[9mm] px-[1mm] text-center font-bold break-keep [overflow-wrap:anywhere]`}>{g.group.name}</td>
              {ABSENCE_CATEGORIES.map((c) => (
                <td key={c} className={`${CELL} px-[1.8mm] py-[1.3mm] align-middle`}>
                  <People list={g[c]} />
                </td>
              ))}
              <td className={`${CELL} tabular text-center text-[8.5pt] text-[#444]`}>{presentOfTotal(g.summary)}</td>
            </tr>
          ))}
          {/* 합계 (tfoot 은 쪽마다 되풀이되므로 본문 줄로) */}
          <tr className="print-avoid-break bg-[#FFE7D8] font-bold">
            <td className={`${CELL} h-[7mm] text-center`}>합계</td>
            {ABSENCE_CATEGORIES.map((c) => (
              <td key={c} className={`${CELL} tabular text-center`}>
                {t[c]}명
              </td>
            ))}
            <td className={`${CELL} tabular text-center text-[8.5pt]`}>{presentOfTotal(t)}</td>
          </tr>
        </tbody>
      </table>
      {unchecked && <p className="mt-[2mm] text-[8.5pt] text-[#444]">* 미확인 : {unchecked}</p>}
      <div className="mt-[2.5mm] flex items-center justify-between gap-[4mm] text-[8pt] text-[#444]">
        <span>{`목장원 ${t.present}/${t.total}명 출석 (${serviceSplitText(t, '명')})`}</span>
        <span className="shrink-0">{labelFull(date)} · AM청년회 결석 심방보고</span>
      </div>
    </div>
  )
}
