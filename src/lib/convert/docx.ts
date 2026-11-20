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
import { ConvertError, tooManyPages } from './errors'
import { prepareDocx, type DocxPrep } from './docxPrep'
import { applyWordMetrics, patchLineSpacing } from './docxLayout'
import { alignSplitCells, cutLines, headAt, HEADER_ROW, insideTable, measureSection, planPages, type CutLine, type Plan, type SectionGeo } from './docxPaginate'
import { ensureFonts, isHeavyFamily, mapFamilyList, SANS_FAMILY } from './fonts'
import type { RasterPdf } from './pdfkit'
import { breathe, capScale, rasterize, releaseCanvas, ScaleLadder, whiteBehind } from './raster'
import { MAX_PAGES } from './types'

type Libs = {
  parseAsync: typeof import('docx-preview').parseAsync
  renderDocument: typeof import('docx-preview').renderDocument
  html2canvas: typeof import('html2canvas-pro').default
  JSZip: typeof import('jszip')
}

let libs: Promise<Libs> | null = null

export function loadDocxLibs(): Promise<Libs> {
  if (!libs) {
    libs = Promise.all([import('docx-preview'), import('html2canvas-pro'), import('jszip')])
      .then(([dp, h2c, jz]) => ({
        parseAsync: dp.parseAsync,
        renderDocument: dp.renderDocument,
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
    const nextType = (i + 1 < ends.length ? ends[i + 1].sectionProps : body.props)?.type
    if (nextType === 'continuous') return
    p.children = [...(p.children ?? []), { type: 'run', children: [{ type: 'break', break: 'page' } as DocNode] }]
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
 * html2canvas 설정. html2canvas 는 문서를 복제해서 다시 배치한 뒤 그리는데,
 * 자바스크립트로 등록한 글꼴(FontFace)은 복제본에 따라가지 않아요. 그래서 복제본에도 글꼴을 등록하고
 * 다 받은 뒤에 그리게 해요 (안 하면 줄바꿈·띄어쓰기가 원래 배치와 달라져요)
 */
function shotOptions(scale: number, crop: { x: number; y: number; width: number; height: number }) {
  return {
    scale,
    backgroundColor: '#ffffff',
    logging: false,
    onclone: async (clone: Document) => {
      await ensureFonts(clone)
    },
    ...crop,
  }
}

/** 머리말·꼬리말 띠 (모든 쪽에 같은 그림을 붙여요) */
type Band = { canvas: HTMLCanvasElement; y: number; h: number; scale: number }

function hasVisible(el: Element | undefined): el is HTMLElement {
  return !!el && ((el.textContent ?? '').replace(/[\s​]/g, '') !== '' || el.querySelector('img, svg, canvas') !== null)
}

async function shotBand(lib: Libs, g: SectionGeo, top: number, h: number, scale: number): Promise<Band | null> {
  if (h <= 1) return null
  const canvas = await lib.html2canvas(g.section, shotOptions(scale, { x: 0, y: top, width: Math.ceil(g.pageW), height: Math.ceil(h) }))
  return { canvas, y: top, h, scale }
}

/** 쪽 하나를 그려요: 본문 부분을 떠서 원래 쪽 크기 캔버스의 본문 자리에 붙여요 (넘치면 줄여서) */
async function drawPage(
  lib: Libs,
  g: SectionGeo,
  top: number,
  bottom: number,
  fit: number,
  bands: { header: Band | null; footer: Band | null; footerTop: number },
  scaleWanted: number,
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
  const part = await lib.html2canvas(
    g.section,
    shotOptions(s, { x: 0, y: Math.max(0, top - padT), width: Math.ceil(cropW), height: Math.ceil(h + padT + padB) }),
  )
  let headPart: HTMLCanvasElement | null = null
  try {
    // 표가 앞 쪽에서 이어지면 머리글 줄을 맨 위에 다시 그려요 (워드의 '머리글 행 반복')
    if (head) headPart = await lib.html2canvas(g.section, shotOptions(s, { x: 0, y: head.top, width: Math.ceil(cropW), height: Math.ceil(headH) }))
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
    c.save()
    c.beginPath()
    // 본문 자리 밖(머리말·꼬리말 자리)으로 삐져나오지 않게
    c.rect(0, (bodyY - (headPart ? 0 : pad)) * s, canvas.width, (Math.min(g.bodyH - headH * k, h * k) + pad * 2) * s)
    c.clip()
    c.drawImage(part, dx * s, (bodyY - offTop * k) * s, part.width * k, part.height * k)
    c.restore()
    // 쪽 경계에서 나뉜 표 줄은 칸 테두리를 닫아 줘요
    const line = (l: CutLine, y: number, below: boolean) => {
      c.fillStyle = l.color
      const w = Math.max(1, l.width * k * s)
      c.fillRect((dx + l.x0 * k) * s, y * s - (below ? 0 : w), (l.x1 - l.x0) * k * s, w)
    }
    if (top > g.bodyTop + 1) for (const l of cutLines(g.section, top, 'top')) line(l, bodyY, true)
    if (bottom < g.end - 1) for (const l of cutLines(g.section, bottom, 'bottom')) line(l, bodyY + Math.min(h * k, g.bodyH - headH * k), false)
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
        if (/\s|​/.test(ch)) continue
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

export async function convertDocx(
  file: Blob,
  out: RasterPdf,
  hooks: { ready: () => void; page: (page: number, pages: number) => void; warn: (w: string) => void },
): Promise<void> {
  let lib: Libs
  try {
    lib = await loadDocxLibs()
  } catch {
    throw new ConvertError('failed', '워드 변환 도구를 받지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.')
  }
  let prep: DocxPrep
  try {
    prep = await prepareDocx(file, lib.JSZip)
  } catch (e) {
    console.warn('[convert] 워드 파일 읽기 실패', e)
    throw new ConvertError('broken')
  }
  const { frame, doc, win } = makeFrame()
  try {
    // 배치는 iframe 안에서, 글자 그리기는 html2canvas 가 바깥 화면의 캔버스로 해요. 두 곳 모두 등록해야
    // 글자 폭이 맞아요 (한쪽만 하면 띄어쓰기·마침표 자리가 어긋나요)
    const [fontsOk, mainOk] = await Promise.all([ensureFonts(doc), ensureFonts()])
    if (!fontsOk || !mainOk) hooks.warn('글꼴을 받지 못해서 휴대폰 기본 글꼴로 그렸어요. 글자 모양이 원본과 다를 수 있어요.')
    const host = doc.createElement('div')
    doc.body.appendChild(host)
    try {
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
      }
      // renderAsync 와 같은 일을 하되, 그리기 전에 문서를 손봐요
      const wd = await lib.parseAsync(new Blob([prep.data as BlobPart]), opts)
      patchDocument(wd)
      patchLineSpacing(wd)
      const nodes = await lib.renderDocument(wd, opts)
      for (const n of nodes) host.appendChild(n)
      // 탭 위치는 docx-preview 가 0.5초 뒤에 다시 재요. 그 전에(지금 바로) 줄 간격·글자 폭을 고쳐야 해요
      applyWordMetrics(host, win, { latinFont: prep.latinFont, eastAsiaFont: prep.eastAsiaFont, korean: prep.korean })
      rewriteFonts(host)
    } catch (e) {
      console.warn('[convert] 워드 그리기 실패', e)
      throw new ConvertError('broken')
    }
    hooks.ready()
    await new Promise((r) => setTimeout(r, 650))
    await doc.fonts.ready
    await Promise.all(Array.from(doc.images, (img) => (img.complete ? null : img.decode().catch(() => undefined))))

    // 쪽 나누기
    const sections = Array.from(host.querySelectorAll<HTMLElement>('section.docx'))
    if (sections.length === 0) throw new ConvertError('broken')
    const geos = sections.map((s) => measureSection(s, win))
    const plan: Plan = planPages(geos, prep.wordPages)
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
      }
    }
    if (total === 0) throw new ConvertError('broken')
    if (total > MAX_PAGES) throw tooManyPages(total)
    if (plan.matched === false && prep.wordPages !== null)
      hooks.warn(`워드에서는 ${prep.wordPages}쪽인데 ${total}쪽으로 바뀌었어요. 글꼴이 달라서 그래요. 미리보기로 확인해 주세요.`)
    if (plan.matched === null && prep.marks === 0 && total > sections.length)
      hooks.warn('쪽 나눔 정보가 없는 파일이라 자동으로 쪽을 나눴어요. 원본과 쪽 나눔이 조금 다를 수 있어요.')
    if (plan.minScale < 0.88) hooks.warn('원본과 쪽을 맞추려고 몇 쪽은 글자를 조금 줄여 담았어요.')
    if (plan.forced) hooks.warn('한 쪽보다 큰 그림이나 표 칸은 잘라서 여러 쪽에 나눠 담았어요.')

    const ladder = new ScaleLadder()
    const bandCache = new Map<SectionGeo, { header: Band | null; footer: Band | null; footerTop: number }>()
    for (let i = 0; i < total; i++) {
      hooks.page(i + 1, total)
      await breathe()
      const sl = plan.pages[i]
      const g = geos[sections.indexOf(sl.section)]
      const jpeg = await rasterize(ladder, async (scale) => {
        let bands = bandCache.get(g)
        if (!bands || (bands.header && bands.header.scale !== scale) || (bands.footer && bands.footer.scale !== scale)) {
          if (bands?.header) releaseCanvas(bands.header.canvas)
          if (bands?.footer) releaseCanvas(bands.footer.canvas)
          const header = Array.from(g.section.children).find((c) => c.tagName === 'HEADER')
          const footer = Array.from(g.section.children).find((c) => c.tagName === 'FOOTER')
          const secTop = g.section.getBoundingClientRect().top
          const secH = g.section.getBoundingClientRect().height
          let footerTop = secH
          if (hasVisible(footer)) footerTop = Math.min(footer.getBoundingClientRect().top - secTop, secH - (g.pageH - g.bodyTop - g.bodyH))
          const s = capScale(g.pageW, g.pageH, scale)
          bands = {
            header: hasVisible(header) ? await shotBand(lib, g, 0, g.bodyTop, s) : null,
            footer: footerTop < secH ? await shotBand(lib, g, footerTop, secH - footerTop, s) : null,
            footerTop,
          }
          bandCache.set(g, bands)
        }
        return drawPage(lib, g, sl.top, sl.bottom, sl.fit ?? sl.bottom - sl.top, bands, scale)
      })
      await out.addJpeg(jpeg, g.pageW * 0.75, g.pageH * 0.75)
    }
    for (const b of bandCache.values()) {
      if (b.header) releaseCanvas(b.header.canvas)
      if (b.footer) releaseCanvas(b.footer.canvas)
    }
    hooks.warn('워드 파일은 원본과 글꼴이 조금 달라요. 미리보기로 꼭 확인해 주세요.')
  } finally {
    frame.remove()
  }
}
