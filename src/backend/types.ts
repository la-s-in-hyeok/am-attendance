import type { AttendanceRecord, CompletionNotice, Group, GroupDay, ISODate, Member, NoticeKind, WeekNote } from '../lib/types'

export interface Roster {
  groups: Group[]
  members: Member[]
}

/** 어떤 데이터가 바뀌었는지 (다른 기기·다른 탭에서 바뀐 것을 알리는 용도) */
export type ChangeScope = 'roster' | 'attendance' | 'notes' | 'status'

/** complete = 완료 (수정 중이었으면 수정 완료), edit = 완료한 목장을 다시 고치기 시작 */
export type GroupDayAction = 'complete' | 'edit'

export interface GroupDayResult {
  /** 바뀐 뒤 상태. null 이면 완료 전 */
  day: GroupDay | null
  /** 다른 기기에 알릴 내용 (이미 완료돼 있었거나 '수정' 시작이면 null) */
  notify: NoticeKind | null
}

/** 앱을 꺼 두어도 알림 받기 (Web Push) 구독 정보 */
export interface PushSubscriptionInfo {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/**
 * 저장소. 두 가지 구현이 있다.
 * - LocalBackend: 이 브라우저(localStorage)에만 저장하는 체험 모드
 * - SupabaseBackend: 모든 목자·총무가 함께 쓰는 실제 서버
 *
 * 모든 메서드는 로그인한 공용 비밀번호(passcode)로 권한을 확인한다.
 */
export interface Backend {
  readonly mode: 'local' | 'cloud'

  /** 비밀번호가 맞는지 확인. 맞으면 이후 호출에 이 비밀번호를 쓴다 */
  login(passcode: string): Promise<boolean>
  /** 비밀번호 바꾸기 */
  changePasscode(current: string, next: string): Promise<void>

  fetchRoster(): Promise<Roster>
  /** from ~ to (양 끝 포함) 기간의 출석 기록 */
  fetchAttendance(from: ISODate, to: ISODate): Promise<AttendanceRecord[]>
  fetchWeekNotes(from: ISODate, to: ISODate): Promise<WeekNote[]>

  /** 출석 기록 저장 (date+memberId 가 같으면 덮어쓰기) */
  saveAttendance(record: AttendanceRecord): Promise<void>
  /** 출석 기록 지우기 (= 미확인으로 되돌리기) */
  clearAttendance(date: ISODate, memberId: string): Promise<void>
  saveWeekNote(note: WeekNote): Promise<void>

  saveGroup(group: Group): Promise<void>
  /** 여러 목장 순서·정보를 한 번에 저장 */
  saveGroups(groups: Group[]): Promise<void>
  saveMember(member: Member): Promise<void>
  saveMembers(members: Member[]): Promise<void>
  /**
   * 처음 명단 넣기 (엑셀 불러오기). 서버에 목장이 하나라도 있으면 아무것도 하지 않고 'exists'.
   * 두 사람이 동시에 눌러도 한 번만 들어가도록 한 번에(원자적으로) 처리한다.
   */
  importRoster(groups: Group[], members: Member[]): Promise<'done' | 'exists'>
  /**
   * 목장원 완전 삭제 (출석 기록까지). 잘못 입력한 사람을 지울 때만 쓴다.
   * 보통은 removedOn 을 넣어 '명단에서 빼기'를 쓴다.
   */
  purgeMember(memberId: string): Promise<void>

  /** 다른 기기에서 바뀌면 알려 준다. 반환값은 구독 해제 함수 */
  subscribe(onChange: (scope: ChangeScope) => void): () => void

  /* ── 목장 완료 / 수정 ── */

  /** from ~ to (양 끝 포함) 기간의 목장 완료 상태 */
  fetchGroupDays(from: ISODate, to: ISODate): Promise<GroupDay[]>
  /**
   * 완료 / 수정 시작. 같은 주일·목장은 서버에서 하나씩 처리한다.
   * 완료 전 → 완료 (notify 'done'), 수정 중 → 완료 (notify 'edited', 수정 횟수 +1), 완료 → 수정 중 (notify null)
   */
  setGroupDay(date: ISODate, groupId: string, action: GroupDayAction): Promise<GroupDayResult>
  /**
   * 다른 기기에 '완료했어요' 알림 보내기 (실시간 + 설정돼 있으면 Web Push).
   * excludeEndpoint: 이 기기의 Web Push 주소 (내게는 보내지 않도록). 실패해도 오류를 내지 않는다
   */
  sendNotice(notice: CompletionNotice, excludeEndpoint?: string | null): Promise<void>
  /** 다른 기기에서 온 '완료했어요' 알림. 반환값은 구독 해제 함수 */
  onNotice(fn: (notice: CompletionNotice) => void): () => void
  /** Web Push 구독 저장 / 지우기 (체험 모드에서는 아무 일도 안 한다) */
  savePushSubscription(sub: PushSubscriptionInfo): Promise<void>
  deletePushSubscription(endpoint: string): Promise<void>
}
