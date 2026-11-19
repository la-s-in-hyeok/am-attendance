import { useMemo } from 'react'
import type { AttendanceRecord, Member } from '../../lib/types'
import { useStore } from '../../store'
import { useRecordList } from '../../hooks'
import { Section } from './parts'
import { CareList } from './CareList'
import { CARE_MIN_STREAK, careList } from './statsCompute'

/** '관심 필요' 칸: 고른 해와 상관없이 '지금' 기준으로 연속해서 못 나온 분 */
export function CarePanel({
  index,
  cur,
  today,
  onOpen,
}: {
  index: Map<string, AttendanceRecord>
  cur: string
  today: string
  onOpen: (m: Member) => void
}) {
  const groups = useStore((s) => s.groups)
  const members = useStore((s) => s.members)
  const records = useRecordList()

  const care = useMemo(
    () =>
      careList(groups, members, records, index, cur, today === cur).sort(
        (a, b) => b.streak - a.streak || a.member.name.localeCompare(b.member.name, 'ko'),
      ),
    [groups, members, records, index, cur, today],
  )

  return (
    <Section
      className=""
      title={`${CARE_MIN_STREAK}주 이상 연속으로 못 나온 분`}
      right={care.length > 0 ? <span className="tabular text-[15px] font-bold text-ink-3">{care.length}명</span> : undefined}
    >
      <CareList items={care} groups={groups} onOpen={onOpen} />
    </Section>
  )
}
