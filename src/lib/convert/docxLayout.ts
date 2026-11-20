/**
 * docx-preview 가 그린 HTML 을 워드 배치에 가깝게 고쳐요.
 *
 * 1) 줄 간격: 워드의 '최소'(atLeast) 줄 간격을 docx-preview 는 `글자 높이 + N` 으로 그려서 거의 두 배가 돼요.
 *    워드는 '글자 높이와 N 중 큰 쪽'이에요. '배수'(auto)는 글꼴 줄 높이의 배수, '고정'(exact)은 N 그대로예요.
 * 2) 줄 높이는 원래 글꼴(맑은 고딕, Aptos …)의 값으로 맞춰요. 대체 글꼴(Noto)은 줄 높이·글자 폭이 달라서,
 *    그대로 두면 한 쪽에 들어가는 줄 수가 워드와 달라지고 쪽이 밀려요.
 *    - 워드는 한글 글꼴(맑은 고딕 등)의 줄 높이를 글꼴 값의 1.3배로 잡아요 (맑은 고딕 10pt → 약 17.3pt)
 * 3) 글자 폭: 맑은 고딕 한글은 1em, Noto Sans KR 은 0.92em 이라 줄바꿈 위치가 달라져요.
 *    한글 묶음에 자간을 더해 원래 폭에 맞추고, 영문·띄어쓰기도 같은 식으로 맞춰요.
 */
import { replacementKind, SANS_FAMILY, SERIF_FAMILY } from './fonts'
import { CONTEXTUAL_MARK, PARA_END } from './docxPrep'

type Metric = {
  /** 워드가 쓰는 한 줄 높이 (글자 크기의 배수) */
  lh: number
  /** 한글 글꼴인지 */
  cjk: boolean
  /** 한글 한 글자 폭(em) */
  han?: number
  /** 영문 소문자 평균 폭(em) */
  lower?: number
  /** 띄어쓰기 폭(em) */
  space?: number
}

/** 워드가 한글 글꼴에 더하는 줄 높이 비율 */
const CJK_LEADING = 1.3

const cjk = (lineMetric: number, han: number, lower: number, space: number): Metric => ({
  lh: lineMetric * CJK_LEADING,
  cjk: true,
  han,
  lower,
  space,
})
const latin = (lh: number, lower: number, space: number): Metric => ({ lh, cjk: false, lower, space })

/** 글꼴별 값 (글꼴 파일의 hhea 줄 높이와 글자 폭을 재서 적었어요) */
const METRICS: Record<string, Metric> = {}
const put = (names: string[], m: Metric) => {
  for (const n of names) METRICS[n.toLowerCase()] = m
}
put(['맑은 고딕', 'Malgun Gothic', 'Malgun Gothic Semilight'], cjk(1.33, 1.0, 0.503, 0.352))
put(['굴림', 'Gulim', '굴림체', 'GulimChe', '돋움', 'Dotum', '돋움체', 'DotumChe', '새굴림', 'New Gulim'], cjk(1.148, 1.0, 0.515, 0.333))
put(['바탕', 'Batang', '바탕체', 'BatangChe', '궁서', 'Gungsuh', '궁서체', 'GungsuhChe', '새바탕'], cjk(1.148, 1.0, 0.534, 0.333))
put(['함초롬바탕', 'HCR Batang', '함초롬돋움', 'HCR Dotum', '한컴바탕', '한컴돋움'], cjk(1.2, 1.0, 0.5, 0.3))
put(['Apple SD Gothic Neo', 'AppleGothic', 'AppleMyungjo'], cjk(1.2, 0.865, 0.472, 0.263))
put(['Noto Sans KR', 'Noto Sans CJK KR', 'Source Han Sans K', 'Source Han Sans KR'], cjk(1.448, 0.92, 0.53, 0.224))
put(['Noto Serif KR', 'Noto Serif CJK KR', 'Source Han Serif K'], cjk(1.437, 0.966, 0.559, 0.256))
put(['나눔고딕', 'NanumGothic', 'Nanum Gothic', '나눔명조', 'NanumMyeongjo', '나눔바른고딕', 'NanumBarunGothic'], cjk(1.15, 0.92, 0.5, 0.25))
put(['Aptos', 'Aptos Display', 'Aptos Narrow'], latin(1.221, 0.483, 0.203))
put(['Calibri', 'Calibri Light'], latin(1.221, 0.456, 0.226))
put(['Arial', 'Helvetica', 'Helvetica Neue', 'Arial Narrow'], latin(1.15, 0.49, 0.278))
put(['Times New Roman', 'Times'], latin(1.15, 0.459, 0.25))
put(['Cambria'], latin(1.172, 0.488, 0.22))
put(['Georgia'], latin(1.136, 0.5, 0.24))
put(['Verdana'], latin(1.215, 0.562, 0.352))
put(['Tahoma'], latin(1.207, 0.489, 0.312))
put(['Segoe UI'], latin(1.33, 0.5, 0.274))
put(['Consolas'], latin(1.171, 0.55, 0.55))
put(['Courier New'], latin(1.133, 0.6, 0.6))

const UNKNOWN_CJK: Metric = { lh: 1.33 * CJK_LEADING, cjk: true }
const UNKNOWN_LATIN: Metric = { lh: 1.17, cjk: false }

type Widths = { han: number; lower: number; space: number }

/**
 * 대체 글꼴이 실제로 그려지는 폭(em)을 재요. 이만큼과 원래 글꼴 폭의 차이를 자간으로 메워요.
 * (글꼴을 못 받아 기기 글꼴로 그려질 때도 맞게, 늘 그 자리에서 재요)
 */
function measureReplacement(doc: Document): Record<'sans' | 'serif', Widths> {
  const probe = doc.createElement('div')
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;font-size:100px;white-space:pre;line-height:1'
  doc.body.appendChild(probe)
  const w = (family: string, text: string) => {
    const s = doc.createElement('span')
    s.style.fontFamily = `"${family}"`
    s.textContent = text
    probe.appendChild(s)
    return s.getBoundingClientRect().width / 100
  }
  const one = (family: string): Widths => ({
    han: w(family, '가나다라마바사아자차') / 10,
    lower: w(family, 'abcdefghijklmnopqrstuvwxyz') / 26,
    space: w(family, '가 가') - w(family, '가가'),
  })
  const out = { sans: one(SANS_FAMILY), serif: one(SERIF_FAMILY) }
  probe.remove()
  return out
}

const HANGUL = /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-힯ힰ-퟿]/
const HANGUL_RUN = /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-힯ힰ-퟿]+/g
/** 한·중·일 글자 (줄 높이를 한글 글꼴로 잡을 글자) */
const CJK_CHAR = /[ᄀ-ᇿ⺀-鿿ꥠ-꥿가-퟿豈-﫿︰-﹏＀-￯]/
const LATIN_CHAR = /[A-Za-z0-9À-ɏ]/

const OURS = /^am convert /i

function families(list: string): string[] {
  return list
    .split(',')
    .map((n) => n.trim().replace(/^['"]|['"]$/g, ''))
    .filter((n) => n && !OURS.test(n) && !/^(serif|sans-serif|monospace|system-ui|-apple-system)$/i.test(n))
}

/** 이 글꼴 목록이 어느 대체 글꼴로 그려지는지 (모르는 글꼴이면 null: 기기 글꼴로 그려져서 폭을 몰라요) */
function kindOf(list: string): 'serif' | 'sans' | null {
  const first = list.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '')
  if (first === SANS_FAMILY) return 'sans'
  if (first === SERIF_FAMILY) return 'serif'
  return replacementKind(list)
}

function isCjkName(name: string): boolean {
  const m = METRICS[name.toLowerCase()]
  if (m) return m.cjk
  return /[ㄱ-힣]/.test(name) || /^(hy|hc|한컴|休|ms (mincho|gothic)|simsun|simhei|mingliu|pmingliu|yu |meiryo)/i.test(name)
}

function metricOf(name: string): Metric {
  return METRICS[name.toLowerCase()] ?? (isCjkName(name) ? UNKNOWN_CJK : UNKNOWN_LATIN)
}

export type DocFonts = { latinFont: string; eastAsiaFont: string; korean: boolean }

type FontPick = { latin: string; ea: string }

function fontsOf(familyList: string, d: DocFonts): FontPick {
  const names = families(familyList)
  if (names.length === 0) return { latin: d.latinFont || 'Aptos', ea: d.eastAsiaFont || '맑은 고딕' }
  const ea = names.find(isCjkName) ?? (d.eastAsiaFont || '맑은 고딕')
  return { latin: names[0], ea }
}

// ───────────────────────── 줄 간격 규칙 ─────────────────────────

type LineRule = { kind: 'auto'; mult: number } | { kind: 'least'; px: number } | { kind: 'exact'; px: number }

const PT = 96 / 72

/** docx-preview 의 line-height 값 → 워드 규칙 */
function decodeLineHeight(v: string): LineRule | null {
  const s = v.trim()
  let m = /^calc\(\s*100%\s*\+\s*([\d.]+)(pt|px)\s*\)$/.exec(s)
  if (m) return { kind: 'least', px: Number(m[1]) * (m[2] === 'pt' ? PT : 1) }
  m = /^([\d.]+)(pt|px)$/.exec(s)
  if (m) return { kind: 'exact', px: Number(m[1]) * (m[2] === 'pt' ? PT : 1) }
  m = /^([\d.]+)$/.exec(s)
  if (m) return { kind: 'auto', mult: Number(m[1]) }
  return null
}

const encodeRule = (r: LineRule) => (r.kind === 'auto' ? `auto ${r.mult}` : `${r.kind} ${r.px}`)

function parseEncoded(v: string): LineRule | null {
  const [kind, n] = v.trim().split(/\s+/)
  const x = Number(n)
  if (!Number.isFinite(x) || x <= 0) return null
  if (kind === 'auto') return { kind, mult: x }
  if (kind === 'least' || kind === 'exact') return { kind, px: x }
  return null
}

/** 스타일 시트로 들어가는 줄 간격 값을 우리 변수(--am-lh)로 바꿔요. (글자마다 붙는 값은 그린 뒤 읽어요) */
export function patchLineSpacing(wd: unknown): void {
  type Styles = { styles?: { styles?: { values?: Record<string, string> }[] }[] }
  const styles = (wd as { stylesPart?: Styles } | null)?.stylesPart?.styles
  for (const st of styles ?? []) {
    for (const sub of st.styles ?? []) {
      const values = sub.values
      const lh = values?.['line-height']
      if (!values || lh === undefined) continue
      delete values['line-height']
      const rule = decodeLineHeight(lh)
      if (rule) values['--am-lh'] = encodeRule(rule)
      if (rule?.kind !== 'exact') delete values['min-height']
    }
  }
}

function ruleOf(p: HTMLElement, win: Window): LineRule {
  const inline = p.style.lineHeight
  if (inline) {
    const r = decodeLineHeight(inline)
    if (r) return r
  }
  return parseEncoded(win.getComputedStyle(p).getPropertyValue('--am-lh')) ?? { kind: 'auto', mult: 1 }
}

// ───────────────────────── 적용 ─────────────────────────

function wrapHangul(span: HTMLElement, spacingEm: number): void {
  const doc = span.ownerDocument
  for (const node of Array.from(span.childNodes)) {
    if (node.nodeType !== Node.TEXT_NODE) continue
    const text = (node as Text).data
    if (!HANGUL.test(text)) continue
    const frag = doc.createDocumentFragment()
    let last = 0
    for (const m of text.matchAll(HANGUL_RUN)) {
      const i = m.index ?? 0
      if (i > last) frag.appendChild(doc.createTextNode(text.slice(last, i)))
      // span 이 아닌 이름으로 만들어요 (docx-preview 의 'span' 규칙(기본 글자 크기 등)이 붙지 않게)
      const w = doc.createElement('am-h')
      w.style.letterSpacing = `${spacingEm.toFixed(3)}em`
      w.textContent = m[0]
      frag.appendChild(w)
      last = i + m[0].length
    }
    if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)))
    node.replaceWith(frag)
  }
}

const directText = (el: Element) =>
  Array.from(el.childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => (n as Text).data)
    .join('')

/**
 * 워드 배치에 맞게 고쳐요. 글꼴 이름을 대체 글꼴로 바꾸기 전에 불러야 해요 (원래 글꼴 이름을 보고 정해요).
 */
export function applyWordMetrics(root: HTMLElement, win: Window, d: DocFonts): void {
  const REPLACEMENT = measureReplacement(root.ownerDocument)
  const paras = Array.from(root.querySelectorAll<HTMLElement>('section p'))

  // 1) 글자 폭 (줄 높이보다 먼저: 한글 묶음 요소가 새로 생겨요)
  //    스타일을 읽는 일과 고치는 일을 섞으면 휴대폰에서 매번 다시 계산해서 느려져요. 다 읽은 다음에 고쳐요
  type WidthFix = { span: HTMLElement; dl: number; ds: number | null; dh: number | null }
  const widthFixes: WidthFix[] = []
  for (const p of paras) {
    const paraHasHangul = HANGUL.test(p.textContent ?? '')
    for (const span of Array.from(p.querySelectorAll<HTMLElement>('span'))) {
      const own = directText(span)
      if (!own || own === PARA_END) continue
      const family = win.getComputedStyle(span).fontFamily
      const kind = kindOf(family)
      if (!kind) continue // 기기 글꼴로 그려지는 글꼴은 폭을 몰라요
      const f = fontsOf(family, d)
      const rep = REPLACEMENT[kind]
      const latinM = metricOf(f.latin)
      const eaM = metricOf(f.ea)
      const dl = latinM.lower !== undefined && LATIN_CHAR.test(own) ? latinM.lower - rep.lower : 0
      const spaceM = paraHasHangul ? eaM : latinM
      const ds = spaceM.space !== undefined && own.includes(' ') ? spaceM.space - rep.space - dl : null
      const dh = eaM.han !== undefined && HANGUL.test(own) ? eaM.han - rep.han : null
      widthFixes.push({ span, dl, ds, dh })
    }
  }
  for (const { span, dl, ds, dh } of widthFixes) {
    if (Math.abs(dl) > 0.004) span.style.letterSpacing = `${dl.toFixed(3)}em`
    if (ds !== null && Math.abs(ds) > 0.004) span.style.wordSpacing = `${ds.toFixed(3)}em`
    if (dh !== null && Math.abs(dh) > 0.004) wrapHangul(span, dh)
  }

  // 번호·글머리표 뒤의 탭: 워드는 내어쓰기 자리까지 띄우는데, docx-preview 는 탭 글자를 그냥 넣어서
  // 빈칸 하나로 줄어들어요. 번호 칸을 내어쓰기 폭만큼 잡아 본문이 들여쓰기 자리에서 시작하게 해요
  const hangs = new Set<number>()
  for (const p of paras) {
    if (!/-num-/.test(p.className)) continue
    const ti = parseFloat(win.getComputedStyle(p).textIndent)
    if (!(ti < -1)) continue
    const w = Math.round(-ti)
    hangs.add(w)
    p.classList.add(`am-hang-${w}`)
  }
  if (hangs.size > 0) {
    const st = root.ownerDocument.createElement('style')
    st.textContent = Array.from(hangs, (w) => `p.am-hang-${w}::before{display:inline-block;min-width:${w}px;text-indent:0;white-space:nowrap}`).join('\n')
    root.appendChild(st)
  }

  // 같은 스타일 문단 사이 간격 없애기 (워드의 contextualSpacing)
  const styleOf = (p: Element) =>
    Array.from(p.classList)
      .filter((c) => !c.includes('-num-'))
      .sort()
      .join(' ')
  for (const mark of Array.from(root.querySelectorAll(`p > span[id^="${CONTEXTUAL_MARK}"]`))) {
    const p = mark.parentElement as HTMLElement
    const next = p.nextElementSibling
    const prev = p.previousElementSibling
    if (next?.tagName === 'P' && styleOf(next) === styleOf(p)) p.style.marginBottom = '0'
    if (prev?.tagName === 'P' && styleOf(prev) === styleOf(p)) p.style.marginTop = '0'
  }

  // 2) 줄 높이 (역시 다 읽은 다음에 고쳐요)
  const lineFixes: [HTMLElement, string][] = []
  for (const p of paras) {
    const rule = ruleOf(p, win)
    for (const span of Array.from(p.querySelectorAll<HTMLElement>('span'))) {
      if (!span.firstChild) {
        // 빈 span(책갈피 등)도 줄 높이를 차지해요. 워드에서는 아무 자리도 차지하지 않으니 0 으로
        lineFixes.push([span, '0'])
        continue
      }
      const cs = win.getComputedStyle(span)
      const size = parseFloat(cs.fontSize) || 13.333
      const text = span.textContent ?? ''
      const f = fontsOf(cs.fontFamily, d)
      const hasCjk = CJK_CHAR.test(text)
      const latinLh = metricOf(f.latin).lh
      const factor = hasCjk ? Math.max(metricOf(f.ea).lh, LATIN_CHAR.test(text) ? latinLh : 0) : latinLh
      if (rule.kind === 'auto') lineFixes.push([span, (rule.mult * factor).toFixed(4)])
      else if (rule.kind === 'least') lineFixes.push([span, `${Math.max(rule.px, size * factor).toFixed(3)}px`])
      else lineFixes.push([span, `${rule.px.toFixed(3)}px`])
    }
  }
  for (const [span, lh] of lineFixes) span.style.lineHeight = lh
  for (const p of paras) {
    // 문단 자체의 기본 줄(strut)은 높이를 차지하지 않게 해요. 줄 높이는 글자(span)들이 정해요
    p.style.lineHeight = '0'
    p.style.minHeight = '0'
    if (d.korean) p.style.wordBreak = 'keep-all'
  }
}
