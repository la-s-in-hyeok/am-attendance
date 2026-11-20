import type { ISODate } from '../lib/types'

/*
 * 목장보고서 '주인 열쇠' (이 휴대폰·브라우저에서 낸 보고서를 알아보는 무작위 값).
 * - 올릴 때 하나 만들어 이 기기의 localStorage 에만 두고, 서버에는 같이 보내요.
 *   서버는 열쇠 자체가 아니라 그 지문(sha256)만 적어 둬요.
 * - 목록을 받을 때·PDF 를 볼 때·바꾸거나 지울 때 이 열쇠를 보내면, 서버가 '이 기기가 낸 보고서'만 열어 줘요.
 * - 그래서 낸 보고서는 올린 휴대폰(브라우저)에서만 열어 볼 수 있어요. 열쇠를 잃으면(사이트 데이터 지우기 등)
 *   그 보고서는 아무도 열 수 없고, 보고서 담당이 지운 뒤 다시 올리면 돼요.
 * - 키 = `${주일}|${목장 id}`. 400일 지난 열쇠는 정리해요 (서버도 1년 지난 보고서를 정리해요).
 * - localStorage 를 못 쓰는 브라우저(사생활 보호 모드 등)는 메모리에만 둬요 (새로고침하면 사라져요).
 */

const KEY = 'am-attendance:report-owners'
const KEEP_DAYS = 400
const DAY_MS = 86_400_000

type OwnerMap = Record<string, string>

/** localStorage 를 못 쓸 때 쓰는 메모리 보관 (한 번 실패하면 이 탭에서는 계속 여기에 함께 적어요) */
let memory: OwnerMap | null = null

function read(): OwnerMap {
  try {
    const raw = localStorage.getItem(KEY)
    const v = raw ? (JSON.parse(raw) as unknown) : null
    const stored: OwnerMap = {}
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k, s] of Object.entries(v as Record<string, unknown>)) if (typeof s === 'string' && s) stored[k] = s
    }
    return memory ? { ...stored, ...memory } : stored
  } catch {
    return { ...(memory ?? {}) }
  }
}

function write(map: OwnerMap) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    memory = { ...map }
  }
}

function keyOf(date: ISODate, groupId: string) {
  return `${date}|${groupId.toLowerCase()}`
}

/** 'YYYY-MM-DD' 가 오늘부터 KEEP_DAYS 보다 오래됐는지 */
function isOld(date: string, now: number) {
  const t = Date.parse(`${date}T00:00:00Z`)
  return Number.isFinite(t) && now - t > KEEP_DAYS * DAY_MS
}

/** 무작위 32바이트 → base64url (43자) */
function newSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 그 주일에 이 기기가 가진 열쇠들 (목록 받기·PDF 보기에 보내요) */
export function ownersFor(date: ISODate): string[] {
  const prefix = `${date}|`
  return Object.entries(read())
    .filter(([k]) => k.startsWith(prefix))
    .map(([, v]) => v)
}

/** 그 목장 보고서의 열쇠 (없으면 null) */
export function ownerFor(date: ISODate, groupId: string): string | null {
  return read()[keyOf(date, groupId)] ?? null
}

/** 올리기 전에: 있으면 그 열쇠(내가 낸 것을 바꿀 때 같은 열쇠여야 해요), 없으면 새로 만들어 저장해요 */
export function ensureOwner(date: ISODate, groupId: string): string {
  const map = read()
  const key = keyOf(date, groupId)
  const have = map[key]
  if (have) return have
  const now = Date.now()
  for (const k of Object.keys(map)) if (isOld(k.split('|')[0] ?? '', now)) delete map[k]
  const secret = newSecret()
  map[key] = secret
  write(map)
  return secret
}

/** 'reports/2026-11-22/…' → '2026-11-22' (모양이 다르면 null) */
export function dateOfPath(path: string): ISODate | null {
  return /^reports\/(\d{4}-\d{2}-\d{2})\//.exec(path)?.[1] ?? null
}
