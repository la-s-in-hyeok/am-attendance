/**
 * 엑셀 출석부 명단과 앱 명단을 똑같이 맞추는 계획 (화면·서버와 상관없는 순수 계산).
 *
 * - 목장: 이름이 같은 목장은 그대로 쓰고(삭제한 목장이면 되살림), 없으면 새로 만들고, 엑셀에 없는 목장은 삭제(보관)해요.
 *   순서도 엑셀 순서대로 바꿔요.
 * - 목장원: 이름이 같은 사람은 그대로 쓰면서(지난 출석 기록이 이어지게) 목장·목자/총무·순서만 엑셀대로 바꿔요.
 *   '박지환' → '박지환A' 처럼 뒤의 구분 글자만 달라진 사람은 이름만 바꾼 것으로 봐요.
 *   엑셀에 새로 나온 사람은 넣고, 엑셀에 없는 사람은 명단에서 빼요 (지난 기록은 남아요).
 * - 적용 주일(from)부터 바뀌어요. 그 전 출석부는 그대로예요.
 */
import type { AttendanceRecord, Group, ISODate, Member, Role } from './types'
import type { ParsedGroup } from './excelRoster'
import { addDays } from './dates'

/** 이름 비교용: 띄어쓰기를 없애고 영문은 소문자로 */
export function normName(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase()
}

/** 뒤에 붙은 구분 글자(A, B, 2 …)를 뗀 이름. 김철수A → 김철수 */
export function baseName(s: string): string {
  const n = normName(s)
  const b = n.replace(/[a-z0-9]+$/, '')
  return b.length >= 2 ? b : n
}

export interface SyncMove {
  member: Member
  fromGroup: string
  toGroup: string
}

export interface SyncRename {
  member: Member
  newName: string
}

export interface SyncRole {
  member: Member
  group: string
  from: Role
  to: Role
}

export interface RosterSyncPlan {
  from: ISODate
  /** 저장할 목장 (새로 만들기·되살리기·순서 바꾸기). 삭제할 목장은 archive 에 따로 */
  groups: Group[]
  /** 엑셀에 없어서 삭제(보관)할 목장 */
  archive: Group[]
  /** 저장할 목장원 (새로 넣기·옮기기·이름/역할/순서 바꾸기·빼기) */
  members: Member[]
  /** 새 목장으로 옮길 출석 기록 (적용 주일과 그 뒤) */
  records: AttendanceRecord[]
  // 미리보기용
  newGroups: string[]
  revivedGroups: string[]
  added: { name: string; group: string }[]
  removed: { name: string; group: string }[]
  /** 명단에서 빠졌거나 빠지기로 했는데 엑셀에 있어서 다시 넣는 사람 */
  revived: { name: string; group: string }[]
  moved: SyncMove[]
  renamed: SyncRename[]
  roles: SyncRole[]
  /** 맞춘 뒤 목장 수·사람 수 */
  groupCount: number
  memberCount: number
  /** 바꿀 것이 하나도 없으면 true */
  same: boolean
}

const ROLE_LABEL: Record<'leader' | 'manager', string> = { leader: '목자', manager: '총무' }
export function roleLabel(r: Role): string {
  return r ? ROLE_LABEL[r] : '목장원'
}

/**
 * 명단에서 빼는 날짜 (이 주일 출석부부터 빠진다). lib/roster.ts 의 removalDate 와 같은 규칙인데, 적용 주일을 직접 받아요.
 * 적용 주일이나 그 뒤에 이미 기록이 있으면 마지막 기록 다음 주일부터 빠져요 (기록이 숨겨지지 않게)
 */
function removalFrom(memberId: string, records: AttendanceRecord[], from: ISODate): ISODate {
  let latest: ISODate | null = null
  for (const r of records) if (r.memberId === memberId && (latest === null || r.date > latest)) latest = r.date
  return latest !== null && latest >= from ? addDays(latest, 7) : from
}

/** 지금 명단에 있는 사람인지 (적용 주일에 명단에 나오는 사람) */
function activeAt(m: Member, from: ISODate): boolean {
  return m.removedOn === null || m.removedOn > from
}

export function planRosterSync(
  parsed: ParsedGroup[],
  groups: Group[],
  members: Member[],
  records: AttendanceRecord[],
  from: ISODate,
  makeId: () => string,
  now: Date = new Date(),
): RosterSyncPlan {
  const groupName = new Map(groups.map((g) => [g.id, g.name]))

  /* ── 목장 ── */
  const usedGroupIds = new Set<string>()
  const targetGroups: Group[] = [] // 엑셀 순서
  const newGroups: string[] = []
  const revivedGroups: string[] = []
  const groupsToSave: Group[] = []
  parsed.forEach((pg, i) => {
    const n = normName(pg.name)
    const candidates = groups.filter((g) => !usedGroupIds.has(g.id) && normName(g.name) === n)
    const existing = candidates.find((g) => !g.archived) ?? candidates[0]
    let g: Group
    if (existing) {
      g = { ...existing, name: pg.name, order: i, archived: false }
      if (existing.archived) revivedGroups.push(pg.name)
      if (existing.archived || existing.order !== i || existing.name !== pg.name) groupsToSave.push(g)
    } else {
      g = { id: makeId(), name: pg.name, order: i, archived: false }
      newGroups.push(pg.name)
      groupsToSave.push(g)
    }
    usedGroupIds.add(g.id)
    groupName.set(g.id, g.name)
    targetGroups.push(g)
  })
  const archive = groups
    .filter((g) => !g.archived && !usedGroupIds.has(g.id))
    .map((g, i) => ({ ...g, archived: true, order: parsed.length + i }))

  /* ── 목장원 짝 맞추기 ── */
  type Want = { name: string; role: Role; group: Group; order: number; match: Member | null }
  const wants: Want[] = []
  targetGroups.forEach((g, gi) => parsed[gi].members.forEach((pm, mi) => wants.push({ name: pm.name, role: pm.role, group: g, order: mi, match: null })))

  const active = members.filter((m) => activeAt(m, from))
  const taken = new Set<string>()
  const pick = (w: Want, list: Member[]) => {
    const free = list.filter((m) => !taken.has(m.id))
    if (free.length === 0) return
    const m = free.find((x) => x.groupId === w.group.id) ?? free[0]
    w.match = m
    taken.add(m.id)
  }
  // 1) 이름도 목장도 같은 사람 (동명이인이 엑셀 순서 때문에 다른 목장 사람과 짝지어지지 않게, 이것부터 모두 맞춰요)
  for (const w of wants) pick(w, active.filter((m) => m.groupId === w.group.id && normName(m.name) === normName(w.name)))
  // 2) 이름이 같은 사람 (다른 목장에서 옮겨 온 사람)
  for (const w of wants) if (!w.match) pick(w, active.filter((m) => normName(m.name) === normName(w.name)))
  // 3) 구분 글자를 붙이거나 뗀 사람 (박지환 → 박지환A). 같은 목장 안에서 짝이 하나뿐일 때만.
  //    김철수A → 김철수B 처럼 둘 다 구분 글자가 있으면 다른 사람이에요
  const hasSuffix = (s: string) => baseName(s) !== normName(s)
  for (const w of wants) {
    if (w.match) continue
    const b = baseName(w.name)
    const sameBase = wants.filter((x) => !x.match && x.group.id === w.group.id && baseName(x.name) === b)
    const cand = active.filter(
      (m) => !taken.has(m.id) && m.groupId === w.group.id && baseName(m.name) === b && hasSuffix(m.name) !== hasSuffix(w.name),
    )
    if (sameBase.length === 1 && cand.length === 1) {
      w.match = cand[0]
      taken.add(cand[0].id)
    }
  }
  // 4) 그래도 없으면, 적용 주일부터 빠지기로 한 사람(빠지는 기간이 없는 사람)은 되살려서 이어 써요
  for (const w of wants) {
    if (w.match) continue
    pick(
      w,
      members.filter((m) => m.removedOn === from && normName(m.name) === normName(w.name)),
    )
  }

  /* ── 바뀌는 것 모으기 ── */
  const membersToSave: Member[] = []
  const added: RosterSyncPlan['added'] = []
  const moved: SyncMove[] = []
  const renamed: SyncRename[] = []
  const roles: SyncRole[] = []
  const revived: RosterSyncPlan['revived'] = []
  /** 짝이 맞은 사람 → 엑셀의 목장 (적용 주일 뒤 기록을 그 목장으로 맞춰요. 다시 해도 남은 기록이 잡히게 모든 사람을 봐요) */
  const targetOf = new Map<string, string>()
  for (const w of wants) {
    const m = w.match
    if (!m) {
      membersToSave.push({ id: makeId(), name: w.name, groupId: w.group.id, role: w.role, order: w.order, joinedOn: from, removedOn: null, note: '' })
      added.push({ name: w.name, group: w.group.name })
      continue
    }
    const next: Member = { ...m, name: w.name, groupId: w.group.id, role: w.role, order: w.order, removedOn: null }
    targetOf.set(m.id, w.group.id)
    if (m.groupId !== w.group.id) moved.push({ member: m, fromGroup: groupName.get(m.groupId) ?? '', toGroup: w.group.name })
    if (m.removedOn !== null) revived.push({ name: w.name, group: w.group.name })
    if (m.name !== w.name) renamed.push({ member: m, newName: w.name })
    if (m.role !== w.role) roles.push({ member: m, group: w.group.name, from: m.role, to: w.role })
    if (
      m.groupId !== next.groupId ||
      m.name !== next.name ||
      m.role !== next.role ||
      m.order !== next.order ||
      m.removedOn !== next.removedOn
    )
      membersToSave.push(next)
  }
  const removed: RosterSyncPlan['removed'] = []
  for (const m of active) {
    if (taken.has(m.id)) continue
    membersToSave.push({ ...m, removedOn: removalFrom(m.id, records, from), role: null })
    removed.push({ name: m.name, group: groupName.get(m.groupId) ?? '' })
  }

  // 적용 주일과 그 뒤 기록은 엑셀의 목장으로 (그 전 기록은 원래 목장에 남아요)
  const recordsToSave: AttendanceRecord[] = []
  for (const r of records) {
    const to = targetOf.get(r.memberId)
    if (to && r.date >= from && r.groupId !== to) recordsToSave.push({ ...r, groupId: to, updatedAt: now.toISOString() })
  }

  return {
    from,
    groups: groupsToSave,
    archive,
    members: membersToSave,
    records: recordsToSave,
    newGroups,
    revivedGroups,
    added,
    removed,
    revived,
    moved,
    renamed,
    roles,
    groupCount: targetGroups.length,
    memberCount: wants.length,
    same: groupsToSave.length === 0 && archive.length === 0 && membersToSave.length === 0 && recordsToSave.length === 0,
  }
}
