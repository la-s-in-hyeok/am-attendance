import { useStore } from '../store'
import { AttendOverview } from '../components/attend/AttendOverview'
import { GroupDetail } from '../components/attend/GroupDetail'

/** 출석 탭: 목장을 열었으면 그 목장 화면, 아니면 전체 화면 */
export function AttendPage() {
  const groupId = useStore((s) => s.groupId)
  return groupId ? <GroupDetail key={groupId} groupId={groupId} /> : <AttendOverview />
}
