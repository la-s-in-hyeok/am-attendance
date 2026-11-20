/**
 * 워드 문서를 쪽으로 나눠요.
 *
 * docx-preview 는 쪽을 나누지 않고 한 구역을 길게 이어서 그려요. 여기서 그 긴 그림을 쪽 높이마다 잘라요.
 *  - 글자 줄·그림·쪼갤 수 없는 표 줄은 '자르면 안 되는 덩어리'로 모아 두고, 그 사이에서만 잘라요 (글자가 잘리지 않게)
 *  - 워드가 저장해 둔 쪽 넘김 자리(책갈피)가 그럴듯한 위치에 있으면 거기서 잘라요
 *  - 워드가 센 쪽수를 알면 그 쪽수가 나오도록 한 쪽에 담는 양을 조금씩 바꿔 봐요.
 *    대체 글꼴이라 조금 길어진 쪽은 살짝 줄여서 한 쪽에 담아요
 */
import { KEEP_ROW_MARK, PAGE_MARK } from './docxPrep'

/** 머리글 줄(워드의 '머리글 행 반복')에 붙이는 표시 (docx.ts 에서 달아요) */
export const HEADER_ROW = 'am-repeat-header'

/** 머리글 줄이 있는 표: 다음 쪽으로 이어지면 그 쪽 맨 위에 머리글 줄을 다시 그려요 */
export type RepeatHead = { tableBottom: number; top: number; bottom: number }

export type Slice = {
  section: HTMLElement
  /** 구역(section) 위쪽에서부터 잰 자를 곳 (CSS 화소) */
  top: number
  bottom: number
  /** 쪽에 맞춰 담을 높이. 끝부분이 빈 줄뿐이면 그 빈 줄은 잘려도 되니 bottom - top 보다 작아요 */
  fit?: number
}

/**
 * 워드가 쪽을 넘긴 자리.
 * weak: 가운데 맞춤 칸('QT'·'기도제목' 같은 칸)에서 나온 표시예요. 그 줄 맨 위(y)를 가리키지만,
 *   워드는 쪽 넘김이 그 줄 앞(앞 줄 안)이나 그 줄 안에서 일어났을 때도 이 칸에 표시를 남겨서,
 *   그 줄이 쪽에 다 안 들어갈 때만 써요.
 */
export type PageMark = { y: number; weak: boolean; /** weak 일 때 그 줄 높이 */ rowH: number }

export type SectionGeo = {
  section: HTMLElement
  /** 쪽 크기 */
  pageW: number
  pageH: number
  /** 본문이 시작하는 높이(위 여백), 본문 높이 */
  bodyTop: number
  bodyH: number
  /** 본문 끝 */
  end: number
  /** 오른쪽으로 쪽을 넘친 내용까지 포함한 폭 */
  contentW: number
  /** 자르면 안 되는 구간 (겹친 것은 합쳐서, 위에서부터) */
  atoms: [number, number][]
  /** 합치기 전의 글자 줄·그림·표 줄 하나하나 (위에서부터). 한 쪽보다 큰 덩어리를 나눌 때 줄 사이를 찾는 데 써요 */
  pieces: [number, number][]
  /** 눈에 보이는 것(글자·그림·표)이 있는 구간 */
  ink: [number, number][]
  /** 워드가 쪽을 넘긴 자리 (자를 수 있는 위치로 맞춘 값, 위에서부터) */
  marks: PageMark[]
  /** 표가 차지하는 높이 구간 (표 한가운데서 자른 곳은 테두리가 양쪽 쪽에 다 보이게 1px 더 떠요) */
  tables: [number, number][]
  /** 표 줄마다 맨 위 높이 (오름차순) */
  rowTops: number[]
  heads: RepeatHead[]
}

export type Plan = {
  pages: Slice[]
  /** 가장 많이 줄인 비율 (1 = 안 줄임) */
  minScale: number
  /** 워드 쪽수와 맞췄는지 (모르면 null) */
  matched: boolean | null
  /** 워드 쪽 넘김 자리를 쓴 횟수 */
  usedMarks: number
  /** 한 쪽보다 큰 덩어리(큰 그림 등)를 어쩔 수 없이 잘랐는지 */
  forced: boolean
  /** 쪽이 너무 많아서 끝까지 나누지 못하고 멈췄는지 (그러면 pages.length 는 실제 쪽수가 아니에요) */
  truncated: boolean
  /** 고른 계획 (한 쪽에 담은 양, 워드 쪽 넘김 자리를 썼는지) */
  cap: number
  useMarks: boolean
}

const px = (v: string) => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

/** 글자 하나하나가 아니라 글 조각(text node)마다 줄 단위 사각형을 모아요 */
function textAtoms(root: Element, top0: number, out: [number, number][], skip: Set<Element>, ink: [number, number][]): void {
  const doc = root.ownerDocument
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const range = doc.createRange()
  const skipped = (t: Text) => {
    for (let el = t.parentElement; el && el !== root; el = el.parentElement) if (skip.has(el)) return true
    return false
  }
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text
    if (!t.data || (skip.size > 0 && skipped(t))) continue
    range.selectNodeContents(t)
    // 빈 문단(문단 끝 표시 글자뿐)은 자리만 차지하고 눈에 보이지 않아요
    const visible = /[^\s\u200b]/.test(t.data)
    for (const r of Array.from(range.getClientRects())) {
      if (r.height <= 0) continue
      out.push([r.top - top0, r.bottom - top0])
      if (visible) ink.push([r.top - top0, r.bottom - top0])
    }
  }
  range.detach()
}

/** 칸 안의 글자 줄 수 (2 이상이면 그 표 줄은 줄 사이에서 쪼갤 수 있어요) */
function lineCount(cell: Element): number {
  const tops: number[] = []
  const doc = cell.ownerDocument
  const walker = doc.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
  const range = doc.createRange()
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text
    if (!t.data) continue
    range.selectNodeContents(t)
    for (const r of Array.from(range.getClientRects())) {
      if (r.height <= 0) continue
      const mid = (r.top + r.bottom) / 2
      if (!tops.some((y) => Math.abs(y - mid) < r.height / 2)) tops.push(mid)
      if (tops.length >= 2) return 2
    }
  }
  return tops.length
}

function mergeAtoms(list: [number, number][]): [number, number][] {
  list.sort((a, b) => a[0] - b[0])
  const out: [number, number][] = []
  for (const [a, b] of list) {
    const last = out[out.length - 1]
    // 0.5px 이하로 겹치는 것은 맞닿은 것으로 봐요
    if (last && a < last[1] - 0.5) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

/** y 가 덩어리 안이면 그 덩어리 (위·아래 끝은 자를 수 있어요) */
function atomAt(atoms: [number, number][], y: number): [number, number] | null {
  let lo = 0
  let hi = atoms.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const [a, b] = atoms[mid]
    if (y <= a + 0.5) hi = mid - 1
    else if (y >= b - 0.5) lo = mid + 1
    else return atoms[mid]
  }
  return null
}

/** 칸 내용의 높이 (위아래 칸 여백 포함) */
function naturalHeight(td: Element, win: Window): number {
  const range = td.ownerDocument.createRange()
  range.selectNodeContents(td)
  const rects = Array.from(range.getClientRects()).filter((r) => r.height > 0)
  const cs = win.getComputedStyle(td)
  const pad = px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth)
  if (rects.length === 0) return pad
  return Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top)) + pad
}

/** 칸 내용이 칸 높이를 거의 다 채우는지 (그러면 세로 맞춤과 상관없이 위치가 워드와 같아요) */
function fillsCell(td: Element): boolean {
  const range = td.ownerDocument.createRange()
  range.selectNodeContents(td)
  const rects = Array.from(range.getClientRects()).filter((r) => r.height > 0)
  if (rects.length === 0) return false
  const content = Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top))
  return content >= td.getBoundingClientRect().height - 30
}

/** 책갈피 다음에 오는 첫 글자의 위치 (책갈피가 앞 줄 끝에 붙어 있을 수 있어서) */
function markTop(mark: HTMLElement): number {
  const doc = mark.ownerDocument
  const scope = mark.closest('td, th, article') ?? doc.body
  const walker = doc.createTreeWalker(scope, NodeFilter.SHOW_TEXT)
  walker.currentNode = mark
  const range = doc.createRange()
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text
    if (!t.data) continue
    range.setStart(t, 0)
    range.setEnd(t, Math.min(1, t.data.length))
    const r = range.getClientRects()[0]
    if (r && r.height > 0) return r.top
  }
  return mark.getBoundingClientRect().top
}

/** 구역 하나의 배치를 재요 */
export function measureSection(section: HTMLElement, win: Window): SectionGeo {
  const box = section.getBoundingClientRect()
  const top0 = box.top
  const cs = win.getComputedStyle(section)
  const pageW = box.width
  const minH = px(cs.minHeight)
  const pageH = minH > 0 ? minH : (pageW * 297) / 210
  const padTop = px(cs.paddingTop)
  const padBottom = px(cs.paddingBottom)
  const bodies = Array.from(section.children).filter((c) => c.tagName !== 'HEADER' && c.tagName !== 'FOOTER' && c.tagName !== 'STYLE') as HTMLElement[]
  const first = bodies[0]
  const bodyTop = first ? Math.max(padTop, first.getBoundingClientRect().top - top0) : padTop
  let end = bodyTop
  let right = pageW
  const raw: [number, number][] = []
  const ink: [number, number][] = []
  const bodyH = Math.max(50, pageH - bodyTop - padBottom)
  // 표 줄: 통째로 옮길 줄은 한 덩어리로
  //  - 칸마다 글자 줄이 하나뿐인 줄, '줄 나눔 금지' 줄
  //  - 줄 높이가 내용이 아니라 '최소 높이'로 정해진 줄 (워드는 이런 줄을 나누지 않고 다음 쪽으로 넘겨요)
  // 나눌 수 있는 줄의 가운데·아래 맞춤 칸(내용이 칸보다 작은 칸)은 쪽 경계 위치를 정하는 데 쓰지 않아요.
  // 그 칸 내용은 쪽을 나눈 뒤 첫 쪽 부분으로 옮겨요(alignSplitCells)
  const floating = new Set<Element>()
  const rowTops: number[] = []
  for (const tr of Array.from(section.querySelectorAll('tr'))) {
    const r = tr.getBoundingClientRect()
    if (r.height > 0) rowTops.push(r.top - top0)
    if (r.height <= 0 || r.height > bodyH) continue
    const cells = Array.from(tr.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH')
    const keep = cells[0]?.querySelector(`span[id^="${KEEP_ROW_MARK}"]`) != null
    const natural = Math.max(0, ...cells.map((c) => naturalHeight(c, win)))
    if (keep || natural < r.height - 8 || cells.every((c) => lineCount(c) < 2)) raw.push([r.top - top0, r.bottom - top0])
    else for (const c of cells) if (win.getComputedStyle(c).verticalAlign !== 'top' && !fillsCell(c)) floating.add(c)
  }
  for (const b of bodies) {
    const r = b.getBoundingClientRect()
    end = Math.max(end, r.bottom - top0)
    textAtoms(b, top0, raw, floating, ink)
    for (const el of Array.from(b.querySelectorAll('img, svg, canvas, video, object'))) {
      const rr = el.getBoundingClientRect()
      if (rr.height <= 0) continue
      raw.push([rr.top - top0, rr.bottom - top0])
      ink.push([rr.top - top0, rr.bottom - top0])
    }
    for (const el of Array.from(b.querySelectorAll('table, p'))) right = Math.max(right, el.getBoundingClientRect().right - box.left)
  }
  const pieces = raw.map(([a, b]): [number, number] => [a, b]).sort((p, q) => p[0] - q[0])
  const atoms = mergeAtoms(raw)
  const tables: [number, number][] = []
  const heads: RepeatHead[] = []
  for (const b of bodies)
    for (const t of Array.from(b.querySelectorAll('table'))) {
      if (t.parentElement?.closest('table')) continue
      const r = t.getBoundingClientRect()
      tables.push([r.top - top0, r.bottom - top0])
      ink.push([r.top - top0, r.bottom - top0])
      // 맨 위부터 이어진 머리글 줄들
      const rows = Array.from(t.rows).filter((row) => row.closest('table') === t)
      let n = 0
      while (n < rows.length - 1 && rows[n].classList.contains(HEADER_ROW)) n++
      if (n > 0) {
        const hb = rows[n - 1].getBoundingClientRect().bottom - top0
        // 머리글이 한 쪽의 절반보다 크면 반복하지 않아요 (워드도 그래요)
        if (hb - (r.top - top0) < bodyH / 2) heads.push({ tableBottom: r.bottom - top0, top: r.top - top0, bottom: hb })
      }
    }
  // 워드가 쪽을 넘긴 자리: 그 줄 바로 위 (덩어리 안이면 덩어리 위)
  const found: PageMark[] = []
  const weak: { y: number; rowBottom: number }[] = []
  for (const m of Array.from(section.querySelectorAll<HTMLElement>(`span[id^="${PAGE_MARK}"]`))) {
    const td = m.closest('td, th')
    if (td && win.getComputedStyle(td).verticalAlign !== 'top' && !fillsCell(td)) {
      // 가운데·아래 맞춤 칸의 표시는 우리 배치에서 엉뚱한 높이에 있어요. 줄 맨 위로 봐요
      const r = (td.parentElement as HTMLElement).getBoundingClientRect()
      weak.push({ y: r.top - top0, rowBottom: r.bottom - top0 })
      continue
    }
    let y = markTop(m) - top0
    const a = atomAt(atoms, y)
    if (a) y = a[0]
    found.push({ y, weak: false, rowH: 0 })
  }
  // 줄이 여러 쪽에 걸치면 워드는 내용 칸에도 표시를 남겨요. 같은 줄 안에 그런 표시가 줄 맨 위에서 한 쪽 높이보다
  // 가까이 있으면 그 줄은 앞 쪽에서 이미 시작한 거라, 가운데 맞춤 칸의 표시는 버려요.
  // (줄 맨 위에서 거의 한 쪽 높이만큼 떨어져 있으면 그 줄이 새 쪽 맨 위에서 시작한 거예요)
  for (const w of weak)
    if (!found.some((f) => !f.weak && f.y > w.y + 2 && f.y < w.rowBottom - 2 && f.y - w.y < bodyH * 0.9))
      found.push({ y: w.y, weak: true, rowH: w.rowBottom - w.y })
  const marks = found.filter((f) => f.y > bodyTop + 2 && f.y < end - 2).sort((a, b) => a.y - b.y)
  // 거의 같은 자리의 표시는 하나로 (확실한 표시를 남겨요)
  const uniq: PageMark[] = []
  for (const f of marks) {
    const last = uniq[uniq.length - 1]
    if (last && f.y - last.y <= 3) last.weak &&= f.weak
    else uniq.push({ ...f })
  }
  return { section, pageW, pageH, bodyTop, bodyH, end, contentW: right, atoms, ink: mergeAtoms(ink), pieces, marks: uniq, tables, rowTops: rowTops.sort((a, b) => a - b), heads }
}

/**
 * 표나 표 줄의 맨 위 테두리 바로 아래(첫 글자 줄 위)에서 자르게 되면 그 줄 맨 위로 올려요.
 * 다음 줄의 위 테두리·칸 여백만 앞 쪽 끝에 남아 테두리가 두 줄로 보이지 않게요
 */
function snapToRowTop(g: SectionGeo, y0: number, y: number): number {
  for (const [a] of g.tables) if (y >= a && y <= a + 3 && a > y0 + 1) return a
  let best = y
  for (const t of g.rowTops) {
    if (t > y) break
    if (y - t < 16 && t > y0 + 1 && !g.atoms.some(([a, b]) => b > t + 0.5 && a < y - 0.5)) {
      best = t
      break
    }
  }
  return best
}

/** y 에서 시작하는 쪽 맨 위에 다시 그릴 머리글 줄 (없으면 null) */
export function headAt(g: SectionGeo, y: number): RepeatHead | null {
  return g.heads.find((h) => y > h.bottom + 1 && y < h.tableBottom - 1) ?? null
}

/** 자른 곳 y 가 표 한가운데(표 줄 사이)인지 */
export function insideTable(g: SectionGeo, y: number): boolean {
  return g.tables.some(([a, b]) => y > a + 1 && y < b - 1)
}

/** a ~ b 사이에 눈에 보이는 것이 없는지 */
function blank(g: SectionGeo, a: number, b: number): boolean {
  return !g.ink.some(([x, y]) => y > a + 0.5 && x < b - 0.5)
}

/**
 * 한 쪽보다 큰 덩어리 안에서 자를 곳 (lo ~ hi 사이에서 가장 아래).
 * 줄 간격이 좁으면 위아래 글자 줄의 사각형이 살짝 겹쳐서 덩어리 하나로 합쳐져요. 합치기 전 줄 하나하나를 보고,
 * 어느 줄도 (거의) 지나가지 않는 높이를 골라요. 그런 곳이 없으면(큰 그림 등) null
 */
function fineCut(g: SectionGeo, lo: number, hi: number): number | null {
  const ps = g.pieces.filter(([a, b]) => b > lo && a < hi)
  if (ps.length === 0) return null
  const cands = new Set<number>()
  for (let i = 0; i < ps.length; i++) {
    cands.add(ps[i][0])
    cands.add(ps[i][1])
    // 겹친 두 줄 사이: 겹친 부분의 가운데
    for (let j = i + 1; j < ps.length && ps[j][0] < ps[i][1] + 4; j++)
      if (ps[j][0] < ps[i][1] && ps[j][1] > ps[i][1]) cands.add((ps[j][0] + ps[i][1]) / 2)
  }
  // 줄 사각형 끝에서 조금(줄 높이의 1/8 까지) 안쪽은 글자 위아래 빈 곳이라 잘라도 괜찮아요
  const cost = (y: number) => {
    let worst = 0
    for (const [a, b] of ps) if (y > a && y < b) worst = Math.max(worst, Math.min(y - a, b - y) / Math.max(8, b - a))
    return worst
  }
  let best: number | null = null
  let bestCost = Infinity
  for (const y of cands) {
    if (y < lo || y > hi) continue
    const c = cost(y)
    if (c < bestCost - 1e-6 || (Math.abs(c - bestCost) <= 1e-6 && best !== null && y > best)) {
      best = y
      bestCost = c
    }
  }
  return best !== null && bestCost <= 0.125 ? best : null
}

/** 표 아래 끝 바로 근처에서 자르면, 표의 아래 테두리(경계 바깥으로 반쯤 나와요)까지 앞 쪽에 담아요 */
function afterTableBorder(g: SectionGeo, y: number): number {
  for (const [, b] of g.tables) if (b > y - 3 && b < y + 1.5) return Math.max(y, b + 1.5)
  return y
}

/** y0 부터 limit 까지 담을 때 자를 곳 */
function cutBefore(g: SectionGeo, y0: number, cap: number): number {
  const limit = y0 + cap
  const a = atomAt(g.atoms, limit)
  if (!a) {
    // 덩어리 사이 빈 곳: 위아래 덩어리의 가운데에서 잘라요. 글자 아랫부분(밑으로 내려오는 획)이
    // 줄 사각형보다 1~2px 더 내려올 수 있어서, 바로 밑에서 자르면 다음 쪽 맨 위에 조각이 남아요
    let pb = y0
    let nt = g.end
    for (const [p, q] of g.atoms) {
      if (q <= limit + 0.5) pb = Math.max(pb, q)
      else if (p >= limit - 0.5) {
        nt = p
        break
      }
    }
    if (nt - pb <= 16) return Math.max(pb, Math.min(nt, (pb + nt) / 2))
    return Math.min(Math.max(limit, pb + 3), nt - 3)
  }
  // 한 쪽보다 큰 덩어리(쪼갤 수 있는 긴 표 줄 등)는 다음 쪽으로 넘기지 않고 이 쪽에서부터 줄 사이에서 나눠요
  if (a[1] - a[0] > g.bodyH || (a[0] <= y0 + 1 && a[1] - y0 > g.bodyH / 0.7)) {
    const f = fineCut(g, Math.max(y0 + 1, limit - cap * 0.5), limit)
    if (f !== null && f > y0 + 1) return f
  }
  if (a[0] > y0 + 1) return a[0]
  // 한 덩어리가 쪽보다 커요: 조금 줄여서 담을 수 있으면 통째로, 아니면 어쩔 수 없이 잘라요
  if (a[1] - y0 <= g.bodyH / 0.7) return a[1]
  return limit
}

/**
 * 워드 쪽 넘김 자리 m 뒤에 남은 자리(free)에 다음 덩어리가 넉넉히 들어가는지.
 * 들어가는데도 워드가 거기서 넘겼다면 그 표시는 예전 배치의 것(저장 뒤 내용이 바뀜)이라 믿지 않아요.
 */
function roomAfter(g: SectionGeo, m: number, free: number): boolean {
  const tol = 40
  // 조금 남은 자리는 워드와 우리 배치의 차이(글꼴·줄 나눔 규칙)일 수 있어요. 쪽의 1/5 이상 비었을 때만 의심해요
  if (free <= Math.max(tol, g.bodyH * 0.2)) return false
  const next = g.atoms.find((a) => a[1] > m + 0.5)
  if (!next) return false
  return next[1] - m <= free - tol
}

type Options = { cap: number; useMarks: boolean }

/** 한 구역에서 만들 쪽수 한도. 이보다 많으면 어차피 올릴 수 없어서 더 나누지 않아요 */
const SECTION_GUARD = 500

function planSection(g: SectionGeo, o: Options, pages: Slice[]): { minScale: number; usedMarks: number; forced: boolean; truncated: boolean } {
  let forced = false
  let y0 = g.bodyTop
  let mi = 0
  let minScale = 1
  let usedMarks = 0
  // 끝에 몇 px 만 남았고 비어 있으면(줄여 담은 큰 그림 아래 등) 빈 쪽을 만들지 않아요
  const more = () => g.end - y0 > 1 && !(g.end - y0 <= 4 && blank(g, y0, g.end))
  for (let guard = 0; more() && guard < SECTION_GUARD; guard++) {
    // 이 쪽 맨 위에 머리글 줄을 다시 그리면 그만큼 덜 담아요
    const head = headAt(g, y0)
    const headH = head ? head.bottom - head.top : 0
    const cap = (g.bodyH - headH) * o.cap
    // 이 쪽 맨 위에서 너무 가까운 표시(쪽의 절반 안)는 워드와 배치가 달라 생긴 것이라 건너뛰어요
    while (mi < g.marks.length && g.marks[mi].y - y0 < cap * 0.5) mi++
    const m = o.useMarks ? g.marks[mi] : undefined
    let cut: number
    let fit: number | undefined
    if (m && m.y > y0 + cap && m.y - y0 <= g.bodyH * 1.5 && blank(g, y0 + cap, m.y)) {
      // 워드가 넘긴 자리까지 넘치는 부분이 빈 줄뿐이에요 (표지 쪽 아래 빈 문단 등): 거기까지 담되 줄이지 않아요
      cut = m.y
      fit = cap
      usedMarks++
    } else if (m?.weak && m.y <= y0 + cap + 1 && m.rowH > cap - (m.y - y0)) {
      // 가운데 맞춤 칸의 표시: 그 줄이 이 쪽 남은 자리에 다 안 들어가면 줄 맨 위에서 넘겨요.
      // 다 들어가는데도 표시가 있으면 쪽 넘김은 그 줄 앞이나 안에서 일어난 거라, 표시를 쓰지 않고 쪽 높이만큼 담아요
      cut = m.y
      usedMarks++
    } else if (
      m &&
      !m.weak &&
      // 워드가 넘긴 자리가 한 쪽의 절반 ~ 조금 넘는 곳에 있으면 그대로 따라요 (넘치면 살짝 줄여 담아요)
      m.y - y0 <= Math.max(cap, g.bodyH / 0.85) &&
      !roomAfter(g, m.y, cap - (m.y - y0))
    ) {
      cut = m.y
      usedMarks++
    } else if (g.end - y0 <= cap + 1) cut = g.end
    else {
      cut = cutBefore(g, y0, cap)
      if (cut === y0 + cap && atomAt(g.atoms, cut)) forced = true
    }
    if (cut <= y0 + 0.5) cut = Math.min(g.end, y0 + cap)
    else if (cut < g.end) cut = Math.min(g.end, afterTableBorder(g, Math.max(y0 + 1, snapToRowTop(g, y0, cut))))
    pages.push(fit === undefined ? { section: g.section, top: y0, bottom: cut } : { section: g.section, top: y0, bottom: cut, fit })
    minScale = Math.min(minScale, g.bodyH / Math.max(g.bodyH, Math.min(cut - y0, fit ?? Infinity) + headH))
    y0 = cut
  }
  return { minScale, usedMarks, forced, truncated: more() }
}

function planAll(geos: SectionGeo[], o: Options): Plan {
  const pages: Slice[] = []
  let minScale = 1
  let usedMarks = 0
  let forced = false
  let truncated = false
  for (const g of geos) {
    const r = planSection(g, o, pages)
    minScale = Math.min(minScale, r.minScale)
    usedMarks += r.usedMarks
    forced ||= r.forced
    truncated ||= r.truncated
  }
  return { pages, minScale, matched: null, usedMarks, forced, truncated, cap: o.cap, useMarks: o.useMarks }
}

/** 한 쪽에 담는 양(1 = 쪽 높이 그대로)을 바꿔 가며 해 보는 순서 */
const CAPS = [1, 1.03, 0.97, 1.06, 0.94, 1.1, 0.9, 1.15, 0.86, 1.2, 0.82, 1.25]

/**
 * 쪽 나누기 계획. wordPages(워드가 센 쪽수)를 알면 그 쪽수가 나오는 계획을 골라요.
 * 못 맞추면 기본 계획(쪽 높이 그대로 + 워드 쪽 넘김 자리)을 써요.
 */
export function planPages(geos: SectionGeo[], wordPages: number | null): Plan {
  const plan = searchPlan(geos, wordPages)
  if (!plan.matched || wordPages === null || wordPages < 2) return plan
  // 마지막 쪽에 글 몇 줄만 넘어갔는데 문서 끝이 빈 문단이면: 워드는 보통 그 몇 줄을 앞 쪽에 (살짝 빠듯하게) 다 담고
  // 표 뒤의 빈 문단만 다음 쪽으로 넘겨서 마지막 쪽이 비어요. 앞 쪽에 다 들어가면 그렇게 나눠요 (쪽수는 같아요)
  const n = plan.pages.length
  const g = geos[geos.length - 1]
  const last = plan.pages[n - 1]
  const prev = plan.pages[n - 2]
  if (!prev || last.section !== g.section || prev.section !== g.section || prev.fit !== undefined) return plan
  const lastInk = g.ink.length ? g.ink[g.ink.length - 1][1] : g.bodyTop
  const tail = Math.min(g.end, afterTableBorder(g, lastInk + 0.5))
  const inkOnLast = g.ink.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, last.bottom) - Math.max(a, last.top)), 0)
  if (g.end - tail < 8 || inkOnLast <= 0 || inkOnLast > g.bodyH * 0.2 || tail <= last.top) return plan
  // 워드는 글이 있는 쪽 첫 줄에 쪽 넘김 표시를 남겨요. 앞 쪽 뒤에 표시가 있으면 워드의 마지막 쪽에도 글이 있었던 거예요.
  // 표시가 하나도 없는 문서는 알 수 없으니 그대로 둬요
  if (g.marks.length === 0 || g.marks.some((m) => m.y > prev.top + 2)) return plan
  const head = headAt(g, prev.top)
  const need = tail - prev.top + (head ? head.bottom - head.top : 0)
  const scale = g.bodyH / Math.max(g.bodyH, need)
  if (scale < 0.94) return plan
  return {
    ...plan,
    pages: [...plan.pages.slice(0, n - 2), { section: g.section, top: prev.top, bottom: tail }, { section: g.section, top: tail, bottom: g.end }],
    minScale: Math.min(plan.minScale, scale),
  }
}

function searchPlan(geos: SectionGeo[], wordPages: number | null): Plan {
  const hasMarks = geos.some((g) => g.marks.length > 0)
  const base = planAll(geos, { cap: 1, useMarks: hasMarks })
  if (wordPages === null) return base
  if (base.pages.length === wordPages) return { ...base, matched: true }
  // 워드의 쪽 넘김 자리를 따르는 계획을 먼저 다 해 봐요 (담는 양을 조금 바꾸는 게 쪽 넘김 자리를 버리는 것보다 워드에 가까워요)
  for (const useMarks of hasMarks ? [true, false] : [false]) {
    for (const cap of CAPS) {
      const p = planAll(geos, { cap, useMarks })
      if (p.pages.length === wordPages) return { ...p, matched: true }
    }
  }
  return { ...base, matched: false }
}

/** 쪽 경계에 걸쳐 나뉜 표 줄들 (자른 곳 y 가 줄의 위·아래 끝이 아닌 줄) */
function rowsCutAt(section: HTMLElement, y: number): HTMLTableRowElement[] {
  const top0 = section.getBoundingClientRect().top
  return Array.from(section.querySelectorAll('tr')).filter((tr) => {
    const r = tr.getBoundingClientRect()
    return r.top - top0 < y - 1 && r.bottom - top0 > y + 1
  })
}

/**
 * 쪽 경계에 걸친 표 줄에서, 가운데·아래 맞춤 칸(예: 왼쪽 '기도제목' 칸)의 내용을 첫 쪽 부분의 가운데로 옮겨요.
 * 그대로 두면 여러 쪽에 걸친 긴 줄의 한가운데(엉뚱한 쪽)에 그려지거나 쪽 경계에 걸려요. 워드는 첫 쪽 부분에 그려요.
 * 칸 안의 위치만 바뀌고 줄 높이는 그대로라 쪽 나누기 결과는 바뀌지 않아요.
 */
export function alignSplitCells(pages: Slice[]): void {
  const done = new Set<Element>()
  for (let i = 0; i < pages.length - 1; i++) {
    const { section, bottom } = pages[i]
    if (pages[i + 1].section !== section) continue
    const win = section.ownerDocument.defaultView
    if (!win) continue
    const top0 = section.getBoundingClientRect().top
    for (const tr of rowsCutAt(section, bottom)) {
      if (done.has(tr)) continue
      done.add(tr)
      const rowTop = tr.getBoundingClientRect().top - top0
      const first = bottom - rowTop
      for (const td of Array.from(tr.children) as HTMLElement[]) {
        if (td.tagName !== 'TD' && td.tagName !== 'TH') continue
        const cs = win.getComputedStyle(td)
        const va = cs.verticalAlign
        // 내용이 칸을 채운 칸(여러 쪽에 걸쳐 이어지는 본문 칸)은 그대로 둬요
        if ((va !== 'middle' && va !== 'bottom') || fillsCell(td)) continue
        const range = td.ownerDocument.createRange()
        range.selectNodeContents(td)
        const rects = Array.from(range.getClientRects()).filter((r) => r.height > 0)
        if (rects.length === 0) continue
        const content = Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top))
        const pt = px(cs.paddingTop)
        const pb = px(cs.paddingBottom)
        const free = first - pt - pb - content
        td.style.verticalAlign = 'top'
        // 첫 쪽 부분에 안 들어가면 다음 쪽 부분의 맨 위로
        td.style.paddingTop = `${free < 0 ? first + pt : pt + (va === 'middle' ? free / 2 : free)}px`
      }
    }
  }
}

export type CutLine = { x0: number; x1: number; width: number; color: string }

/** 쪽 경계에서 나뉜 표 줄에 그어 줄 테두리 (워드처럼 쪽 끝·다음 쪽 처음에 칸 테두리를 닫아요) */
export function cutLines(section: HTMLElement, y: number, side: 'top' | 'bottom'): CutLine[] {
  const win = section.ownerDocument.defaultView
  if (!win) return []
  const box = section.getBoundingClientRect()
  const out: CutLine[] = []
  for (const tr of rowsCutAt(section, y)) {
    for (const td of Array.from(tr.children)) {
      if (td.tagName !== 'TD' && td.tagName !== 'TH') continue
      const cs = win.getComputedStyle(td)
      const style = side === 'top' ? cs.borderTopStyle : cs.borderBottomStyle
      const width = px(side === 'top' ? cs.borderTopWidth : cs.borderBottomWidth)
      if (style === 'none' || style === 'hidden' || width <= 0) continue
      const r = td.getBoundingClientRect()
      out.push({ x0: r.left - box.left, x1: r.right - box.left, width, color: side === 'top' ? cs.borderTopColor : cs.borderBottomColor })
    }
  }
  return out
}
