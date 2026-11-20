/** YYYY-MM-DD (항상 주일 날짜) */
export type ISODate = string

/** 출석 상태. 기록이 없으면 '미확인' */
export type Status = 'present' | 'away' | 'nocontact' | 'other'

/** 목장 */
export interface Group {
  id: string
  name: string
  /** 화면·출력 순서 (작을수록 위) */
  order: number
  /** 삭제(보관)된 목장은 더 이상 목록에 나오지 않지만 지난 기록은 남는다 */
  archived: boolean
}

export type Role = 'leader' | 'manager' | null

/** 목장원 */
export interface Member {
  id: string
  name: string
  groupId: string
  /** leader = 목자, manager = 총무 */
  role: Role
  order: number
  /** 이 날짜(주일) 출석부부터 명단에 나온다 */
  joinedOn: ISODate
  /** 이 날짜(주일) 출석부부터 명단에서 빠진다. null 이면 현재 목장원 */
  removedOn: ISODate | null
  /** 메모 (연락처 등 자유) */
  note: string
}

/** 예배 구분: 1부(노랑) / 2부(민트) */
export type Service = 1 | 2

export const SERVICE_LABEL: Record<Service, string> = { 1: '1부', 2: '2부' }

/** 한 주일, 한 사람의 출석 기록 */
export interface AttendanceRecord {
  date: ISODate
  memberId: string
  /** 기록 당시 소속 목장 (목장 이동 후에도 지난 기록이 원래 목장에 남도록) */
  groupId: string
  status: Status
  /** 출석일 때 몇 부 예배인지. 출석이 아니면 null. (값이 없는 옛 기록은 1부로 본다) */
  service?: Service | null
  /** 결석 사유 (기타일 때 필수, 타지·연락두절일 때는 선택 메모) */
  reason: string
  updatedAt: string
}

export interface NamedNote {
  name: string
  /** 인도자, 소속, 메모 등 */
  note: string
}

/** 한 주일의 기타 기록 (엑셀 아래쪽 '새친구 / 방문 / 바나바 현황' 칸) */
export interface WeekNote {
  date: ISODate
  /** 새신자·새친구 (출석 인원에 더해진다) */
  newcomers: NamedNote[]
  /** 방문 (출석 인원에 더해진다) */
  visitors: NamedNote[]
  /** 바나바 현황 자유 기록 */
  barnabas: string
  /** 그 밖의 메모 */
  memo: string
  updatedAt: string
}

export const STATUS_LABEL: Record<Status, string> = {
  present: '출석',
  away: '타지',
  nocontact: '연락두절',
  other: '기타',
}

export const ROLE_LABEL: Record<'leader' | 'manager', string> = {
  leader: '목자',
  manager: '총무',
}

/* ───────────── 목장 출석체크 완료 / 수정 ───────────── */

/** done = 완료 (명단 잠김), editing = 완료 뒤 '수정' 중. 기록이 없으면 아직 완료 전 */
export type GroupDayState = 'done' | 'editing'

/** 한 주일, 한 목장의 완료 상태 */
export interface GroupDay {
  date: ISODate
  groupId: string
  state: GroupDayState
  /** 마지막으로 완료(또는 수정 완료)를 누른 시각 */
  doneAt: string | null
  /** 완료한 뒤 고친(수정 완료) 횟수 */
  editCount: number
  updatedAt: string
}

/** done = 출석체크 완료, edited = 완료 뒤 수정 */
export type NoticeKind = 'done' | 'edited'

/** 다른 기기에 보내는 '완료했어요' 알림 (이름 같은 개인 정보는 없음) */
export interface CompletionNotice {
  kind: NoticeKind
  /** 목장 이름 (받는 쪽은 자기 명단의 이름을 먼저 써요) */
  group: string
  groupId: string
  date: ISODate
  /** 그때의 수정 횟수 (같은 알림을 한 번만 보여 주기 위해) */
  n: number
}

/* ───────────── 청년회 캘린더 ───────────── */

/** 날짜 (YYYY-MM-DD, 아무 요일이나) */
export type DayISO = string

/** 일정 색 (파스텔). 화면 색은 src/components/calendar/colors.ts */
export const EVENT_COLORS = ['pink', 'peach', 'butter', 'mint', 'sky', 'lavender', 'lilac', 'aqua'] as const
export type EventColor = (typeof EVENT_COLORS)[number]

/** 청년회 일정 (하루 종일 일정만. 여러 날이면 startDate ~ endDate, 양 끝 포함) */
export interface CalEvent {
  id: string
  title: string
  startDate: DayISO
  endDate: DayISO
  color: EventColor
  /** 회의록에 글이 있는지 (목록에 📝 표시) */
  hasNote: boolean
  updatedAt: string
}

/** 일정을 저장할 때 보내는 값 (새 일정이면 id 를 새로 만들어서) */
export type CalEventInput = Pick<CalEvent, 'id' | 'title' | 'startDate' | 'endDate' | 'color'>

/** 한 일정의 회의록 */
export interface EventNote {
  /** 에디터(Tiptap) JSON 문서. 아직 아무도 안 썼으면 null */
  doc: unknown | null
  /** 서버에 저장된 판 번호 (충돌 확인용). 아직 없으면 0 */
  version: number
  updatedAt: string | null
}

/** 회의록 저장 결과. 그사이 다른 기기가 먼저 저장했으면 ok:false 와 최신 내용 */
export type SaveNoteResult = { ok: true; version: number; updatedAt: string } | { ok: false; latest: EventNote }

/* ───────────── 목장보고서 (매주 목장마다 PDF 하나) ───────────── */

/**
 * 한 목장이 낸 보고서 (서버에는 변환된 PDF 만 있어요).
 * 낸 보고서는 낸 사람(올린 휴대폰·브라우저)만 열어 볼 수 있어요.
 * 남이 낸 보고서는 '냈다'는 것(쪽수·낸 시각)만 오고, 경로·파일 이름·크기는 서버가 보내지 않아요.
 */
export interface ReportFile {
  groupId: string
  /** 이 기기에서 낸 보고서인지 (true 일 때만 path·fileName·sizeBytes 가 있어요) */
  mine: boolean
  /** 저장소 안 경로 (무작위 이름이라 추측할 수 없어요). 내 보고서만 */
  path?: string
  /** 올린 원래 파일 이름 (예: '사랑목장 보고서.hwp'). 내 보고서만 */
  fileName?: string
  /** 내 보고서만 */
  sizeBytes?: number
  pages: number
  uploadedAt: string
}

/** 한 주일의 목장보고서 */
export interface ReportWeek {
  date: ISODate
  /** 마감한 시각. null 이면 아직 마감 전 */
  closedAt: string | null
  files: ReportFile[]
}
