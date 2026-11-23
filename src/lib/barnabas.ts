/**
 * 바나바 현황 (교회에 새로 온 사람과 바나바 사역자의 주별 교육)
 *
 * 세는 법 (교회 출석부와 같게)
 * - 교회에 등록한 주가 '출석 1주'. 바나바 사역자에게 교육을 받은 주만큼 '바나바 N주'
 * - 출석과 바나바가 같으면 '김예진-3주', 다르면 '김휘민-출석2주(바나바1주)'
 * - 명단에 있는 사람은 모두 그 주에 온 사람이라, 출석부 '바나바 현황' 줄의 출석 칸 = 명단 인원
 *
 * 저장: 서버 표(week_notes.barnabas 글 칸)를 바꾸지 않고, 그 칸에 버전을 붙인 JSON 글로 넣는다
 *   {"v":1,"people":[{"name":"김휘민","attend":2,"barnabas":1}]}
 * - 예전처럼 손으로 적은 글('김휘민-출석2주, 바나바1주 최하나-3주')도 읽는다 (읽을 수 있으면 명단으로)
 * - 다 읽지 못한 예전 글은 그대로 legacy 로 남겨, 지우기 전까지 입력 화면에 보여 주고 출석부에도 적는다
 */

export interface BarnabasPerson {
  name: string
  /** 출석 N주 (등록한 주 = 1주) */
  attend: number
  /** 바나바 교육 M주 (0 ≤ M ≤ N) */
  barnabas: number
}

export interface BarnabasData {
  people: BarnabasPerson[]
  /** 명단으로 바꾸지 못한 예전 글 (없으면 '') */
  legacy: string
}

/** 저장 형식의 버전 */
const VERSION = 1

/** 출석·바나바 주 수의 최대값 (입력 칸·불러오기에서 넘지 않게) */
export const MAX_WEEKS = 99

export function emptyBarnabas(): BarnabasData {
  return { people: [], legacy: '' }
}

/** 이름 비교용: 띄어쓰기를 다 빼고 소문자로 ('박지환 a' = '박지환A') */
export function nameKey(name: string): string {
  return name.replace(/\s+/g, '').toLowerCase()
}

function toInt(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

/** 숫자를 규칙에 맞춘다: 출석 1~99, 바나바 0~출석 */
export function clampPerson(p: { name: string; attend: unknown; barnabas: unknown }): BarnabasPerson {
  const attend = Math.min(MAX_WEEKS, Math.max(1, toInt(p.attend, 1)))
  const barnabas = Math.min(attend, Math.max(0, toInt(p.barnabas, 0)))
  return { name: p.name, attend, barnabas }
}

/** 저장할 명단: 이름 앞뒤 공백을 없애고, 이름이 빈 줄은 뺀다 */
export function cleanPeople(people: { name: string; attend: unknown; barnabas: unknown }[]): BarnabasPerson[] {
  return people.map((p) => clampPerson({ ...p, name: p.name.trim() })).filter((p) => p.name)
}

/* ───────────── 읽기 ───────────── */

function parseJson(text: string): BarnabasData | null {
  if (!text.startsWith('{')) return null
  try {
    const raw = JSON.parse(text) as unknown
    if (!raw || typeof raw !== 'object') return null
    const o = raw as { v?: unknown; people?: unknown; legacy?: unknown }
    if (o.v !== VERSION || !Array.isArray(o.people)) return null
    const people = cleanPeople(
      o.people
        .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
        .map((p) => ({ name: typeof p.name === 'string' ? p.name : '', attend: p.attend, barnabas: p.barnabas })),
    )
    return { people, legacy: typeof o.legacy === 'string' ? o.legacy.trim() : '' }
  } catch {
    return null
  }
}

/**
 * '출석2주' / '바나바-1주' / '-3주' 한 덩어리 ('양육N주'는 바나바와 같은 뜻으로 읽는다)
 * - 띄어쓰기 자리를 `\s*(?:[-:]\s*)?` 하나로만 두어, 숫자가 없는 긴 공백에서 되짚기가 늘어나지 않게 한다
 */
const MEASURE = /(출석|바나바|양육)?\s*(?:[-:]\s*)?(\d{1,3})\s*주/g
/** 이름과 이름 사이를 나누는 글자 (쉼표·빗금·띄어쓰기·괄호·줄표 등) */
const SEPARATORS = /[\s,，、/·•*;.。()（）[\]\-–—:]+/g
/** 나누는 글자 한 자 (괄호는 따로 센다) */
const SEPARATOR_CHAR = /[\s,，、/·•*;.。\-–—:]/
const OPEN_PAREN = /[(（[]/
const CLOSE_PAREN = /[)）\]]/

/**
 * 이름으로 받을 낱말인지 (모르면 받지 않는다 → 글 전체를 예전 글로 그대로 남긴다)
 * - 한글 2~5자 (+ 동명이인 표시 영문 한 자, 예: '박지환A'), 또는 영문 이름
 * - 숫자가 든 낱말('2026년'), 때를 가리키는 '…주'('이번주'·'다음주'·'둘째주'), 메모에 흔한 낱말('교육')은 이름이 아니다
 *   ('김민주'·'이현주'처럼 '주'로 끝나는 이름은 받는다)
 */
const NAME_SHAPE = /^(?:[가-힣]{2,5}[A-Za-z]?|[A-Za-z][A-Za-z.]*[가-힣]*)$/
const TIME_WORD = /^(?:이번|요번|이|다음|다다음|지난|지지난|저번|전|금|매|첫|막|몇|올|그|[가-힣]*째)주$/
const NOT_NAMES = new Set([
  '출석', '바나바', '현황', '교육', '사역자', '담당', '총', '합계', '인원', '명단', '메모', '참고',
  '예정', '미정', '결석', '참석', '등록', '수료', '완료', '진행', '진행중', '없음', '기타',
  '새친구', '새신자', '방문', '방문자',
  // 교회에서 메모에 흔히 쓰는 낱말 ('김휘민 3주 말씀 2주'의 '말씀'을 사람으로 읽지 않게)
  '양육', '말씀', '훈련', '교제', '심방', '새가족', '정착', '예배', '성경', '제자', '교회', '주일', '목장', '수련회',
])
function looksLikeName(word: string): boolean {
  return NAME_SHAPE.test(word) && !TIME_WORD.test(word) && !NOT_NAMES.has(word)
}

/**
 * 숫자 덩어리 사이의 글에서 괄호 밖 글만 꺼낸다 (depth: 이 글 앞까지 열린 괄호 수)
 * - 괄호 안에는 '(바나바1주)'처럼 앞사람의 숫자만 온다. 괄호 안에 다른 글이 있으면 null
 *   ('홍길동-3주 (교육 2주)'의 '교육'을 사람으로 지어내지 않게)
 */
function outsideParens(raw: string, depth: number): { text: string; depth: number } | null {
  let text = ''
  for (const ch of raw) {
    if (OPEN_PAREN.test(ch)) depth++
    else if (CLOSE_PAREN.test(ch)) depth = Math.max(0, depth - 1)
    else if (depth === 0) text += ch
    else if (!SEPARATOR_CHAR.test(ch)) return null
  }
  return { text, depth }
}

/**
 * 손으로 적은 예전 글을 명단으로 (다 읽지 못하면 null)
 * 읽는 모양: '김휘민-출석2주(바나바1주)', '김휘민-출석2주, 바나바1주', '최하나-3주', '최하나 3주차',
 *           '한소망(출석4주차, 바나바-1주차)' — 사람 사이는 쉼표·띄어쓰기·빗금으로 나뉘어도 된다
 * - 숫자가 하나뿐이면 출석과 바나바가 같은 것으로 본다 ('최하나-3주' = 출석 3주, 바나바 3주)
 * - 이름인지 확실하지 않은 낱말이 하나라도 있으면 null (사람을 지어내 인원에 더하지 않게)
 */
export function parseLegacyBarnabas(text: string): BarnabasPerson[] | null {
  const s = text
    // 공백·줄바꿈을 먼저 한 칸으로 줄인다 (긴 공백에서도 아래 정규식이 바로 끝나게)
    .replace(/\s+/g, ' ')
    .replace(/주차/g, '주')
    // 출석부 줄을 통째로 붙여 넣었을 때의 머리말
    .replace(/^ ?\*? ?바나바 ?현황 ?[-:]? ?/, '')
  type Draft = { name: string; measures: { label: '출석' | '바나바' | null; n: number }[] }
  const drafts: Draft[] = []
  let last = 0
  let depth = 0
  for (const m of s.matchAll(MEASURE)) {
    const outside = outsideParens(s.slice(last, m.index), depth)
    if (!outside) return null
    depth = outside.depth
    const between = outside.text.replace(SEPARATORS, ' ').trim()
    last = m.index + m[0].length
    const word = m[1] as '출석' | '바나바' | '양육' | undefined
    const measure = { label: word === '양육' ? ('바나바' as const) : (word ?? null), n: Number(m[2]) }
    if (between) {
      // 이름은 괄호 밖의 한 낱말 (괄호 안 글은 outsideParens 에서 이미 걸렀다)
      // '홍 길동'처럼 띄어 쓴 글이나 이름 모양이 아닌 낱말은 이름인지 알 수 없어서 읽지 않는다
      if (/\s/.test(between) || !looksLikeName(between)) return null
      drafts.push({ name: between, measures: [measure] })
    } else {
      const cur = drafts[drafts.length - 1]
      if (!cur) return null
      cur.measures.push(measure)
    }
  }
  // 마지막 숫자 뒤에 남은 글이 있으면 다 읽지 못한 것
  if (s.slice(last).replace(SEPARATORS, '').trim()) return null
  if (drafts.length === 0) return null

  const out: BarnabasPerson[] = []
  for (const d of drafts) {
    let attend: number | null = null
    let barnabas: number | null = null
    if (d.measures.length > 2) return null
    for (const [i, m] of d.measures.entries()) {
      // 이름표가 없는 숫자: 하나뿐이면 둘 다, 둘이면 앞이 출석·뒤가 바나바
      const label = m.label ?? (d.measures.length === 1 ? null : i === 0 ? '출석' : '바나바')
      if (label === null) {
        attend = m.n
        barnabas = m.n
      } else if (label === '출석') {
        if (attend !== null) return null
        attend = m.n
      } else {
        if (barnabas !== null) return null
        barnabas = m.n
      }
    }
    attend ??= barnabas
    barnabas ??= attend
    if (attend === null || barnabas === null) return null
    if (attend < 1 || attend > MAX_WEEKS || barnabas < 0 || barnabas > attend) return null
    out.push({ name: d.name, attend, barnabas })
  }
  return out
}

/**
 * 저장된 글을 읽는다.
 * - JSON(v1) → 명단 (+ 남겨 둔 예전 글)
 * - 예전 글 → 다 읽히면 명단, 아니면 글 그대로 legacy
 */
export function parseBarnabas(text: string | null | undefined): BarnabasData {
  const t = (text ?? '').trim()
  if (!t) return emptyBarnabas()
  const json = parseJson(t)
  if (json) return json
  const people = parseLegacyBarnabas(t)
  return people ? { people, legacy: '' } : { people: [], legacy: t }
}

/* ───────────── 저장 ───────────── */

/**
 * 저장할 글 (week_notes.barnabas 에 그대로 들어간다)
 * - 아무것도 없으면 ''
 * - 예전 글만 있으면 예전 글 그대로 (이전 버전 앱에서도 그대로 보이게)
 * - 명단이 있으면 {"v":1,"people":[…]} (예전 글이 남아 있으면 "legacy" 도)
 */
export function stringifyBarnabas(d: BarnabasData): string {
  const people = cleanPeople(d.people)
  const legacy = d.legacy.trim()
  if (people.length === 0) return legacy
  const body: { v: number; people: BarnabasPerson[]; legacy?: string } = {
    v: VERSION,
    people: people.map((p) => ({ name: p.name, attend: p.attend, barnabas: p.barnabas })),
  }
  if (legacy) body.legacy = legacy
  return JSON.stringify(body)
}

/** 같은 내용이면 같은 글이 되게 (예전 글과 그것을 읽은 JSON 을 같은 것으로 본다) */
export function normalizeBarnabas(text: string | null | undefined): string {
  return stringifyBarnabas(parseBarnabas(text))
}

/* ───────────── 보여 주기·세기 ───────────── */

/** '김예진-3주' (출석 = 바나바) / '김휘민-출석2주(바나바1주)' */
export function barnabasEntryText(p: BarnabasPerson): string {
  return p.attend === p.barnabas ? `${p.name}-${p.attend}주` : `${p.name}-출석${p.attend}주(바나바${p.barnabas}주)`
}

/** 출석부·보고 글의 한 줄: '김예진-3주, 김휘민-출석2주(바나바1주)' (+ 남겨 둔 예전 글) */
export function barnabasLineText(d: BarnabasData): string {
  const parts = cleanPeople(d.people).map(barnabasEntryText)
  if (d.legacy.trim()) parts.push(d.legacy.trim())
  return parts.join(', ')
}

/** 바나바 명단 인원 (= 그 주 출석에 더하는 인원. 같은 이름은 한 번만, 남겨 둔 예전 글은 세지 않는다) */
export function barnabasCount(d: BarnabasData): number {
  return barnabasNameKeys(d).size
}

/** 바나바 명단에 있는 이름들 (새신자와 겹치는지 볼 때) */
export function barnabasNameKeys(d: BarnabasData): Set<string> {
  return new Set(cleanPeople(d.people).map((p) => nameKey(p.name)))
}

/** 지난주 명단으로 이번 주 명단 만들기: 출석 +1, 바나바는 그대로 (교육을 받은 사람만 바나바를 올리면 된다) */
export function nextWeekPeople(prev: BarnabasPerson[]): BarnabasPerson[] {
  return cleanPeople(prev).map((p) => clampPerson({ name: p.name, attend: p.attend + 1, barnabas: p.barnabas }))
}
