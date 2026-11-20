import type {
  AttendanceRecord,
  CalEvent,
  CalEventInput,
  CompletionNotice,
  EventNote,
  Group,
  GroupDay,
  ISODate,
  Member,
  NoticeKind,
  ReportFile,
  ReportWeek,
  SaveNoteResult,
  WeekNote,
} from '../lib/types'

export interface Roster {
  groups: Group[]
  members: Member[]
}

/** 어떤 데이터가 바뀌었는지 (다른 기기·다른 탭에서 바뀐 것을 알리는 용도) */
export type ChangeScope = 'roster' | 'attendance' | 'notes' | 'status' | 'calendar' | 'reports'

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

  /* ── 청년회 캘린더 ── */

  /** 지우지 않은 일정 전부 (한 해 50개 안팎) */
  fetchEvents(): Promise<CalEvent[]>
  /** 일정 추가·수정 (id 가 같으면 덮어쓰기). 저장된 일정을 돌려줘요 */
  saveEvent(event: CalEventInput): Promise<CalEvent>
  /** 일정 지우기 (회의록도 같이 안 보이게). 30일 안에는 restoreEvent 로 되돌릴 수 있어요 */
  deleteEvent(id: string): Promise<void>
  restoreEvent(id: string): Promise<void>
  /** 회의록 읽기 */
  fetchEventNote(eventId: string): Promise<EventNote>
  /**
   * 회의록 저장. baseVersion = 고치기 시작할 때 받은 판 번호.
   * 서버 판이 그사이 바뀌었으면 저장하지 않고 { ok: false, latest } 를 돌려줘요.
   * force 면 판 번호를 보지 않고 덮어써요 ('내 것으로 저장')
   */
  saveEventNote(eventId: string, doc: unknown, plainLen: number, baseVersion: number, force?: boolean): Promise<SaveNoteResult>

  /* ── 목장보고서 ──
   * 낸 보고서는 낸 사람(올린 휴대폰·브라우저)만 열고·바꾸고·지울 수 있어요 (서버가 확인해요).
   * 이 기기가 낸 것은 이 기기의 '주인 열쇠'(reportOwners.ts)로 알아봐요.
   * 마감·마감 풀기·합친 PDF·남의 보고서 지우기는 '보고서 담당 비밀번호'(adminPin)가 있어야 해요.
   * 담당 비밀번호가 틀리면 오류 code 'bad_pin', 여러 번 틀려 막히면 'pin_locked' (kind 는 'auth' 가 아니라서 로그아웃하지 않아요)
   * 담당 비밀번호가 비어 있으면 'pin_unset' (처음 값은 0000. 서버에서 일부러 비웠을 때만)
   */

  /** 그 주일의 마감 여부와 낸 보고서 목록 (내 것만 mine = true 와 경로·파일 이름) */
  fetchReports(date: ISODate): Promise<ReportWeek>
  /**
   * 보고서(이미 PDF 로 바꾼 것) 올리기. 이 기기가 낸 게 있으면 새것으로 바꾸고 예전 파일은 지워요(지우기 실패는 무시).
   * 마감된 주면 'closed', 다른 사람이 낸 보고서가 있으면 'not_owner'
   */
  uploadReport(date: ISODate, groupId: string, pdf: Uint8Array, fileName: string, pages: number): Promise<ReportFile>
  /**
   * 낸 보고서 지우기 (마감 전만. 마감됐으면 'closed').
   * adminPin 이 없으면 이 기기가 낸 것만 ('not_owner'), 있으면 담당으로 누구 것이든 지워요
   */
  deleteReport(date: ISODate, groupId: string, adminPin?: string): Promise<void>
  /** 합친 PDF 용: 그 주일의 모든 보고서 PDF 받기 (담당만). 못 받은 것은 bytes: null */
  downloadAllReports(date: ISODate, adminPin: string): Promise<{ groupId: string; bytes: Uint8Array | null }[]>
  /**
   * 'PDF 보기'용 주소 (서버: 10분짜리 서명 주소, 체험 모드: blob 주소). 이 기기가 낸 보고서만.
   * downloadName 을 주면 그 이름으로 받기
   */
  reportFileUrl(path: string, downloadName?: string): Promise<string>
  /** 마감하기 (담당만. 이미 마감됐으면 그대로). 마감 시각을 돌려줘요 */
  closeReports(date: ISODate, adminPin: string): Promise<string>
  /** 마감 풀기 (담당만. 실수로 마감했을 때) */
  reopenReports(date: ISODate, adminPin: string): Promise<void>
  /** 보고서 담당 비밀번호가 맞는지만 확인 (틀리면 'bad_pin' / 'pin_locked' / 'pin_unset' 오류) */
  checkReportPin(pin: string): Promise<void>
  /** 보고서 담당 비밀번호를 정했는지 */
  reportPinIsSet(): Promise<boolean>
  /** 보고서 담당 비밀번호 바꾸기 (숫자 4~8자리. 처음 값 0000). 비어 있는 서버에서 처음 정할 때만 current 가 없어도 돼요 */
  changeReportPin(current: string | null, next: string): Promise<void>
}
