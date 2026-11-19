import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useStore } from '../../store'
import type { Group, Member } from '../../lib/types'

/** id → 목장 (보관된 목장 포함) */
export function useGroupMap(): Map<string, Group> {
  const groups = useStore((s) => s.groups)
  return useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups])
}

/** 지금 명단에 있는 사람 / 명단에서 뺀 사람 */
export function useRosterSplit(): { current: Member[]; removed: Member[] } {
  const members = useStore((s) => s.members)
  return useMemo(() => {
    const current: Member[] = []
    const removed: Member[] = []
    for (const m of members) (m.removedOn === null ? current : removed).push(m)
    return { current, removed }
  }, [members])
}

export interface GroupInfo {
  count: number
  leader: string | null
  manager: string | null
}

/** 목장별 현재 인원과 목자·총무 이름 */
export function useGroupInfo(): Map<string, GroupInfo> {
  const members = useStore((s) => s.members)
  return useMemo(() => {
    const map = new Map<string, GroupInfo>()
    for (const m of members) {
      if (m.removedOn !== null) continue
      const cur = map.get(m.groupId) ?? { count: 0, leader: null, manager: null }
      cur.count++
      if (m.role === 'leader' && !cur.leader) cur.leader = m.name
      if (m.role === 'manager' && !cur.manager) cur.manager = m.name
      map.set(m.groupId, cur)
    }
    return map
  }, [members])
}

/**
 * 화면 안의 '상세 화면'을 휴대폰 뒤로 가기로 닫을 수 있게 한다.
 * 반환된 함수로 닫으면 쌓아 둔 기록도 함께 정리한다.
 */
export function useBackClose(active: boolean, onClose: () => void): () => void {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  const pushed = useRef(false)

  useEffect(() => {
    if (!active) return
    history.pushState({ amManage: true }, '')
    pushed.current = true
    const onPop = () => {
      // 이 화면 위에 열린 바텀시트를 닫느라 생긴 '뒤로 가기'는 무시한다
      if (history.state?.amManage) return
      pushed.current = false
      onCloseRef.current()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      // 탭을 바꾸는 등 다른 방법으로 닫혔으면 쌓아 둔 기록을 치운다
      if (pushed.current) {
        pushed.current = false
        if (history.state?.amManage) history.back()
      }
    }
  }, [active])

  return useCallback(() => {
    if (pushed.current) {
      // 뒤로 가기를 하면 popstate 에서 onClose 가 불린다
      pushed.current = false
      history.back()
    } else {
      onCloseRef.current()
    }
  }, [])
}
