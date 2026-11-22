import type { ISODate } from '../../lib/types'
import { labelFull } from '../../lib/dates'
import {
  absentCount,
  serviceSplitText,
  uncheckedLine,
  VISIT_HEADERS,
  visitAbsent,
  visitNames,
  visitReasonParts,
  type AbsenceGroup,
  type AbsenceReport,
} from '../../lib/report'

/** 열 너비 (%) — 목장 | 출석자 | 결석자 | 기타 (사유) | 총 원 | 총 출석 수 | 총 결석수 (엑셀·Word 와 같은 비율) */
const COL_WIDTH = [5.8, 20, 18.2, 37.6, 5.1, 6.7, 6.6]

const CELL = 'border border-black'

/** 기타(사유) 칸: 구분마다 한 줄 ('*타지역 : …'), 사유는 회색 */
function Reasons({ g }: { g: AbsenceGroup }) {
  return (
    <>
      {visitReasonParts(g).map((part) => (
        <div key={part.category}>
          <b>*{part.label} : </b>
          {part.people.map((p, i) => (
            <span key={p.memberId}>
              {i > 0 && (part.category === 'other' ? ' / ' : ', ')}
              {p.name}
              {p.memo && <span className="text-[#555]">({p.memo})</span>}
            </span>
          ))}
        </div>
      ))}
    </>
  )
}

/** 인쇄용 목장심방 현황 표 (A4 가로) — 엑셀·Word 와 같은 모양 */
export function AbsencePrint({ report, date }: { report: AbsenceReport; date: ISODate }) {
  const t = report.totals
  const unchecked = uncheckedLine(report)
  return (
    <div>
      <table className="w-full table-fixed border-collapse text-[9pt] leading-[1.5] text-black">
        <colgroup>
          {COL_WIDTH.map((w, i) => (
            <col key={i} style={{ width: `${w}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th colSpan={VISIT_HEADERS.length} className="h-[14mm] text-[17pt] font-extrabold">
              {report.title}
            </th>
          </tr>
          <tr>
            {VISIT_HEADERS.map((h) => (
              <th key={h} className={`${CELL} h-[7mm] bg-[#4472C4] px-[0.5mm] font-bold text-white break-keep`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.groups.map((g) => {
            const absent = absentCount(g.summary)
            return (
              <tr key={g.group.id} className="print-avoid-break">
                <td className={`${CELL} h-[9mm] bg-[#FFFFC4] px-[1mm] text-center break-keep [overflow-wrap:anywhere]`}>{g.group.name}</td>
                <td className={`${CELL} px-[1.8mm] py-[1.3mm] align-middle`}>{visitNames(g.present)}</td>
                <td className={`${CELL} px-[1.8mm] py-[1.3mm] align-middle`}>{visitNames(visitAbsent(g))}</td>
                <td className={`${CELL} px-[1.8mm] py-[1.3mm] align-middle`}>
                  <Reasons g={g} />
                </td>
                <td className={`${CELL} tabular text-center font-bold`}>{g.summary.total}</td>
                <td className={`${CELL} tabular text-center font-bold`}>{g.present.length || ''}</td>
                <td className={`${CELL} tabular text-center font-bold text-[#EB5800]`}>{absent || ''}</td>
              </tr>
            )
          })}
          {/* 합계 (tfoot 은 쪽마다 되풀이되므로 본문 줄로) */}
          <tr className="print-avoid-break font-bold">
            <td className={`${CELL} h-[7mm] text-center`}>합계</td>
            <td className={CELL} />
            <td className={CELL} />
            <td className={CELL} />
            <td className={`${CELL} tabular text-center`}>{t.total}</td>
            <td className={`${CELL} tabular text-center`}>{t.present}</td>
            <td className={`${CELL} tabular text-center`}>{absentCount(t)}</td>
          </tr>
        </tbody>
      </table>
      {unchecked && <p className="mt-[2mm] text-[8.5pt] text-[#444]">* 미확인 (아직 체크 안 함) : {unchecked}</p>}
      <div className="mt-[2.5mm] flex items-center justify-between gap-[4mm] text-[8pt] text-[#444]">
        <span>{`목장원 ${t.present}/${t.total}명 출석 (${serviceSplitText(t, '명')})`}</span>
        <span className="shrink-0">{labelFull(date)} · AM청년회 목장심방 현황</span>
      </div>
    </div>
  )
}
