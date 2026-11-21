/**
 * 워드(.docx) → 쪽 그림 → PDF
 * - docx-preview(Apache-2.0)로 HTML 을 만들고, html2canvas-pro(MIT)로 쪽마다 그림을 떠요.
 * - 화면 밖 iframe 에서 그려요. 앱의 CSS(Tailwind 기본값: 그림 block, 줄 간격 1.5 등)·앱 글꼴이 섞이지 않고,
 *   휴대폰 화면 폭과 상관없이 쪽 크기 그대로 배치돼요.
 * - 순서
 *   1) docxPrep: XML 에 워드의 쪽 넘김 자리 표시를 심고, 테마 글꼴 이름·빈 문단 크기를 살려요
 *   2) docx-preview 로 구역마다 길게 이어 그려요 (쪽을 나누지 않아요)
 *   3) docxLayout: 줄 간격·글자 폭을 워드에 맞춰요
 *   4) docxPaginate: 글자 줄을 자르지 않는 곳에서, 워드와 같은 쪽수가 되게 쪽을 나눠요
 *   5) 쪽마다 그 부분만 그림으로 떠서(한 번에 다 그리면 휴대폰 캔버스 한도를 넘어요) 원래 쪽 크기에 붙여요
 */
import { abortReason, ConvertError, throwIfAborted, tooManyPages, type ConvertHooks } from './errors'
import { PAGE_TOKEN, prepareDocx, TOTAL_TOKEN, type DocxPrep } from './docxPrep'
import { applyWordMetrics, patchLineSpacing } from './docxLayout'
import { alignSplitCells, cutLines, headAt, HEADER_ROW, insideTable, measureSection, planPages, type CutLine, type Plan, type SectionGeo } from './docxPaginate'
import { isolate } from './docxPrune'
import { ensureFonts, isHeavyFamily, mapFamilyList, SANS_FAMILY } from './fonts'
import type { RasterPdf } from './pdfkit'
import { breathe, capScale, rasterize, releaseCanvas, ScaleLadder, whiteBehind } from './raster'
import { MAX_PAGES, RENDER_SCALES } from './types'

type Libs = {
  parseAsync: typeof import('docx-preview').parseAsync
  renderDocument: typeof import('docx-preview').renderDocument
  /** docx-preview 가 HTML 요소를 만드는 기본 함수 */
  h: (typeof import('docx-preview').defaultOptions)['h']
  html2canvas: typeof import('html2canvas-pro').default
  JSZip: typeof import('jszip')
}

type WordDoc = Awaited<ReturnType<Libs['parseAsync']>>

let libs: Promise<Libs> | null = null

export function loadDocxLibs(): Promise<Libs> {
  if (!libs) {
    libs = Promise.all([import('docx-preview'), import('html2canvas-pro'), import('jszip')])
      .then(([dp, h2c, jz]) => ({
        parseAsync: dp.parseAsync,
        renderDocument: dp.renderDocument,
        h: dp.defaultOptions.h,
        html2canvas: h2c.default,
        JSZip: (jz as unknown as { default?: typeof import('jszip') }).default ?? (jz as unknown as typeof import('jszip')),
      }))
      .catch((e: unknown) => {
        libs = null
        throw e
      })
  }
  return libs
}

/** iframe 폭: A3 가로(약 1590px)도 넉넉히 들어가게 */
const FRAME_W = 2400
const FRAME_H = 1200

/** docx-preview 의 미리보기용 꾸밈(회색 바탕·그림자·쪽 사이 간격)을 없애요 */
const FRAME_CSS =
  'html,body{margin:0;padding:0;background:#fff;-webkit-text-size-adjust:100%;text-size-adjust:100%}' +
  `body{font-family:"${SANS_FAMILY}"}` +
  '.docx-wrapper{background:#fff!important;padding:0!important;display:block!important}' +
  '.docx-wrapper>section.docx{box-shadow:none!important;margin:0 0 40px 0!important;overflow:visible!important}' +
  // 워드의 칸 너비(tcW)는 칸 여백까지 포함한 너비예요
  'section.docx td,section.docx th{box-sizing:border-box}'

function makeFrame(): { frame: HTMLIFrameElement; doc: Document; win: Window } {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${FRAME_W}px;height:${FRAME_H}px;border:0;pointer-events:none;`
  document.body.appendChild(frame)
  const win = frame.contentWindow
  const doc = frame.contentDocument
  if (!win || !doc) {
    frame.remove()
    throw new ConvertError('failed')
  }
  doc.open()
  doc.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${FRAME_CSS}</style></head><body></body></html>`)
  doc.close()
  return { frame, doc, win }
}

type DocNode = {
  type?: string
  name?: string
  className?: string
  isHeader?: boolean | null
  children?: DocNode[]
  sectionProps?: { type?: string }
  props?: { type?: string }
}

/**
 * docx-preview 가 읽은 문서를 그리기 전에 손봐요.
 * - 워드의 '구역 나누기(다음 쪽부터)'를 쪽 나눔으로 바꿔요. docx-preview 는 이걸 무시해서
 *   가로 쪽 구역이 앞 세로 쪽에 붙어 버려요. (구역의 시작 방식은 다음 구역의 w:type 에 있어요. 없으면 '다음 쪽')
 * - 반복할 머리글 줄에 표시를 달아요.
 */
function patchDocument(wd: unknown): void {
  const body = (wd as { documentPart?: { body?: DocNode } } | null)?.documentPart?.body
  const kids = body?.children
  if (!body || !Array.isArray(kids)) return
  const ends = kids.filter((k) => k.type === 'paragraph' && k.sectionProps)
  ends.forEach((p, i) => {
    // 워드 구역이 끝나는 자리 표시 (빈 책갈피). 쪽마다 어느 워드 구역인지 알아내서 머리말을 고를 때 써요
    p.children = [...(p.children ?? []), { type: 'bookmarkStart', name: `${SECTION_END}${i}` }]
    const nextType = (i + 1 < ends.length ? ends[i + 1].sectionProps : body.props)?.type
    if (nextType === 'continuous') return
    p.children = [...p.children, { type: 'run', children: [{ type: 'break', break: 'page' } as DocNode] }]
  })
  const markRows = (nodes: DocNode[] | undefined) => {
    for (const n of nodes ?? []) {
      // <w:tblHeader/> 처럼 값이 없으면 docx-preview 는 null 로 읽어요 (워드에서는 '켜짐')
      if (n.type === 'row' && (n.isHeader === true || n.isHeader === null)) n.className = n.className ? `${n.className} ${HEADER_ROW}` : HEADER_ROW
      if (n.children) markRows(n.children)
    }
  }
  markRows(kids)
}

/**
 * 문서가 요청한 글꼴 이름(맑은 고딕, 함초롬바탕 …)을 대체 글꼴 이름으로 바꿔요.
 * docx-preview 가 만든 <style> 안의 font-family·테마 글꼴 변수와, 글자마다 붙은 style 속성을 고쳐요.
 */
function rewriteFonts(host: HTMLElement): void {
  for (const st of Array.from(host.querySelectorAll('style'))) {
    const css = st.textContent ?? ''
    st.textContent = css
      .replace(/(font-family\s*:\s*)([^;}]+)/gi, (_m, head: string, list: string) => head + mapFamilyList(list.replace(/\s*!important\s*$/i, '')))
      .replace(/(--docx-[\w-]+-font\s*:\s*)([^;}]+)/g, (_m, head: string, list: string) => head + mapFamilyList(list))
  }
  for (const el of Array.from(host.querySelectorAll<HTMLElement>('[style]'))) {
    const ff = el.style.fontFamily
    if (!ff) continue
    el.style.fontFamily = mapFamilyList(ff)
    if (isHeavyFamily(ff) && !el.style.fontWeight) el.style.fontWeight = '700'
  }
}

/**
 * html2canvas 로 el 의 crop 부분을 떠요. html2canvas 는 문서를 복제해서 다시 배치한 뒤 그리는데,
 * 자바스크립트로 등록한 글꼴(FontFace)은 복제본에 따라가지 않아요. 그래서 복제본에도 글꼴을 등록하고
 * 다 받은 뒤에 그리게 해요 (안 하면 줄바꿈·띄어쓰기가 원래 배치와 달라져요).
 * fonts: 배치한 iframe 이 대체 글꼴을 쓰는지. 복제본도 똑같이 해야 배치가 같아요
 * (iframe 이 기기 글꼴로 배치됐으면 복제본에도 등록하지 않아요)
 */
async function snap(
  lib: Libs,
  el: HTMLElement,
  scale: number,
  crop: { x: number; y: number; width: number; height: number },
  fonts: boolean,
): Promise<HTMLCanvasElement> {
  let fontsFailed = false
  const canvas = await lib.html2canvas(el, {
    scale,
    backgroundColor: '#ffffff',
    logging: false,
    onclone: async (clone: Document) => {
      // 여기서 오류를 내면 html2canvas 가 복제본 iframe 을 치우지 않아서, 표시만 해 두고 다 그린 뒤에 실패로 해요
      if (fonts && !(await ensureFonts(clone))) fontsFailed = true
    },
    ...crop,
  })
  if (fontsFailed) {
    releaseCanvas(canvas)
    // 일반 오류라 rasterize 가 배율을 낮춰 다시 해요 (메모리가 모자라 글꼴을 못 푼 경우가 대부분이에요)
    throw new Error('글꼴을 복제본에 붙이지 못했어요')
  }
  return canvas
}

/** 워드 구역 끝 표시 책갈피 이름 앞부분 */
const SECTION_END = '_amSe'

/** 머리말·꼬리말 띠 */
type Band = { canvas: HTMLCanvasElement; y: number; h: number; scale: number }
type Bands = { header: Band | null; footer: Band | null }

function hasVisible(el: Element | undefined): el is HTMLElement {
  return !!el && ((el.textContent ?? '').replace(/[\s\u200b]/g, '') !== '' || el.querySelector('img, svg, canvas') !== null)
}

/** 구역 가운데 보이는 머리말·꼬리말이 있는지 */
function hasVisibleHf(host: HTMLElement): boolean {
  return Array.from(host.querySelectorAll('section.docx')).some((sec) =>
    Array.from(sec.children).some((c) => (c.tagName === 'HEADER' || c.tagName === 'FOOTER') && hasVisible(c)),
  )
}

async function shotBand(lib: Libs, g: SectionGeo, top: number, h: number, scale: number, fonts: boolean): Promise<Band | null> {
  if (h <= 1) return null
  // 꼬리말 위치는 본문 길이에 따라 달라서, 이 띠는 문서를 그대로 둔 채 떠요
  const canvas = await snap(lib, g.section, scale, { x: 0, y: top, width: Math.ceil(g.pageW), height: Math.ceil(h) }, fonts)
  return { canvas, y: top, h, scale }
}

/** 구역(section) 하나의 머리말·꼬리말 띠를 떠요 */
async function sectionBands(lib: Libs, g: SectionGeo, scale: number, fonts: boolean): Promise<Bands> {
  const header = Array.from(g.section.children).find((c) => c.tagName === 'HEADER')
  const footer = Array.from(g.section.children).find((c) => c.tagName === 'FOOTER')
  const secTop = g.section.getBoundingClientRect().top
  const secH = g.section.getBoundingClientRect().height
  let footerTop = secH
  if (hasVisible(footer)) footerTop = Math.min(footer.getBoundingClientRect().top - secTop, secH - (g.pageH - g.bodyTop - g.bodyH))
  const s = capScale(g.pageW, g.pageH, scale)
  const head = hasVisible(header) ? await shotBand(lib, g, 0, g.bodyTop, s, fonts) : null
  try {
    return { header: head, footer: footerTop < secH ? await shotBand(lib, g, footerTop, secH - footerTop, s, fonts) : null }
  } catch (e) {
    // 꼬리말을 뜨다 실패하면 먼저 뜬 머리말 캔버스도 바로 돌려줘요
    if (head) releaseCanvas(head.canvas)
    throw e
  }
}

function releaseBands(b: Bands | undefined): void {
  if (b?.header) releaseCanvas(b.header.canvas)
  if (b?.footer) releaseCanvas(b.footer.canvas)
}

type SectProps = {
  headerRefs?: { id: string; type: string }[]
  footerRefs?: { id: string; type: string }[]
  titlePage?: boolean
  type?: string
  pageNumber?: { start?: number }
}

type WordBody = { children?: (DocNode & { sectionProps?: SectProps })[]; props?: SectProps }
type WordShape = { documentPart?: { body?: WordBody }; settingsPart?: { settings?: { evenAndOddHeaders?: boolean } }; stylesPart?: { styles?: unknown } }

const VARIANTS = ['first', 'even', 'default'] as const

/** 워드 구역마다의 설정과 '짝수/홀수 쪽 다르게'. 머리말 틀이 필요 없으면 null (그러면 틀을 만들지 않아요) */
type HfNeed = { props: SectProps[]; evenOdd: boolean }

function templateNeed(wd: WordDoc, prep: DocxPrep): HfNeed | null {
  const w = wd as unknown as WordShape
  const body = w.documentPart?.body
  if (!body?.children) return null
  const props = [...body.children.filter((k) => k.type === 'paragraph' && k.sectionProps).map((k) => k.sectionProps as SectProps), body.props ?? {}]
  const evenOdd = w.settingsPart?.settings?.evenAndOddHeaders === true
  if (!prep.pageFields && !evenOdd && !props.some((p) => p.titlePage)) return null
  return { props, evenOdd }
}

/**
 * 문서 스타일을 지금 모양으로 복사해 둬요. docx-preview 는 그릴 때 스타일을 고쳐 쓰는데(바탕 스타일 값을 덧붙여요),
 * 같은 문서를 한 번 더 그리면 그 순서에 따라 결과가 조금 달라질 수 있어요. 머리말 틀을 그리기 전에 되돌려요
 */
function keepStyles(wd: WordDoc): () => void {
  const sp = (wd as unknown as WordShape).stylesPart
  if (!sp?.styles) return () => undefined
  let copy: unknown
  try {
    copy = structuredClone(sp.styles)
  } catch {
    return () => undefined
  }
  return () => {
    sp.styles = copy
  }
}

/** docx-preview 의 탭: 그 탭이 든 문단의 탭 위치 설정 */
type TabStop = { position?: string; leader?: string; style?: string }
type TabRef = { span: HTMLElement; stops?: TabStop[] }

/**
 * 머리말·꼬리말 틀. docx-preview 는 쪽을 나누지 않고 그려서 구역마다 머리말을 하나만 그려요.
 * '첫 쪽 다르게'·'짝수/홀수 쪽 다르게'나 쪽 번호가 있으면, 워드 구역마다 (첫 쪽, 짝수 쪽, 기본) 머리말을
 * 빈 쪽 세 장으로 따로 그려 두고 쪽마다 맞는 것을 골라 써요.
 * tabs: 쪽 번호가 든 문단의 탭. 번호 글자 수가 바뀌면 탭 폭을 다시 재요 (오른쪽·가운데 탭이 밀리지 않게)
 */
type HfTemplates = {
  host: HTMLElement
  geos: SectionGeo[]
  props: SectProps[]
  evenOdd: boolean
  tokens: [Text, string][][]
  tabs: TabRef[][]
  defaultTab: string | undefined
  pxToPt: number
}

/**
 * 그린 뒤 자리 잡기를 기다려요: docx-preview 가 0.5초 뒤에 탭 위치를 다시 재고, 글꼴·그림도 다 받아야 해요.
 * 이걸 기다린 다음에 재야 실제로 그릴 모양과 같아요
 */
async function settle(doc: Document, signal?: AbortSignal): Promise<void> {
  await new Promise((r) => setTimeout(r, 650))
  throwIfAborted(signal)
  await doc.fonts.ready
  await Promise.all(Array.from(doc.images, (img) => (img.complete ? null : img.decode().catch(() => undefined))))
  throwIfAborted(signal)
}

/** el 안의 blob: 주소를 돌려주고 el 을 문서에서 빼요 */
function dropHost(el: HTMLElement): void {
  for (const url of blobUrls(el)) URL.revokeObjectURL(url)
  el.remove()
}

async function buildHfTemplates(
  lib: Libs,
  wd: WordDoc,
  need: HfNeed,
  prep: DocxPrep,
  opts: Parameters<Libs['renderDocument']>[1],
  doc: Document,
  win: Window,
  fonts: boolean,
  signal?: AbortSignal,
): Promise<HfTemplates> {
  const w = wd as unknown as WordShape
  const body = w.documentPart?.body
  if (!body) throw new Error('no body')
  const { props, evenOdd } = need
  const pick = (refs: SectProps['headerRefs'], v: (typeof VARIANTS)[number]) => {
    const r = refs?.find((x) => x.type === v) ?? refs?.find((x) => x.type === 'default')
    return r ? [{ ...r, type: 'default' }] : []
  }
  const kids: DocNode[] = []
  props.forEach((p, i) =>
    VARIANTS.forEach((v, j) => {
      const q: SectProps = { ...p, headerRefs: pick(p.headerRefs, v), footerRefs: pick(p.footerRefs, v), titlePage: false, type: undefined }
      if (i === props.length - 1 && j === VARIANTS.length - 1) {
        body.props = q
        kids.push({ type: 'paragraph', children: [] })
      } else kids.push({ type: 'paragraph', sectionProps: q, children: [{ type: 'run', children: [{ type: 'break', break: 'page' } as DocNode] }] } as DocNode)
    }),
  )
  body.children = kids
  if (w.settingsPart?.settings) w.settingsPart.settings.evenAndOddHeaders = false
  // docx-preview 가 기억하는 탭 목록(탭 위치 설정 포함)을 얻으려고, 요소 만드는 함수를 거쳐 그리는 쪽(this)을 붙잡아요
  type Renderer = { currentTabs?: unknown; defaultTabSize?: unknown }
  let renderer: Renderer | null = null
  const baseH = lib.h
  const h = function (this: unknown, el: Parameters<typeof baseH>[0]): Node {
    if (!renderer && this && typeof this === 'object') renderer = this as Renderer
    return baseH(el)
  }
  const host = doc.createElement('div')
  doc.body.appendChild(host)
  try {
    for (const n of await lib.renderDocument(wd, { ...opts, h })) host.appendChild(n)
    applyWordMetrics(host, win, { latinFont: prep.latinFont, eastAsiaFont: prep.eastAsiaFont, korean: prep.korean })
    if (fonts) rewriteFonts(host)
    const secs = Array.from(host.querySelectorAll<HTMLElement>('section.docx'))
    if (secs.length !== props.length * VARIANTS.length) throw new Error(`틀 구역 수가 달라요 (${secs.length})`)
    await settle(doc, signal)
    // 쪽 번호 자리 글자가 든 글 조각
    const tokens = secs.map((sec) => {
      const out: [Text, string][] = []
      for (const part of Array.from(sec.children).filter((c) => c.tagName === 'HEADER' || c.tagName === 'FOOTER')) {
        const walker = doc.createTreeWalker(part, NodeFilter.SHOW_TEXT)
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const t = n as Text
          if (t.data.includes(PAGE_TOKEN) || t.data.includes(TOTAL_TOKEN)) out.push([t, t.data])
        }
      }
      return out
    })
    const r = renderer as Renderer | null
    // (iframe 안 요소라 instanceof 는 믿을 수 없어요. 함수가 있는지로 봐요)
    const all = Array.isArray(r?.currentTabs) ? (r.currentTabs as TabRef[]).filter((t) => typeof t?.span?.closest === 'function') : []
    const tabs = tokens.map((list) => {
      const paras = new Set(list.map(([t]) => t.parentElement?.closest('p')).filter((p): p is HTMLParagraphElement => !!p))
      return all.filter((t) => paras.has(t.span.closest('p') as HTMLParagraphElement))
    })
    // docx-preview 와 같은 방법으로 1px 이 몇 pt 인지 재요 (100pt 상자의 폭)
    const probe = doc.createElement('div')
    probe.style.cssText = 'position:absolute;width:100pt;height:0'
    doc.body.appendChild(probe)
    const pxToPt = probe.offsetWidth > 0 ? 100 / probe.offsetWidth : 0.75
    probe.remove()
    return {
      host,
      geos: secs.map((sec) => measureSection(sec, win)),
      props,
      evenOdd,
      tokens,
      tabs,
      defaultTab: typeof r?.defaultTabSize === 'string' ? r.defaultTabSize : undefined,
      pxToPt,
    }
  } catch (e) {
    dropHost(host)
    throw e
  }
}

/** 탭을 처음 그린 모양(전각 공백 하나)으로 돌려놔요 */
function resetTab(span: HTMLElement): void {
  span.textContent = '\u2003'
  span.style.wordSpacing = ''
  span.style.textDecoration = ''
  span.style.textDecorationStyle = ''
}

/**
 * 탭 하나의 폭을 다시 재요. docx-preview 의 탭 맞추기(updateTabStop)와 같은 계산이에요.
 * (쪽 번호 글자를 바꾼 뒤에 그대로 두면 오른쪽·가운데 탭 뒤 글자가 번호 자릿수만큼 밀려요)
 * lineH: 탭을 모두 되돌렸을 때 문단 높이. 이보다 높아지면(줄이 넘어가면) 맞추기를 물려요
 */
function refreshTab(tab: TabRef, defaultTab: string | undefined, pxToPt: number, lineH: number): void {
  const span = tab.span
  const p = span.closest('p')
  const win = span.ownerDocument.defaultView
  if (!p || !win) return
  const ebb = span.getBoundingClientRect()
  const pbb = p.getBoundingClientRect()
  const pcs = win.getComputedStyle(p)
  const stops =
    tab.stops && tab.stops.length > 0
      ? tab.stops.map((t) => ({ pos: parseFloat(t.position ?? ''), leader: t.leader, style: t.style })).sort((a, b) => a.pos - b.pos)
      : [{ pos: 0, leader: 'none', style: 'left' }]
  const size = parseFloat(defaultTab ?? '')
  const pWidth = pbb.width * pxToPt
  for (let pos = stops[stops.length - 1].pos + size; pos < pWidth && stops.length < 50; pos += size) stops.push({ pos, leader: 'none', style: 'left' })
  const marginLeft = parseFloat(pcs.marginLeft) || 0
  const left = (ebb.left - (pbb.left + marginLeft)) * pxToPt
  const stop = stops.find((t) => t.style !== 'clear' && t.pos > left)
  if (!stop) return
  const aligned = stop.style === 'right' || stop.style === 'center'
  const mul = stop.style === 'center' ? 0.5 : 1
  // 탭 뒤 글이 놓인 자리 (pt): 오른쪽 탭은 그 글의 끝, 가운데 탭은 가운데, 왼쪽 탭은 시작
  const anchor = () => {
    if (!aligned) return (span.getBoundingClientRect().right - (pbb.left + marginLeft)) * pxToPt
    const spans = Array.from(p.querySelectorAll(`.${CSS.escape(span.className)}`))
    const next = spans.indexOf(span) + 1
    const range = span.ownerDocument.createRange()
    range.setStart(span, 1)
    if (next > 0 && next < spans.length) range.setEndBefore(spans[next])
    else range.setEndAfter(p)
    const nb = range.getBoundingClientRect()
    return (nb.left + mul * nb.width - (pbb.left - marginLeft)) * pxToPt
  }
  const width = aligned ? stop.pos - anchor() : stop.pos - left
  span.textContent = '\u00a0'
  span.style.textDecoration = 'inherit'
  span.style.wordSpacing = `${width.toFixed(0)}pt`
  if (stop.leader === 'dot' || stop.leader === 'middleDot') {
    span.style.textDecoration = 'underline'
    span.style.textDecorationStyle = 'dotted'
  } else if (stop.leader === 'hyphen' || stop.leader === 'heavy' || stop.leader === 'underscore') span.style.textDecoration = 'underline'
  // docx-preview 계산은 탭 글자(전각 공백)와 바꿔 넣은 공백의 폭 차이만큼 모자라요. 놓인 자리를 재서 탭 위치에 맞춰요
  // (쪽 번호가 워드처럼 오른쪽 여백 끝에 붙어요). 줄이 넘어가면 조금 덜 맞추고, 그래도 넘어가면 docx-preview 값 그대로
  const fix = stop.pos - anchor()
  if (!Number.isFinite(fix) || Math.abs(fix) <= 0.25 || Math.abs(fix) >= 40) return
  const fits = () => p.getBoundingClientRect().height <= lineH + 0.5
  for (const room of [0.75, 2]) {
    span.style.wordSpacing = `${(width + fix - room).toFixed(2)}pt`
    if (fits()) return
  }
  span.style.wordSpacing = `${width.toFixed(0)}pt`
}

/** 문단이 한 줄인지 (글자 사각형들의 높이 가운데가 한 줄 안에 모여 있는지) */
function singleLine(p: Element): boolean {
  const range = p.ownerDocument.createRange()
  range.selectNodeContents(p)
  const rects = range.getClientRects()
  let lo = Infinity
  let hi = -Infinity
  let minH = Infinity
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]
    if (r.width <= 0 || r.height <= 0) continue
    const mid = r.top + r.height / 2
    lo = Math.min(lo, mid)
    hi = Math.max(hi, mid)
    minH = Math.min(minH, r.height)
  }
  return hi >= lo && hi - lo < minH * 0.6
}

/** 쪽 번호가 든 문단의 탭을 모두 되돌린 뒤 앞에서부터 다시 맞춰요 (앞 탭 폭이 뒤 탭 위치를 바꿔요) */
function refreshTabs(tabs: TabRef[], defaultTab: string | undefined, pxToPt: number): void {
  const paras = new Set<HTMLElement>()
  for (const t of tabs) {
    const p = t.span.closest('p')
    if (p) paras.add(p as HTMLElement)
  }
  for (const p of paras) p.style.whiteSpace = ''
  for (const t of tabs) resetTab(t.span)
  const lineH = new Map<Element, number>()
  const single = new Set<HTMLElement>()
  for (const p of paras) {
    lineH.set(p, p.getBoundingClientRect().height)
    if (singleLine(p)) single.add(p)
  }
  for (const t of tabs) {
    try {
      refreshTab(t, defaultTab, pxToPt, lineH.get(t.span.closest('p') as Element) ?? Infinity)
    } catch {
      // 탭을 못 맞춰도 글자는 그대로 그려요
    }
  }
  // 한 줄짜리 문단은 줄바꿈을 막아요. html2canvas 복제본은 글자 폭이 아주 조금 달라서, 여백 끝에 딱 맞춘 줄이 넘어갈 수 있어요
  // (글 조각(span)에도 nowrap·pre 를 줘 봤는데, 크롬에서 쪽 번호가 1px 왼쪽으로 밀려서 문단에만 줘요)
  for (const p of single) p.style.whiteSpace = 'nowrap'
}

/** 틀 쪽(index)의 머리말·꼬리말을 쪽 번호 page / 전체 total 로 채워서 떠요 */
async function templateBands(lib: Libs, hf: HfTemplates, main: HTMLElement, index: number, page: number, total: number, scale: number, fonts: boolean): Promise<Bands> {
  for (const [t, text] of hf.tokens[index]) t.data = text.split(PAGE_TOKEN).join(String(page)).split(TOTAL_TOKEN).join(String(total))
  refreshTabs(hf.tabs[index], hf.defaultTab, hf.pxToPt)
  // 본문은 잠깐 빼 두고 떠요 (html2canvas 가 긴 본문까지 복제하지 않게)
  const parent = main.parentNode
  const next = main.nextSibling
  main.remove()
  try {
    return await sectionBands(lib, hf.geos[index], scale, fonts)
  } finally {
    parent?.insertBefore(main, next)
  }
}

/** 머리말 틀을 못 만들었을 때: 쪽 번호 자리 글자가 그대로 보이지 않게 채워요 (전체 쪽수는 알아요. 쪽 번호는 비워요) */
function fillTokens(section: HTMLElement, total: number): void {
  for (const part of Array.from(section.children).filter((c) => c.tagName === 'HEADER' || c.tagName === 'FOOTER')) {
    const walker = section.ownerDocument.createTreeWalker(part, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n as Text
      if (t.data.includes(PAGE_TOKEN) || t.data.includes(TOTAL_TOKEN)) t.data = t.data.split(PAGE_TOKEN).join('').split(TOTAL_TOKEN).join(String(total))
    }
  }
}

/** 이보다 화소가 많은 사진만 줄여 봐요 (약 300만 화소) */
const SHRINK_MIN_PIXELS = 3_000_000

/** blob 주소의 그림을 tw×th 로 줄인 새 그림 (못 하면 null) */
async function shrinkOne(url: string, nw: number, nh: number, tw: number, th: number): Promise<Blob | null> {
  let bmp: ImageBitmap | null = null
  const canvas = document.createElement('canvas')
  try {
    const blob = await (await fetch(url)).blob()
    const type = /^image\/jpe?g$/i.test(blob.type) ? 'image/jpeg' : /^image\/png$/i.test(blob.type) ? 'image/png' : null
    if (!type) return null
    bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' })
    // 회전 정보를 <img> 와 다르게 읽었으면 건드리지 않아요
    if (bmp.width !== nw || bmp.height !== nh) return null
    canvas.width = tw
    canvas.height = th
    const c = canvas.getContext('2d')
    if (!c) return null
    c.imageSmoothingEnabled = true
    c.imageSmoothingQuality = 'high'
    c.drawImage(bmp, 0, 0, tw, th)
    bmp.close()
    bmp = null
    return await new Promise<Blob | null>((resolve) => {
      try {
        canvas.toBlob((b) => resolve(b && b.size > 0 ? b : null), type, 0.92)
      } catch {
        resolve(null)
      }
    })
  } catch {
    return null
  } finally {
    bmp?.close()
    releaseCanvas(canvas)
  }
}

/**
 * 큰 사진(휴대폰 사진 1200만 화소 등)을 그릴 크기(가장 큰 배율 × 조금 더)에 맞게 줄여 끼워요.
 * html2canvas 는 쪽마다 그림을 원래 크기로 풀어서 그려서, 사진이 많은 문서는 메모리가 크게 늘어요.
 * 크기가 정해진 그림만 바꿔요(배치는 그대로예요). 한 장씩 차례로 해서 한 번에 한 장만 풀려 있어요
 */
async function shrinkImages(doc: Document, signal?: AbortSignal): Promise<void> {
  if (typeof createImageBitmap !== 'function' || typeof fetch !== 'function') return
  const want = RENDER_SCALES[0] * 1.25
  for (const img of Array.from(doc.querySelectorAll<HTMLImageElement>('img[src^="blob:"]'))) {
    throwIfAborted(signal)
    const nw = img.naturalWidth
    const nh = img.naturalHeight
    if (!img.complete || !(nw > 0 && nh > 0) || nw * nh < SHRINK_MIN_PIXELS) continue
    if (!img.style.width || !img.style.height) continue
    const box = img.getBoundingClientRect()
    const k = Math.min(1, Math.max((Math.max(box.width, img.offsetWidth) * want) / nw, (Math.max(box.height, img.offsetHeight) * want) / nh))
    if (!(k > 0) || k > 0.7) continue
    const url = img.src
    const small = await shrinkOne(url, nw, nh, Math.max(1, Math.round(nw * k)), Math.max(1, Math.round(nh * k)))
    if (!small) continue
    const next = URL.createObjectURL(small)
    try {
      img.src = next
      await img.decode()
    } catch {
      img.src = url
      URL.revokeObjectURL(next)
      continue
    }
    URL.revokeObjectURL(url)
    await breathe()
  }
}

/** 개발할 때만: true 면 쪽과 상관없는 부분을 빼지 않고 떠요 (빼고 뜬 결과와 비교하는 시험용) */
const noPrune = () => import.meta.env.DEV && (window as unknown as { __docxNoPrune?: boolean }).__docxNoPrune === true

/** 구역의 y ~ y+h 부분만 떠요. 그 동안 다른 부분은 잠깐 빼 둬요 (docxPrune.ts) */
async function shoot(lib: Libs, g: SectionGeo, scale: number, y: number, w: number, h: number, fonts: boolean): Promise<HTMLCanvasElement> {
  const restore = noPrune() ? null : isolate(g.section, y, y + h)
  if (import.meta.env.DEV) {
    const st = ((window as unknown as { __docxPruneStats?: number[] }).__docxPruneStats ??= [0, 0])
    st[restore ? 0 : 1]++
  }
  try {
    return await snap(lib, g.section, scale, { x: 0, y, width: w, height: h }, fonts)
  } finally {
    restore?.()
  }
}

/** 쪽 하나를 그려요: 본문 부분을 떠서 원래 쪽 크기 캔버스의 본문 자리에 붙여요 (넘치면 줄여서) */
async function drawPage(
  lib: Libs,
  g: SectionGeo,
  top: number,
  bottom: number,
  fit: number,
  bands: Bands,
  scaleWanted: number,
  fonts: boolean,
): Promise<HTMLCanvasElement> {
  const h = bottom - top
  const head = headAt(g, top)
  const headH = head ? head.bottom - head.top : 0
  const cropW = Math.max(g.pageW, g.contentW)
  // fit: 쪽에 맞출 높이 (끝부분 빈 줄은 잘려도 돼요)
  const k = Math.min(1, g.bodyH / (Math.min(h, fit) + headH), g.pageW / cropW)
  const s = capScale(cropW, h, capScale(g.pageW, g.pageH, scaleWanted))
  // 표 한가운데서 자르면 위아래로 1px 더 떠서 테두리가 양쪽 쪽에 다 보이게 해요 (자르는 곳은 글자 줄 사이라 글자는 안 걸려요)
  const padT = insideTable(g, top) ? 1 : 0
  const padB = insideTable(g, bottom) ? 1 : 0
  const pad = 1
  // 쪽 경계에 걸친 표 줄의 테두리는 지금(전체 문서가 있을 때) 재 둬요
  const topLines = top > g.bodyTop + 1 ? cutLines(g.section, top, 'top') : []
  const bottomLines = bottom < g.end - 1 ? cutLines(g.section, bottom, 'bottom') : []
  const part = await shoot(lib, g, s, Math.max(0, top - padT), Math.ceil(cropW), Math.ceil(h + padT + padB), fonts)
  let headPart: HTMLCanvasElement | null = null
  try {
    // 표가 앞 쪽에서 이어지면 머리글 줄을 맨 위에 다시 그려요 (워드의 '머리글 행 반복')
    if (head) headPart = await shoot(lib, g, s, head.top, Math.ceil(cropW), Math.ceil(headH), fonts)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(g.pageW * s)
    canvas.height = Math.round(g.pageH * s)
    const c = canvas.getContext('2d')
    if (!c) throw new Error('no 2d context')
    c.fillStyle = '#ffffff'
    c.fillRect(0, 0, canvas.width, canvas.height)
    if (bands.header) c.drawImage(bands.header.canvas, 0, 0, g.pageW * s, bands.header.h * s)
    if (bands.footer) c.drawImage(bands.footer.canvas, 0, (g.pageH - bands.footer.h) * s, g.pageW * s, bands.footer.h * s)
    // 본문 왼쪽 여백 자리는 그대로 두고 줄여요
    const padLeft = parseFloat(g.section.ownerDocument.defaultView?.getComputedStyle(g.section).paddingLeft ?? '0') || 0
    const dx = padLeft * (1 - k)
    const offTop = top - Math.max(0, top - padT)
    if (headPart) c.drawImage(headPart, dx * s, g.bodyTop * s, headPart.width * k, headPart.height * k)
    const bodyY = g.bodyTop + headH * k
    const bodyBottom = bodyY + Math.min(h * k, g.bodyH - headH * k)
    c.save()
    c.beginPath()
    // 본문 자리 밖(머리말·꼬리말 자리)으로 삐져나오지 않게. 표 한가운데서 자른 쪽만 테두리가 보이게 1px 더 보여요
    const clipTop = bodyY - (headPart || !padT ? 0 : pad)
    c.rect(0, clipTop * s, canvas.width, (bodyBottom + (padB ? pad : 0) - clipTop) * s)
    c.clip()
    c.drawImage(part, dx * s, (bodyY - offTop * k) * s, part.width * k, part.height * k)
    c.restore()
    // 쪽 경계에서 나뉜 표 줄은 칸 테두리를 닫아 줘요. 본문 바깥쪽(위 쪽은 위로, 아래 쪽은 아래로)에 그어서
    // 경계 가까이 있는 글자를 덮지 않게 해요
    const line = (l: CutLine, y: number, up: boolean) => {
      c.fillStyle = l.color
      const w = Math.max(1, l.width * k * s)
      c.fillRect((dx + l.x0 * k) * s, y * s - (up ? w : 0), (l.x1 - l.x0) * k * s, w)
    }
    for (const l of topLines) line(l, bodyY, true)
    for (const l of bottomLines) line(l, bodyBottom, false)
    whiteBehind(canvas)
    return canvas
  } finally {
    releaseCanvas(part)
    if (headPart) releaseCanvas(headPart)
  }
}

/** 개발할 때만 써요: 쪽마다 담긴 글자(공백 없이, 문서 순서). 시험 스크립트가 워드 PDF 와 비교해요 */
function pageTexts(pages: Plan['pages']): string[] {
  const out = pages.map(() => '')
  const bySection = new Map<HTMLElement, number[]>()
  pages.forEach((p, i) => bySection.set(p.section, [...(bySection.get(p.section) ?? []), i]))
  for (const [section, idx] of bySection) {
    const doc = section.ownerDocument
    const top0 = section.getBoundingClientRect().top
    const walker = doc.createTreeWalker(section, NodeFilter.SHOW_TEXT)
    const range = doc.createRange()
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n as Text
      if (t.parentElement?.closest('header, footer, style')) continue
      for (let k = 0; k < t.data.length; k++) {
        const ch = t.data[k]
        if (/\s|\u200b/.test(ch)) continue
        range.setStart(t, k)
        range.setEnd(t, k + 1)
        const r = range.getBoundingClientRect()
        const y = (r.top + r.bottom) / 2 - top0
        const i = idx.find((j) => y >= pages[j].top && y < pages[j].bottom)
        if (i !== undefined) out[i] += ch
      }
    }
  }
  return out
}

/** 넘겨받은 파일 내용을 꺼내고 상자는 비워요 (부르는 쪽이 붙잡고 있지 않게) */
function take(input: { data: Uint8Array | null }): Uint8Array {
  const d = input.data
  input.data = null
  if (!d) throw new ConvertError('broken')
  return d
}

/**
 * input.data: 워드 파일 내용. 읽고 나면 비워요 (큰 파일을 여러 벌 들고 있지 않게)
 */
export async function convertDocx(input: { data: Uint8Array | null }, out: RasterPdf, hooks: ConvertHooks): Promise<void> {
  const signal = hooks.signal
  let lib: Libs
  try {
    lib = await loadDocxLibs()
  } catch {
    throw new ConvertError('failed', '워드 변환 도구를 받지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.')
  }
  throwIfAborted(signal)
  let prep: DocxPrep
  try {
    prep = await prepareDocx(take(input), lib.JSZip, signal)
  } catch (e) {
    if (signal?.aborted) throw abortReason(signal)
    console.warn('[convert] 워드 파일 읽기 실패', e)
    throw new ConvertError('broken')
  }
  // 워드가 센 쪽수가 이미 한도를 넘으면 그리기 전에 알려 줘요 (쪽 나누기도 워드 쪽수에 맞춰요)
  if (prep.wordPages !== null && prep.wordPages > MAX_PAGES) throw tooManyPages(prep.wordPages)
  await breathe()
  throwIfAborted(signal)
  const { frame, doc, win } = makeFrame()
  const bandCache = new Map<string, Bands & { scale: number }>()
  try {
    // 배치는 iframe 안에서, 글자 그리기는 html2canvas 가 바깥 화면의 캔버스로 해요. 두 곳 모두 등록해야
    // 글자 폭이 맞아요 (한쪽만 하면 띄어쓰기·마침표 자리가 어긋나요)
    let [fontsOk, mainOk] = await Promise.all([ensureFonts(doc), ensureFonts()])
    // 한쪽만 됐으면 한 번 더 (못 받은 쪽만 다시 받아요)
    if (fontsOk !== mainOk) [fontsOk, mainOk] = await Promise.all([ensureFonts(doc), ensureFonts()])
    if (fontsOk && !mainOk) {
      // 그리는 쪽(화면)에 글꼴이 없으면 배치도 기기 글꼴로 해야 글자 자리가 맞아요
      try {
        doc.fonts.clear()
      } catch {
        // 못 지우면 그대로 (안내는 아래에서 해요)
      }
      fontsOk = false
    }
    // html2canvas 복제본도 배치한 iframe 과 같게 (iframe 이 기기 글꼴이면 복제본에도 대체 글꼴을 붙이지 않아요)
    const cloneFonts = fontsOk
    if (!fontsOk || !mainOk) hooks.warn('글꼴을 받지 못해서 휴대폰 기본 글꼴로 그렸어요. 글자 모양이 원본과 다를 수 있어요.')
    const opts = {
      inWrapper: true,
      breakPages: true,
      // 워드의 쪽 넘김 표시는 docxPrep 에서 책갈피로 바꿔 두었어요. 여기서는 진짜 쪽 나눔만 따라요
      ignoreLastRenderedPageBreak: false,
      experimental: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      renderComments: false,
      renderChanges: false,
      // 워드 파일 안의 HTML 조각(altChunk)은 그리지 않아요. 그리면 그 안의 스크립트가 앱 주소에서 실행될 수 있어요
      renderAltChunks: false,
    }
    const host = doc.createElement('div')
    doc.body.appendChild(host)
    // 머리말 틀을 만들 때 다시 쓰는 읽은 문서 (틀이 필요 없으면 바로 놓아줘요)
    let wd: WordDoc | null = null
    let need: HfNeed | null = null
    let restoreStyles: (() => void) | null = null
    try {
      // renderAsync 와 같은 일을 하되, 그리기 전에 문서를 손봐요 (Uint8Array 를 그대로 넘겨요: Blob 으로 한 번 더 복사하지 않게)
      wd = await lib.parseAsync(prep.data, opts)
      prep.data = new Uint8Array(0)
      need = templateNeed(wd, prep)
      patchDocument(wd)
      patchLineSpacing(wd)
      if (need) restoreStyles = keepStyles(wd)
      const nodes = await lib.renderDocument(wd, opts)
      for (const n of nodes) host.appendChild(n)
      // 탭 위치는 docx-preview 가 0.5초 뒤에 다시 재요. 그 전에(지금 바로) 줄 간격·글자 폭을 고쳐야 해요
      applyWordMetrics(host, win, { latinFont: prep.latinFont, eastAsiaFont: prep.eastAsiaFont, korean: prep.korean })
      // 배치(iframe)에 대체 글꼴이 없으면 이름도 바꾸지 않아요. 바꾸면 iframe 은 기기 글꼴로 배치하는데
      // html2canvas 는 대체 글꼴이 있는 바깥 화면에서 그 이름으로 그려서 글자 자리가 어긋나요
      if (fontsOk) rewriteFonts(host)
    } catch (e) {
      if (signal?.aborted) throw abortReason(signal)
      console.warn('[convert] 워드 그리기 실패', e)
      throw new ConvertError('broken')
    }
    // 보이는 머리말·꼬리말이 하나도 없으면 틀이 필요 없어요
    if (need && !hasVisibleHf(host)) need = null
    // 읽은 문서는 워드 파일 내용(그림 포함)을 붙잡고 있어요. 머리말 틀이 필요 없으면 바로 놓아줘요
    if (!need) {
      wd = null
      restoreStyles = null
    }
    hooks.ready()
    await settle(doc, signal)
    await shrinkImages(doc, signal)

    // 쪽 나누기
    const sections = Array.from(host.querySelectorAll<HTMLElement>('section.docx'))
    if (sections.length === 0) throw new ConvertError('broken')
    const geos: SectionGeo[] = []
    for (const s of sections) {
      geos.push(measureSection(s, win))
      await breathe()
      throwIfAborted(signal)
    }
    const plan: Plan = planPages(geos, prep.wordPages)
    await breathe()
    throwIfAborted(signal)
    alignSplitCells(plan.pages)
    const total = plan.pages.length
    if (import.meta.env.DEV) {
      // 개발할 때만: 시험 스크립트가 쪽 나누기 결과를 볼 수 있게
      ;(window as unknown as { __docxDebug?: unknown }).__docxDebug = {
        word: prep.wordPages,
        marks: prep.marks,
        geo: geos.map((g) => ({ h: Math.round(g.end - g.bodyTop), body: Math.round(g.bodyH), marks: g.marks.map((m) => `${Math.round(m.y - g.bodyTop)}${m.weak ? 'w' : ''}`) })),
        cap: plan.cap,
        useMarks: plan.useMarks,
        used: plan.usedMarks,
        minScale: Math.round(plan.minScale * 100) / 100,
        cuts: plan.pages.map((p) => Math.round(p.bottom - p.top)),
        text: (window as unknown as { __docxDebugText?: boolean }).__docxDebugText ? pageTexts(plan.pages) : undefined,
        atoms: (window as unknown as { __docxDebugAtoms?: boolean }).__docxDebugAtoms
          ? geos.map((g) => ({ top: g.bodyTop, end: g.end, atoms: g.atoms.map(([a, b]) => [Math.round(a * 10) / 10, Math.round(b * 10) / 10]), ink: g.ink.map(([a, b]) => [Math.round(a), Math.round(b)]), tables: g.tables, rowTops: g.rowTops.slice(-3) }))
          : undefined,
        slices: plan.pages.map((p) => [Math.round(p.top * 10) / 10, Math.round(p.bottom * 10) / 10]),
      }
    }
    if (total === 0) throw new ConvertError('broken', '문서에 내용이 없어요. 워드에서 내용을 확인하고 저장한 뒤 다시 올려 주세요.')
    // 너무 길어서 끝까지 나누지 않았으면 쪽수를 정확히 몰라요
    if (total > MAX_PAGES) throw plan.truncated ? new ConvertError('too-many-pages') : tooManyPages(total)
    if (plan.matched === false && prep.wordPages !== null)
      hooks.warn(`워드에서는 ${prep.wordPages}쪽인데 ${total}쪽으로 바뀌었어요. 글꼴이 달라서 그래요. 미리보기로 확인해 주세요.`)
    if (plan.matched === null && prep.marks === 0 && total > sections.length)
      hooks.warn('쪽 나눔 정보가 없는 파일이라 자동으로 쪽을 나눴어요. 원본과 쪽 나눔이 조금 다를 수 있어요.')
    if (plan.minScale < 0.88) hooks.warn('원본과 쪽을 맞추려고 몇 쪽은 글자를 조금 줄여 담았어요.')
    if (plan.forced) hooks.warn('한 쪽보다 큰 그림이나 표 칸은 잘라서 여러 쪽에 나눠 담았어요.')

    // 머리말·꼬리말: 필요하면 쪽마다 고를 틀을 그려 둬요 (읽어 둔 문서를 다시 써요. 파일을 다시 읽지 않아요)
    let hf: HfTemplates | null = null
    if (need && wd && hasVisibleHf(host)) {
      try {
        restoreStyles?.()
        hf = await buildHfTemplates(lib, wd, need, prep, opts, doc, win, fontsOk, signal)
      } catch (e) {
        if (signal?.aborted) throw abortReason(signal)
        console.warn('[convert] 머리말 틀 그리기 실패', e)
        hf = null
      }
    }
    wd = null
    restoreStyles = null
    // 틀이 없으면 쪽 번호 자리 글자가 그대로 보이지 않게
    if (!hf && prep.pageFields) for (const sec of sections) fillTokens(sec, total)
    // 쪽마다: 어느 틀(워드 구역 × 첫 쪽/짝수/기본)을 쓰고 쪽 번호가 몇인지
    const pick: { index: number; page: number }[] = []
    if (hf) {
      const props = hf.props
      const startOf = sections.map(() => ({ s: 0, first: false }))
      let ws = 0
      let fresh = true
      sections.forEach((sec, e) => {
        startOf[e] = { s: Math.min(ws, props.length - 1), first: fresh }
        const ends = sec.querySelectorAll(`span[id^="${SECTION_END}"]`).length
        ws += ends
        fresh = ends > 0
      })
      const firstPageOf = new Map<number, number>()
      plan.pages.forEach((sl, i) => {
        const e = sections.indexOf(sl.section)
        const { s, first } = startOf[e]
        const firstOfElement = i === 0 || plan.pages[i - 1].section !== sl.section
        if (!firstPageOf.has(s)) firstPageOf.set(s, i)
        const start = props[s].pageNumber?.start
        const page = typeof start === 'number' && Number.isFinite(start) ? start + (i - (firstPageOf.get(s) ?? i)) : i + 1
        const v = props[s].titlePage && first && firstOfElement ? 'first' : hf!.evenOdd && page % 2 === 0 ? 'even' : 'default'
        pick.push({ index: s * VARIANTS.length + VARIANTS.indexOf(v), page })
      })
    }

    const ladder = new ScaleLadder()
    const cacheable = !hf || !prep.pageFields
    for (let i = 0; i < total; i++) {
      throwIfAborted(signal)
      hooks.page(i + 1, total)
      await breathe()
      const sl = plan.pages[i]
      const g = geos[sections.indexOf(sl.section)]
      const jpeg = await rasterize(ladder, async (scale) => {
        const key = hf ? `t${pick[i].index}` : `s${sections.indexOf(sl.section)}`
        let bands = cacheable ? bandCache.get(key) : undefined
        if (!bands || bands.scale !== scale) {
          releaseBands(bands)
          bandCache.delete(key)
          bands = { ...(hf ? await templateBands(lib, hf, host, pick[i].index, pick[i].page, total, scale, cloneFonts) : await sectionBands(lib, g, scale, cloneFonts)), scale }
          if (cacheable) bandCache.set(key, bands)
        }
        try {
          return await drawPage(lib, g, sl.top, sl.bottom, sl.fit ?? sl.bottom - sl.top, bands, scale, cloneFonts)
        } finally {
          if (!cacheable) releaseBands(bands)
        }
      })
      await out.addJpeg(jpeg, g.pageW * 0.75, g.pageH * 0.75)
    }
    hooks.warn('워드 파일은 원본과 글꼴이 조금 달라요. 미리보기로 꼭 확인해 주세요.')
  } finally {
    // 머리말·꼬리말 띠 캔버스는 실패·취소했을 때도 바로 돌려줘요 (iOS 는 캔버스 메모리가 늦게 풀려요)
    for (const b of bandCache.values()) releaseBands(b)
    bandCache.clear()
    // docx-preview 가 그림마다 만든 blob 주소를 돌려줘요 (안 하면 사진이 많은 문서를 바꿀 때마다 메모리에 쌓여요)
    for (const url of blobUrls(doc)) URL.revokeObjectURL(url)
    if (!(import.meta.env.DEV && (window as unknown as { __docxDebugKeep?: boolean }).__docxDebugKeep)) frame.remove()
  }
}

/** root 안에서 쓰는 blob: 주소 (그림 src, SVG <image href>, 스타일 안의 url(...)) */
function blobUrls(root: Document | Element): Set<string> {
  const out = new Set<string>()
  try {
    for (const el of Array.from(root.querySelectorAll('[src^="blob:"], [href^="blob:"]'))) {
      for (const a of ['src', 'href']) {
        const v = el.getAttribute(a)
        if (v?.startsWith('blob:')) out.add(v)
      }
    }
    // docx-preview 는 SVG <image> 에 href 를 붙여요. 옛 방식(xlink:href)도 봐요
    for (const el of Array.from(root.querySelectorAll('image'))) {
      const v = el.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
      if (v?.startsWith('blob:')) out.add(v)
    }
    for (const el of Array.from(root.querySelectorAll('style, [style*="blob:"]'))) {
      const text = el.tagName === 'STYLE' ? (el.textContent ?? '') : (el.getAttribute('style') ?? '')
      for (const m of text.matchAll(/blob:[^"')\s]+/g)) out.add(m[0])
    }
  } catch {
    // 정리하다 실패해도 변환 결과에는 영향이 없어요
  }
  return out
}
