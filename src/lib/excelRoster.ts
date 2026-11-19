/**
 * 엑셀 출석부 파일(.xlsx)에서 목장·명단을 읽는다.
 *
 * 한컴오피스로 저장한 파일은 일반 엑셀 라이브러리(exceljs 등)가 열지 못해서,
 * 압축을 직접 풀고 XML 을 읽는다. 기대하는 시트 모양(지금 쓰는 출석부와 같다):
 *   A열 = 목장명 (여러 줄 병합) / B열 = 첫 줄 목자, 둘째 줄 총무 / C~L열 = 목장 가족
 *   '목장명' 머리글 줄 아래부터, 완전히 빈 줄이나 '*' 로 시작하는 줄(새친구·방문 등) 전까지
 */
import type JSZipType from 'jszip'

export interface ParsedGroup {
  name: string
  members: { name: string; role: 'leader' | 'manager' | null }[]
}

export interface ParsedSheet {
  name: string
  groups: ParsedGroup[]
  memberCount: number
}

const COLS = 'ABCDEFGHIJKL'

function byLocal(el: Element | Document, local: string): Element[] {
  return Array.from(el.getElementsByTagNameNS('*', local))
}

function textOf(el: Element): string {
  return byLocal(el, 't')
    .map((t) => t.textContent ?? '')
    .join('')
}

function colOf(ref: string): string {
  return ref.replace(/[0-9]/g, '')
}

function rowOf(ref: string): number {
  return Number(ref.replace(/[A-Z]/gi, ''))
}

/** 이름 칸 정리: 공백·줄바꿈 제거. 비었으면 '' */
function cleanCell(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

async function readXml(zip: JSZipType, path: string): Promise<Document | null> {
  const f = zip.file(path) ?? zip.file(path.replace(/^\//, ''))
  if (!f) return null
  const text = await f.async('string')
  return new DOMParser().parseFromString(text, 'application/xml')
}

/** 파일 안의 모든 시트를 읽어 목장 명단으로 만든다 (명단이 있는 시트만) */
export async function parseRosterWorkbook(file: Blob): Promise<ParsedSheet[]> {
  const { default: JSZip } = await import('jszip')
  // Blob 을 바로 넘기면 일부 브라우저에서 읽지 못해서 ArrayBuffer 로 넘긴다
  const zip = await JSZip.loadAsync(await file.arrayBuffer())

  const wb = await readXml(zip, 'xl/workbook.xml')
  if (!wb) throw new Error('엑셀(.xlsx) 파일이 아니에요')
  const rels = await readXml(zip, 'xl/_rels/workbook.xml.rels')
  const relMap = new Map<string, string>()
  if (rels) for (const r of byLocal(rels, 'Relationship')) relMap.set(r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '')

  const ssDoc = await readXml(zip, 'xl/sharedStrings.xml')
  const shared = ssDoc ? byLocal(ssDoc, 'si').map(textOf) : []

  const out: ParsedSheet[] = []
  for (const s of byLocal(wb, 'sheet')) {
    const name = s.getAttribute('name') ?? ''
    const rid =
      s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? s.getAttribute('r:id') ?? ''
    let target = relMap.get(rid) ?? ''
    if (!target) continue
    target = target.startsWith('/') ? target.slice(1) : `xl/${target}`
    const doc = await readXml(zip, target)
    if (!doc) continue

    // 행 → { 열: 값 }
    const rows = new Map<number, Record<string, string>>()
    for (const c of byLocal(doc, 'c')) {
      const ref = c.getAttribute('r') ?? ''
      const col = colOf(ref)
      if (!COLS.includes(col) || col.length !== 1) continue
      const t = c.getAttribute('t')
      let v = ''
      if (t === 'inlineStr') v = textOf(c)
      else {
        const vEl = byLocal(c, 'v')[0]
        const raw = vEl?.textContent ?? ''
        v = t === 's' ? (shared[Number(raw)] ?? '') : raw
      }
      v = cleanCell(v)
      if (!v) continue
      const r = rowOf(ref)
      const row = rows.get(r) ?? {}
      row[col] = v
      rows.set(r, row)
    }
    const groups = extractGroups(rows)
    const memberCount = groups.reduce((n, g) => n + g.members.length, 0)
    if (memberCount > 0) out.push({ name, groups, memberCount })
  }
  return out
}

function extractGroups(rows: Map<number, Record<string, string>>): ParsedGroup[] {
  const nums = [...rows.keys()].sort((a, b) => a - b)
  // '목장명' 머리글 줄 찾기
  const header = nums.find((r) => (rows.get(r)?.A ?? '').replace(/\s/g, '') === '목장명')
  if (header === undefined) return []
  const groups: ParsedGroup[] = []
  let cur: { g: ParsedGroup; bCount: number } | null = null
  for (const r of nums) {
    if (r <= header) continue
    const row = rows.get(r)!
    const a = row.A ?? ''
    // 아래쪽 '* 새친구 / *방문 / * 바나바 현황' 같은 줄부터는 명단이 아니다
    if (a.startsWith('*') || a.includes(':') || /^(합계|총계|계|새친구|새신자|방문|바나바)/.test(a)) break
    if (a) {
      cur = { g: { name: a, members: [] }, bCount: 0 }
      groups.push(cur.g)
    }
    if (!cur) continue
    if (row.B && !looksLikeNumber(row.B)) {
      const role = cur.bCount === 0 ? 'leader' : cur.bCount === 1 ? 'manager' : null
      cur.bCount++
      cur.g.members.push({ name: row.B, role })
    }
    for (const c of 'CDEFGHIJKL') {
      const v = row[c]
      if (v && !looksLikeNumber(v)) cur.g.members.push({ name: v, role: null })
    }
  }
  // 목자·총무를 앞으로
  for (const g of groups) {
    g.members.sort((x, y) => rank(x.role) - rank(y.role))
  }
  return groups.filter((g) => g.members.length > 0)
}

function rank(r: 'leader' | 'manager' | null) {
  return r === 'leader' ? 0 : r === 'manager' ? 1 : 2
}

function looksLikeNumber(s: string) {
  return /^[0-9.,\s]+$/.test(s)
}
