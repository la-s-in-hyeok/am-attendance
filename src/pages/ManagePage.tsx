import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { PageHeader, SyncBadge } from '../components/ui'
import { GroupDetail } from '../components/manage/GroupDetail'
import { GroupNameSheet } from '../components/manage/GroupNameSheet'
import { GroupsSection } from '../components/manage/GroupsSection'
import { MemberSheet } from '../components/manage/MemberSheet'
import { RemovedSection } from '../components/manage/RemovedSection'
import { SeedImportCard } from '../components/manage/SeedImportCard'
import { SettingsSection } from '../components/manage/SettingsSection'
import { ViewingDateNotice } from '../components/manage/parts'
import { useBackClose } from '../components/manage/useManage'

/**
 * 관리 탭: 목장·목장원 관리와 설정.
 * 로그인한 사람은 모두 관리자라서 누구나 바꿀 수 있고, 지우는 작업은 항상 한 번 더 확인한다.
 */
export function ManagePage() {
  /** 처음 쓸 때: 쓰는 목장도, 명단에 있는 사람도 없으면 엑셀 명단 불러오기를 보여 준다 */
  const isEmpty = useStore((s) => !s.groups.some((g) => !g.archived) && !s.members.some((m) => m.removedOn === null))

  /** 열어 둔 목장 상세 화면 */
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  /** 이름 찾기에서 고른 목장원 */
  const [memberId, setMemberId] = useState<string | null>(null)
  const [startEmpty, setStartEmpty] = useState(false)

  // 목장 상세는 휴대폰 '뒤로 가기'로도 닫힌다
  const closeDetail = useBackClose(
    openId !== null,
    useCallback(() => setOpenId(null), []),
  )

  // 상세로 들어가면 맨 위로, 돌아오면 보던 자리로
  const listScroll = useRef(0)
  const openDetail = useCallback((id: string) => {
    listScroll.current = window.scrollY
    setOpenId(id)
  }, [])
  useLayoutEffect(() => {
    window.scrollTo(0, openId ? 0 : listScroll.current)
  }, [openId])

  if (openId) return <GroupDetail key={openId} groupId={openId} onBack={closeDetail} />

  // contain-inline-size: 긴 이름·메모가 PC 화면 전체를 밀어 넓히지 않도록
  return (
    <div className="anim-fade contain-inline-size">
      <PageHeader
        title="관리"
        right={<SyncBadge />}
      />

      <ViewingDateNotice className="mb-4" />

      {isEmpty && !startEmpty ? (
        <SeedImportCard
          onStartEmpty={() => {
            setStartEmpty(true)
            setAdding(true)
          }}
        />
      ) : (
        <GroupsSection onOpen={openDetail} onAdd={() => setAdding(true)} onPickMember={setMemberId} />
      )}

      <RemovedSection />
      <SettingsSection />

      {adding && (
        <GroupNameSheet
          onClose={() => setAdding(false)}
          onCreated={(g) => {
            setAdding(false)
            openDetail(g.id)
          }}
        />
      )}
      {memberId && <MemberSheet key={memberId} memberId={memberId} onClose={() => setMemberId(null)} />}
    </div>
  )
}
