import type { Group, Member } from './types'
import seed from './seed.json'
import { newId } from './id'

/** 체험 모드 첫 실행 때 넣어 두는 명단: 2026년 10월 11일 엑셀 출석부의 실제 목장·목장원 (체험판에만 들어가고, 서버 연결 배포판에는 빠진다) */
export const SEED_JOINED_ON = '2026-01-04'

interface SeedGroup {
  name: string
  members: { name: string; role: 'leader' | 'manager' | null }[]
}

export function buildSeedRoster(): { groups: Group[]; members: Member[] } {
  const groups: Group[] = []
  const members: Member[] = []
  ;(seed as SeedGroup[]).forEach((g, gi) => {
    const group: Group = { id: newId(), name: g.name, order: gi, archived: false }
    groups.push(group)
    g.members.forEach((m, mi) => {
      members.push({
        id: newId(),
        name: m.name,
        groupId: group.id,
        role: m.role,
        order: mi,
        joinedOn: SEED_JOINED_ON,
        removedOn: null,
        note: '',
      })
    })
  })
  return { groups, members }
}
