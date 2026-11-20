import type { DayISO, EventColor } from './types'

/**
 * 처음 한 번만 넣어 두는 2027년 청년회 일정 (2026년 행사표를 요일에 맞춰 2027년 달력으로 옮겼어요).
 * - 체험 모드(LocalBackend)가 첫 fetchEvents 때 넣어요. 필요할 때만 내려받도록 동적 import 로 불러요.
 * - 실제 서버는 supabase/schema.sql 의 'calendar_seeded' 블록이 같은 내용·같은 id 로 넣어요.
 *   여기를 고치면 schema.sql 의 목록도 똑같이 고쳐 주세요.
 * - memo 는 그 일정 회의록의 첫 문단이 돼요. (글자 수는 0 으로 둬서 📝 표시는 누가 실제로 쓴 뒤에만 보여요)
 */
export interface SeedEvent {
  id: string
  title: string
  startDate: DayISO
  endDate: DayISO
  color: EventColor
  memo: string
}

/** 고정 id: 27000000-0000-4000-8000-0000000000NN (NN = 01 ~ 31) */
function seedId(n: number): string {
  return `27000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`
}

const CHOIR = { title: '청년회 오후 성가대', color: 'lavender', memo: '매달 4주째는 청년회 오후 성가대' } as const

type Row = [start: DayISO, end: DayISO, title: string, color: EventColor, memo: string]

const ROWS: Row[] = [
  ['2027-01-02', '2027-01-02', '목장은퇴·목자파송·신입생환영회', 'sky', '토요예배 2부 순서: 목장 은퇴 & 신규 목자 파송 & 신입생 환영회'],
  ['2027-01-14', '2027-01-14', '신입생 OT', 'peach', '신입생 OT'],
  ['2027-01-16', '2027-01-16', '바나바사역자 교육', 'mint', '토요예배 때'],
  ['2027-01-23', '2027-01-23', '전도교육세미나', 'butter', '토요예배 때'],
  ['2027-01-24', '2027-01-24', CHOIR.title, CHOIR.color, CHOIR.memo],
  ['2027-01-30', '2027-01-30', '설날 예배', 'pink', '학생회와 연합예배, 보드게임과 치킨 (2026년에는 설 연휴 전 토요일에 했어요)'],
  ['2027-02-25', '2027-02-27', '청년 수련회', 'aqua', '2027 청년수련회 (2월 25~27일)'],
  ['2027-02-28', '2027-02-28', '청년주일', 'sky', '청년주일'],
  ['2027-02-28', '2027-02-28', CHOIR.title, CHOIR.color, CHOIR.memo],
  ['2027-03-20', '2027-03-20', '볼링대회', 'peach', '토요예배 대체'],
  ['2027-03-28', '2027-03-28', CHOIR.title, CHOIR.color, CHOIR.memo],
  ['2027-04-20', '2027-04-20', '캠퍼스 전도', 'mint', '군산대·간호대'],
  ['2027-04-22', '2027-04-22', '캠퍼스 전도', 'mint', '군산대·간호대'],
  ['2027-04-25', '2027-04-25', CHOIR.title, CHOIR.color, CHOIR.memo],
  ['2027-05-01', '2027-05-01', '목자총무 위로회', 'lilac', '순천'],
  ['2027-05-08', '2027-05-08', '봄봄봄 야외예배', 'butter', '금강하굿둑 (칼국수, 레크리에이션 등)'],
  ['2027-05-15', '2027-05-15', '스승의 날 행사', 'pink', '토요예배 2부 순서 — 목사님께 과일 컵바구니, 전기그릴'],
  ['2027-05-23', '2027-05-23', CHOIR.title, CHOIR.color, CHOIR.memo],
  ['2027-05-29', '2027-05-29', 'M.E.E.T 행사', 'aqua', '원스타임오프'],
  ['2027-06-27', '2027-06-27', CHOIR.title, CHOIR.color, CHOIR.memo],
  ['2027-07-25', '2027-07-25', CHOIR.title, CHOIR.color, CHOIR.memo],
  ['2027-07-26', '2027-07-29', '가족수련회', 'peach', '2026년은 제41회 가족수련회'],
  ['2027-08-07', '2027-08-07', '그레이스 토크쇼', 'lilac', '토요예배 — 2청과 연합, 주교관 카페'],
  ['2027-08-22', '2027-08-22', CHOIR.title, CHOIR.color, CHOIR.memo],
  ['2027-09-26', '2027-09-26', CHOIR.title, CHOIR.color, CHOIR.memo],
  ['2027-10-16', '2027-10-16', '사랑의 연탄봉사 & 목자총무 파송식', 'mint', '사랑의 연탄봉사 & 목자총무 파송식'],
  ['2027-10-23', '2027-10-23', 'P.M 축제', 'butter', 'P.M 축제'],
  ['2027-10-24', '2027-10-24', CHOIR.title, CHOIR.color, CHOIR.memo],
  ['2027-11-21', '2027-11-21', '추수감사절', 'peach', '추수감사절 절기 행사 (셋째 주일)'],
  ['2027-11-28', '2027-11-28', CHOIR.title, CHOIR.color, CHOIR.memo],
  ['2027-12-26', '2027-12-26', CHOIR.title, CHOIR.color, CHOIR.memo],
]

/** 2027년 seed 일정 31개 (행사 19개 + 넷째 주일 성가대 12개) */
export const SEED_EVENTS: readonly SeedEvent[] = ROWS.map(([startDate, endDate, title, color, memo], i) => ({
  id: seedId(i + 1),
  title,
  startDate,
  endDate,
  color,
  memo,
}))

/** 글 한 줄짜리 회의록 문서 (Tiptap JSON). schema.sql 의 seed 와 같은 모양이에요 */
export function seedNoteDoc(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}
