import type { Group, ReportFile } from '../../lib/types'
import { StateIcon } from '../report/StatusGrid'

/**
 * 목장 칸: 번호판처럼 휴대폰 3칸(아주 좁으면 2칸), 넓으면 4·5칸.
 * 낸 목장 = 초록 ✓ '제출', 안 낸 목장 = 빨강 ! '미제출'. 누르면 그 목장 창을 열어요
 */
export function ReportTiles({
  groups,
  fileOf,
  onOpen,
}: {
  groups: Group[]
  fileOf: (groupId: string) => ReportFile | undefined
  onOpen: (groupId: string) => void
}) {
  return (
    <div className="@container">
      <ul className="grid grid-cols-2 gap-2 @min-[19rem]:grid-cols-3 @md:grid-cols-4 @2xl:grid-cols-5 md:gap-3">
        {groups.map((g) => (
          <li key={g.id} className="flex min-w-0">
            <Tile group={g} file={fileOf(g.id)} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function Tile({ group, file, onOpen }: { group: Group; file: ReportFile | undefined; onOpen: (groupId: string) => void }) {
  const done = !!file
  const label = done ? '제출' : '미제출'
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={`${group.name} 목장 ${label}${file?.pages ? `, ${file.pages}쪽` : ''}`}
      onClick={() => onOpen(group.id)}
      className={`flex min-h-[88px] w-full min-w-0 flex-col items-stretch justify-between gap-1.5 rounded-2xl border-[1.5px] px-2 py-2.5 text-left transition active:scale-[0.98] min-[375px]:px-2.5 sm:px-3 ${
        done ? 'border-ok-line bg-ok-soft hover:border-ok/50' : 'border-danger-line bg-danger-soft hover:border-danger/50'
      }`}
    >
      {/* 긴 목장 이름은 줄여 쓰지 않고 줄을 바꾼다 */}
      <span className="text-[15px] leading-tight font-bold break-keep text-ink [overflow-wrap:anywhere]">{group.name}</span>
      <span className="flex flex-wrap items-center justify-between gap-x-1.5 gap-y-0.5">
        <span className={`inline-flex items-center gap-1 text-[13px] leading-snug font-bold ${done ? 'text-ok' : 'text-danger'}`}>
          <StateIcon done={done} />
          {label}
        </span>
        {file && file.pages > 0 && <span className="tabular text-[12px] leading-snug font-medium text-ink-2">{file.pages}쪽</span>}
      </span>
    </button>
  )
}
