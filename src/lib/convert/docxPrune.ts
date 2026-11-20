/**
 * 쪽 하나를 그림으로 뜰 때, 그 쪽과 상관없는 부분을 잠깐 문서에서 빼 둬요.
 *
 * html2canvas 는 그릴 때마다 문서 전체를 복제해서 다시 배치해요. 문서가 길면 쪽마다 문서 전체를 복제하니
 * 쪽수가 늘수록 시간과 메모리가 크게 늘어요(40쪽 가까운 문서는 몇 분). 그래서 뜨기 직전에
 *  - 다른 구역(section)과, 이 쪽보다 위·아래에 있는 문단·표를 잠깐 빼고
 *  - 위에서 뺀 만큼은 빈 칸(spacer)으로 채워서 남은 내용의 위치가 바뀌지 않게 해요
 * 다 뜬 뒤에는 원래대로 돌려놔요.
 *
 * 숫자 목록의 번호(1. 2. 3.)는 앞에서부터 세는 CSS counter 라, 위에서 뺀 번호 문단은
 * 껍데기(내용 없는 복사본)만 남겨 둬서 번호가 처음부터 다시 시작하지 않게 해요.
 * 남은 내용 위치가 조금이라도 달라지면 빼지 않고 그대로 떠요.
 */

/** 번호를 세는 문단 (docx-preview 가 붙이는 'docx-num-번호-수준' 이름) */
const NUMBERED = 'p[class*="-num-"]'

type Block = { el: Element; /** 내용이 차지하는 위·아래 (그림이 삐져나온 것까지) */ top: number; bottom: number }

const cache = new WeakMap<HTMLElement, Block[]>()

function blocksOf(section: HTMLElement, article: Element): Block[] {
  const hit = cache.get(section)
  if (hit) return hit
  const top0 = section.getBoundingClientRect().top
  const blocks = Array.from(article.children).map((el): Block => {
    const r = el.getBoundingClientRect()
    let a = r.top
    let b = r.bottom
    // 떠 있는 그림·도형은 문단 상자 밖으로 나갈 수 있어요
    for (const d of Array.from(el.querySelectorAll('img, svg, canvas, [style*="absolute"], [style*="float"]'))) {
      const rr = d.getBoundingClientRect()
      if (rr.width <= 0 && rr.height <= 0) continue
      a = Math.min(a, rr.top)
      b = Math.max(b, rr.bottom)
    }
    return { el, top: a - top0, bottom: b - top0 }
  })
  cache.set(section, blocks)
  return blocks
}

/** 표의 줄들을 '함께 빼야 하는 묶음'으로 나눠요 (위아래로 합친 칸이 걸친 줄들은 한 묶음) */
function rowGroups(t: HTMLTableElement): HTMLTableRowElement[][] {
  const rows = Array.from(t.rows).filter((r) => r.closest('table') === t)
  const groups: HTMLTableRowElement[][] = []
  let cur: HTMLTableRowElement[] = []
  let reach = -1
  rows.forEach((r, i) => {
    cur.push(r)
    for (const c of Array.from(r.cells)) reach = Math.max(reach, i + Math.max(1, c.rowSpan) - 1)
    if (reach <= i) {
      groups.push(cur)
      cur = []
    }
  })
  if (cur.length) groups.push(cur)
  return groups
}

/**
 * section 의 top ~ bottom(구역 위에서부터 잰 높이) 부분만 남겨요. 원래대로 돌리는 함수를 돌려줘요.
 * 여러 쪽에 걸친 긴 표는 그 쪽 밖의 표 줄도 빼요.
 * 뺄 게 별로 없거나 위치·칸 너비를 똑같이 맞추지 못하면 아무것도 안 하고 null
 */
export function isolate(section: HTMLElement, top: number, bottom: number): (() => void) | null {
  const article = Array.from(section.children).find((c) => c.tagName === 'ARTICLE')
  const wrapper = section.parentElement
  if (!article || !wrapper) return null
  const blocks = blocksOf(section, article)
  const n = blocks.length
  let i0 = 0
  while (i0 < n && blocks[i0].bottom <= top - 2) i0++
  let i1 = n - 1
  while (i1 >= i0 && blocks[i1].top >= bottom + 2) i1--
  if (i0 >= n || i1 < i0) return null
  const sTop = () => section.getBoundingClientRect().top
  const rel = (el: Element) => el.getBoundingClientRect().top - sTop()
  const others = Array.from(wrapper.children).filter((c) => c !== section && c.tagName === 'SECTION')
  const before = others.filter((c) => c.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING)
  const after = others.filter((c) => !before.includes(c))
  const above: Element[] = blocks.slice(0, i0).map((b) => b.el)
  const below: Element[] = blocks.slice(i1 + 1).map((b) => b.el)
  // 쪽 밖의 표 줄 (맨 처음·맨 끝에 남긴 덩어리가 표일 때)
  let first: Element = blocks[i0].el
  let last: Element = blocks[i1].el
  const rowsAbove: Element[] = []
  const rowsBelow: Element[] = []
  let widthsOf: Element | null = null
  // iframe 안 요소라 instanceof 는 믿을 수 없어요 (창마다 HTMLTableElement 가 달라요). 태그 이름으로 봐요
  const isTable = (el: Element): el is HTMLTableElement => el.tagName === 'TABLE'
  const firstEl = blocks[i0].el
  if (isTable(firstEl)) {
    const t0 = sTop()
    const groups = rowGroups(firstEl)
    let g = 0
    while (g < groups.length - 1 && groups[g][groups[g].length - 1].getBoundingClientRect().bottom - t0 <= top - 2) g++
    if (g > 0) {
      for (const grp of groups.slice(0, g)) rowsAbove.push(...grp)
      first = groups[g][0]
      widthsOf = first
    }
  }
  const lastEl = blocks[i1].el
  if (isTable(lastEl)) {
    const t0 = sTop()
    const groups = rowGroups(lastEl)
    let g = groups.length - 1
    while (g > 0 && groups[g][0].getBoundingClientRect().top - t0 >= bottom + 2) g--
    // 앞에서 뺀 줄과 겹치지 않게
    if (g < groups.length - 1 && !rowsAbove.includes(groups[g][0])) {
      for (const grp of groups.slice(g + 1)) rowsBelow.push(...grp)
      last = groups[g][groups[g].length - 1]
      widthsOf ??= last
    }
  }
  // 빼 봐야 별로 안 빨라지면 그대로 떠요
  if (above.length + below.length + (rowsAbove.length + rowsBelow.length) / 2 + (before.length + after.length) * 4 < 4) return null

  const doc = section.ownerDocument
  // 지금(문서 전체가 있을 때) 위치와 칸 너비
  const want0 = rel(first)
  const want1 = rel(last)
  const cells = (row: Element | null) =>
    row ? Array.from(row.children).map((c) => { const r = c.getBoundingClientRect(); return [r.left, r.width] }) : []
  const widths = cells(widthsOf)

  // 앞에서 뺄 번호 문단의 껍데기 (번호 세기만 이어지게)
  const shell = doc.createElement('div')
  shell.style.cssText = 'display:block;height:0;overflow:hidden;margin:0;padding:0;border:0'
  for (const el of [...before, ...above, ...rowsAbove]) {
    if (el.matches(NUMBERED)) shell.appendChild(el.cloneNode(false))
    for (const p of Array.from(el.querySelectorAll(NUMBERED))) shell.appendChild(p.cloneNode(false))
  }
  const spacer = doc.createElement('div')
  spacer.style.cssText = 'display:block;height:1px;margin:0;padding:0;border:0'

  const removed: { el: Element; parent: Node; next: Node | null }[] = []
  const restore = () => {
    spacer.remove()
    shell.remove()
    for (let i = removed.length - 1; i >= 0; i--) {
      const r = removed[i]
      r.parent.insertBefore(r.el, r.next)
    }
  }
  for (const el of [...before, ...above, ...rowsAbove, ...rowsBelow, ...below, ...after]) {
    const parent = el.parentNode
    if (!parent) continue
    removed.push({ el, parent, next: el.nextSibling })
    parent.removeChild(el)
  }
  article.insertBefore(spacer, firstEl)
  if (shell.firstChild) article.insertBefore(shell, spacer)
  // 빈 칸 높이를 맞춰서 남은 내용이 원래 자리에 오게 해요
  const h = 1 + (want0 - rel(first))
  if (!(h >= 0)) {
    restore()
    return null
  }
  spacer.style.height = `${h}px`
  const now = cells(widthsOf)
  const sameWidths = now.length === widths.length && now.every((c, i) => Math.abs(c[0] - widths[i][0]) < 0.3 && Math.abs(c[1] - widths[i][1]) < 0.3)
  if (!sameWidths || Math.abs(rel(first) - want0) > 0.3 || Math.abs(rel(last) - want1) > 0.3) {
    restore()
    return null
  }
  return restore
}
