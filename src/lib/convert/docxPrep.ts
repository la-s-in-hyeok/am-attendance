/**
 * 워드(.docx)를 docx-preview 에 넘기기 전에 XML 을 손봐요. (그리는 모양은 바꾸지 않고, 나중에 쪽을 나눌 때 쓸 표시만 심어요)
 *
 * - 워드가 저장할 때 '여기서 쪽이 넘어갔다'고 적어 두는 <w:lastRenderedPageBreak/> 자리에 빈 책갈피를 넣어요.
 *   docx-preview 는 이걸 본문 바로 아래에서만 쓰고 표 안에 있는 것은 버려요. 책갈피는 빈 <span> 으로 그려져서
 *   글자 배치는 그대로이고, 나중에 그 위치(높이)를 재서 워드와 같은 곳에서 쪽을 나눠요.
 * - 문단 끝 표시(¶)의 글자 크기를 살려요. 워드는 빈 문단의 높이를 이 크기로 정하는데 docx-preview 는 버려요.
 *   그래서 문단 끝에 폭 0 글자(U+200B) 하나를 그 크기로 붙여요.
 * - 테마 글꼴(+본문, +제목 …)을 실제 글꼴 이름(맑은 고딕, Aptos …)으로 바꿔 적어요.
 *   docx-preview 는 한글용 테마 글꼴(eastAsiaTheme)을 읽지 않아서, 그대로 두면 한글 글꼴을 알 수 없어요.
 * - 워드가 센 쪽수(docProps/app.xml)를 읽어 둬요. 쪽 나누기를 워드와 맞추는 데 써요.
 */
import type JSZipType from 'jszip'
import { throwIfAborted } from './errors'
import { breathe } from './raster'

type JSZipCtor = typeof JSZipType

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'

/** 쪽 넘김 자리 책갈피 이름 앞부분 */
export const PAGE_MARK = '_amPb'
/** 쪼개면 안 되는 표 줄 표시 */
export const KEEP_ROW_MARK = '_amKr'
/** '같은 스타일 문단 사이 간격 없애기'(contextualSpacing) 문단 표시 */
export const CONTEXTUAL_MARK = '_amCs'
/** 문단 끝 표시용 글자 */
export const PARA_END = '\u200b'
/** 머리말·꼬리말의 쪽 번호(PAGE)·전체 쪽수(NUMPAGES) 자리. 쪽마다 그리기 직전에 숫자로 바꿔요 */
export const PAGE_TOKEN = '\uE000'
export const TOTAL_TOKEN = '\uE001'

export type DocxPrep = {
  /** 손본 docx (docx-preview 가 읽고 나면 비워요: 메모리를 아끼려고) */
  data: Uint8Array
  /** 워드가 센 쪽수 (워드로 저장한 파일만, 모르면 null) */
  wordPages: number | null
  /** 문서 기본 글꼴 (영문, 한글) */
  latinFont: string
  eastAsiaFont: string
  /** 한국어 문서인지 (한글을 어절 단위로 줄바꿈해요) */
  korean: boolean
  /** 심은 쪽 넘김 표시 수 */
  marks: number
  /** 머리말·꼬리말에 쪽 번호 자리가 있는지 */
  pageFields: boolean
}

type ThemeFonts = Record<string, string>

function firstEl(parent: Element | Document, ns: string, name: string): Element | null {
  return parent.getElementsByTagNameNS(ns, name)[0] ?? null
}

function childEl(parent: Element, ns: string, name: string): Element | null {
  for (const c of Array.from(parent.children)) if (c.namespaceURI === ns && c.localName === name) return c
  return null
}

const wAttr = (el: Element | null, name: string) => el?.getAttributeNS(W, name) ?? el?.getAttribute(`w:${name}`) ?? null

/** 테마 글꼴 이름표: minorHAnsi → Aptos, minorEastAsia → 맑은 고딕 … */
function readTheme(xml: string | null, eaLang: string): ThemeFonts {
  const out: ThemeFonts = {}
  if (!xml) return out
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const script = /^ja/i.test(eaLang) ? 'Jpan' : /^zh-(tw|hk|mo)/i.test(eaLang) ? 'Hant' : /^zh/i.test(eaLang) ? 'Hans' : 'Hang'
  for (const kind of ['major', 'minor'] as const) {
    const f = firstEl(doc, A, `${kind}Font`)
    if (!f) continue
    const latin = childEl(f, A, 'latin')?.getAttribute('typeface') ?? ''
    let ea = childEl(f, A, 'ea')?.getAttribute('typeface') ?? ''
    if (!ea) {
      for (const s of Array.from(f.getElementsByTagNameNS(A, 'font'))) if (s.getAttribute('script') === script) ea = s.getAttribute('typeface') ?? ''
    }
    const cs = childEl(f, A, 'cs')?.getAttribute('typeface') ?? ''
    if (latin) {
      out[`${kind}HAnsi`] = latin
      out[`${kind}Ascii`] = latin
    }
    if (ea) out[`${kind}EastAsia`] = ea
    if (cs) out[`${kind}Bidi`] = cs
  }
  return out
}

/** <w:rFonts w:asciiTheme=…> 를 실제 이름으로 바꿔요 (워드에서는 테마 쪽이 이름보다 앞서요) */
function resolveThemeFonts(doc: Document, theme: ThemeFonts): void {
  const pairs: [string, string][] = [
    ['asciiTheme', 'ascii'],
    ['hAnsiTheme', 'hAnsi'],
    ['eastAsiaTheme', 'eastAsia'],
    ['cstheme', 'cs'],
  ]
  for (const rf of Array.from(doc.getElementsByTagNameNS(W, 'rFonts'))) {
    for (const [t, n] of pairs) {
      const v = wAttr(rf, t)
      if (v === null) continue
      rf.removeAttributeNS(W, t)
      const name = theme[v]
      if (name) rf.setAttributeNS(W, `w:${n}`, name)
    }
  }
}

function newEl(doc: Document, name: string): Element {
  return doc.createElementNS(W, `w:${name}`)
}

let markSeq = 0

const FIELD = /^\s*(PAGE|NUMPAGES|SECTIONPAGES)\b/i

/** 쪽 번호 자리 글(run). 글자 모양(rPr)은 원래 필드 글을 따라요 */
function tokenRun(doc: Document, instr: string, rPrFrom: Element | null): Element {
  const r = newEl(doc, 'r')
  const rPr = rPrFrom ? childEl(rPrFrom, W, 'rPr') : null
  if (rPr) r.appendChild(rPr.cloneNode(true))
  const t = newEl(doc, 't')
  t.textContent = /^\s*PAGE\b/i.test(instr) ? PAGE_TOKEN : TOTAL_TOKEN
  r.appendChild(t)
  return r
}

/**
 * 머리말·꼬리말의 쪽 번호 필드(PAGE, NUMPAGES)를 자리 글자로 바꿔요.
 * docx-preview 는 필드를 그리지 않아서 그대로 두면 쪽 번호 자리가 비어요. 바꾼 게 있으면 true
 */
function markPageFields(doc: Document): boolean {
  let found = false
  for (const f of Array.from(doc.getElementsByTagNameNS(W, 'fldSimple'))) {
    const instr = wAttr(f, 'instr') ?? ''
    if (!FIELD.test(instr) || !f.parentNode) continue
    f.parentNode.replaceChild(tokenRun(doc, instr, f.getElementsByTagNameNS(W, 'r')[0] ?? null), f)
    found = true
  }
  for (const p of Array.from(doc.getElementsByTagNameNS(W, 'p'))) {
    let st: { instr: string; result: boolean; runs: Element[]; style: Element | null } | null = null
    let depth = 0
    for (const r of Array.from(p.getElementsByTagNameNS(W, 'r'))) {
      const type = wAttr(childEl(r, W, 'fldChar'), 'fldCharType')
      if (type === 'begin') {
        if (st) depth++
        else st = { instr: '', result: false, runs: [r], style: r }
        if (st.runs[0] !== r) st.runs.push(r)
        continue
      }
      if (!st) continue
      st.runs.push(r)
      if (depth > 0) {
        if (type === 'end') depth--
        continue
      }
      if (type === 'separate') st.result = true
      else if (type === 'end') {
        const first = st.runs[0]
        if (FIELD.test(st.instr) && first.parentNode) {
          first.parentNode.insertBefore(tokenRun(doc, st.instr, st.style), first)
          for (const x of st.runs) x.parentNode?.removeChild(x)
          found = true
        }
        st = null
      } else if (!st.result) for (const t of Array.from(r.getElementsByTagNameNS(W, 'instrText'))) st.instr += t.textContent ?? ''
      else if (childEl(r, W, 'rPr') && st.style === st.runs[0]) st.style = r
    }
  }
  return found
}

function bookmark(doc: Document, name: string): Element[] {
  const id = String(900000 + markSeq++)
  const s = newEl(doc, 'bookmarkStart')
  s.setAttributeNS(W, 'w:id', id)
  s.setAttributeNS(W, 'w:name', name)
  const e = newEl(doc, 'bookmarkEnd')
  e.setAttributeNS(W, 'w:id', id)
  return [s, e]
}

/**
 * <w:lastRenderedPageBreak/> 를 문단 바로 아래의 책갈피로 옮겨요.
 * 글(run) 중간에 있으면 그 글을 둘로 나눠 사이에 넣어요. 하이퍼링크 등 안쪽 깊이 있으면 그 덩어리 앞에 넣어요.
 */
function markPageBreaks(doc: Document): number {
  let n = 0
  for (const br of Array.from(doc.getElementsByTagNameNS(W, 'lastRenderedPageBreak'))) {
    const run = br.parentElement
    if (!run || run.localName !== 'r') {
      br.remove()
      continue
    }
    // 문단 바로 아래까지 올라가요
    let top: Element = run
    while (top.parentElement && top.parentElement.localName !== 'p') top = top.parentElement
    const p = top.parentElement
    if (!p) {
      br.remove()
      continue
    }
    const marks = bookmark(doc, `${PAGE_MARK}${n++}`)
    const before = Array.from(run.childNodes).slice(0, Array.from(run.childNodes).indexOf(br))
    const hasContentBefore = before.some((c) => c instanceof Element && c.localName !== 'rPr')
    if (top === run && hasContentBefore) {
      // 글을 둘로: [앞 내용] 책갈피 [뒤 내용]
      const r2 = run.cloneNode(false) as Element
      const rPr = childEl(run, W, 'rPr')
      if (rPr) r2.appendChild(rPr.cloneNode(true))
      let next = br.nextSibling
      while (next) {
        const following = next.nextSibling
        r2.appendChild(next)
        next = following
      }
      run.after(...marks, r2)
    } else {
      top.before(...marks)
    }
    br.remove()
  }
  return n
}

/** '줄 나눔 금지' 표 줄의 첫 칸 첫 문단에 표시를 달아요 */
function markKeepRows(doc: Document): void {
  for (const cs of Array.from(doc.getElementsByTagNameNS(W, 'cantSplit'))) {
    const v = wAttr(cs, 'val')
    if (v === '0' || v === 'false') continue
    const tr = cs.parentElement?.parentElement
    if (!tr || tr.localName !== 'tr') continue
    const tc = childEl(tr, W, 'tc')
    const p = tc ? childEl(tc, W, 'p') : null
    if (!p) continue
    const pPr = childEl(p, W, 'pPr')
    const marks = bookmark(doc, `${KEEP_ROW_MARK}${markSeq}`)
    if (pPr) pPr.after(...marks)
    else p.prepend(...marks)
  }
}

const onOff = (el: Element | null): boolean | undefined => {
  if (!el) return undefined
  const v = wAttr(el, 'val')
  return !(v === '0' || v === 'false' || v === 'off')
}

/** 문단 스타일마다 contextualSpacing 이 켜져 있는지 (basedOn 을 따라 올라가며 찾아요) */
function contextualByStyle(styles: Document | null): (styleId: string | null) => boolean {
  const own = new Map<string, { on: boolean | undefined; basedOn: string | null }>()
  let def: string | null = null
  for (const st of Array.from(styles?.getElementsByTagNameNS(W, 'style') ?? [])) {
    if (wAttr(st, 'type') !== 'paragraph') continue
    const id = wAttr(st, 'styleId')
    if (!id) continue
    const pPr = childEl(st, W, 'pPr')
    own.set(id, { on: onOff(pPr ? childEl(pPr, W, 'contextualSpacing') : null), basedOn: wAttr(childEl(st, W, 'basedOn'), 'val') })
    if (wAttr(st, 'default') === '1' || wAttr(st, 'default') === 'true') def = id
  }
  return (styleId) => {
    let id = styleId ?? def
    for (let i = 0; id && i < 20; i++) {
      const e = own.get(id)
      if (!e) break
      if (e.on !== undefined) return e.on
      id = e.basedOn
    }
    return false
  }
}

/** contextualSpacing 문단에 표시를 달아요 (docx-preview 는 이 설정을 버려요) */
function markContextual(doc: Document, byStyle: (id: string | null) => boolean): void {
  for (const p of Array.from(doc.getElementsByTagNameNS(W, 'p'))) {
    const pPr = childEl(p, W, 'pPr')
    const direct = onOff(pPr ? childEl(pPr, W, 'contextualSpacing') : null)
    const on = direct ?? byStyle(wAttr(pPr ? childEl(pPr, W, 'pStyle') : null, 'val'))
    if (!on) continue
    const marks = bookmark(doc, `${CONTEXTUAL_MARK}${markSeq}`)
    if (pPr) pPr.after(...marks)
    else p.prepend(...marks)
  }
}

/** 문단 끝 표시(¶)의 글자 모양으로 폭 0 글자를 붙여요 (빈 문단 높이를 워드처럼) */
function addParagraphEnds(doc: Document): void {
  for (const p of Array.from(doc.getElementsByTagNameNS(W, 'p'))) {
    const pPr = childEl(p, W, 'pPr')
    const mark = pPr ? childEl(pPr, W, 'rPr') : null
    if (mark && (childEl(mark, W, 'vanish') || childEl(mark, W, 'webHidden'))) continue
    const r = newEl(doc, 'r')
    if (mark) {
      const rPr = newEl(doc, 'rPr')
      for (const c of Array.from(mark.children)) {
        // 문단 끝 표시에만 쓰는 것(변경 내용 추적 등)은 빼요
        if (c.namespaceURI === W && ['ins', 'del', 'moveFrom', 'moveTo', 'rPrChange'].includes(c.localName)) continue
        rPr.appendChild(c.cloneNode(true))
      }
      r.appendChild(rPr)
    }
    const t = newEl(doc, 't')
    t.textContent = PARA_END
    r.appendChild(t)
    p.appendChild(r)
  }
}

/** 문서 기본 글꼴 (styles.xml 의 docDefaults → 기본 문단 스타일) */
function defaultFonts(styles: Document | null, theme: ThemeFonts): { latin: string; ea: string } {
  let latin = theme.minorHAnsi ?? ''
  let ea = theme.minorEastAsia ?? ''
  if (styles) {
    const take = (rf: Element | null) => {
      if (!rf) return
      latin = wAttr(rf, 'ascii') ?? latin
      ea = wAttr(rf, 'eastAsia') ?? ea
    }
    const dd = firstEl(styles, W, 'docDefaults')
    take(dd ? firstEl(dd, W, 'rFonts') : null)
    for (const st of Array.from(styles.getElementsByTagNameNS(W, 'style'))) {
      if (wAttr(st, 'type') === 'paragraph' && (wAttr(st, 'default') === '1' || wAttr(st, 'default') === 'true')) {
        const rPr = childEl(st, W, 'rPr')
        take(rPr ? childEl(rPr, W, 'rFonts') : null)
      }
    }
  }
  return { latin, ea }
}

function readWordPages(app: string | null): number | null {
  if (!app) return null
  // 워드가 저장한 쪽수만 믿어요 (다른 프로그램은 값이 없거나 맞지 않을 때가 있어요)
  if (!/<Application>[^<]*Microsoft[^<]*Word/i.test(app) && !/<Application>[^<]*Microsoft Office Word/i.test(app)) return null
  const m = /<Pages>\s*(\d+)\s*<\/Pages>/.exec(app)
  const n = m ? Number(m[1]) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

const XML_PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/

/** bytes 는 그대로 읽어요 (복사하지 않아요). 다 쓰면 버려도 돼요 */
export async function prepareDocx(bytes: Uint8Array, JSZip: JSZipCtor, signal?: AbortSignal): Promise<DocxPrep> {
  const zip = await JSZip.loadAsync(bytes)
  const text = async (path: string) => {
    const f = zip.file(path)
    return f ? f.async('string') : null
  }
  const [themeXml, settingsXml, stylesXml, appXml] = await Promise.all([
    text('word/theme/theme1.xml'),
    text('word/settings.xml'),
    text('word/styles.xml'),
    text('docProps/app.xml'),
  ])
  const eaLang = (settingsXml && /<w:themeFontLang\b[^>]*w:eastAsia="([^"]+)"/.exec(settingsXml)?.[1]) || 'ko-KR'
  const theme = readTheme(themeXml, eaLang)
  const parser = new DOMParser()
  const ser = new XMLSerializer()
  const parse = (xml: string) => {
    const d = parser.parseFromString(xml, 'application/xml')
    return d.getElementsByTagName('parsererror').length > 0 ? null : d
  }

  let stylesDoc: Document | null = null
  if (stylesXml) {
    stylesDoc = parse(stylesXml)
    if (stylesDoc) {
      resolveThemeFonts(stylesDoc, theme)
      zip.file('word/styles.xml', ser.serializeToString(stylesDoc))
    }
  }
  const numXml = await text('word/numbering.xml')
  if (numXml) {
    const d = parse(numXml)
    if (d) {
      resolveThemeFonts(d, theme)
      zip.file('word/numbering.xml', ser.serializeToString(d))
    }
  }

  let marks = 0
  let pageFields = false
  markSeq = 0
  const byStyle = contextualByStyle(stylesDoc)
  for (const path of Object.keys(zip.files)) {
    if (!XML_PARTS.test(path)) continue
    // 본문 XML 이 크면 한 부분에 시간이 꽤 걸려요. 부분마다 화면이 숨 쉴 틈을 줘요
    await breathe()
    throwIfAborted(signal)
    const xml = await text(path)
    if (!xml) continue
    const d = parse(xml)
    if (!d) continue
    resolveThemeFonts(d, theme)
    if (path === 'word/document.xml') {
      marks = markPageBreaks(d)
      markKeepRows(d)
    } else {
      for (const br of Array.from(d.getElementsByTagNameNS(W, 'lastRenderedPageBreak'))) br.remove()
      if (/^word\/(header|footer)/.test(path) && markPageFields(d)) pageFields = true
    }
    markContextual(d, byStyle)
    addParagraphEnds(d)
    zip.file(path, ser.serializeToString(d))
  }

  const fonts = defaultFonts(stylesDoc, theme)
  const data = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' })
  return { data, wordPages: readWordPages(appXml), latinFont: fonts.latin, eastAsiaFont: fonts.ea, korean: /^ko/i.test(eaLang), marks, pageFields }
}
