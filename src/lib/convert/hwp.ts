/**
 * 한글(.hwp·.hwpx) → 쪽 그림 → PDF  (@rhwp/core: Rust+WebAssembly 한글 엔진, MIT)
 * - 엔진 파일(wasm)이 커서(약 28MB, 압축하면 약 11MB) 한글 파일을 바꿀 때만 받아요.
 * - 꼭 renderPageToCanvas 로 그려요. SVG 를 그림으로 바꾸는 방법은 SVG 안에서 웹 글꼴이 안 먹어서 글자가 달라져요.
 */
import wasmUrl from '@rhwp/core/rhwp_bg.wasm?url'
import { ConvertError, tooManyPages } from './errors'
import { ensureFonts, mapCanvasFont, withMappedCanvasFonts } from './fonts'
import type { RasterPdf } from './pdfkit'
import { breathe, capScale, rasterize, ScaleLadder, whiteBehind } from './raster'
import { MAX_PAGES } from './types'

type Rhwp = typeof import('@rhwp/core')

let engine: Promise<Rhwp> | null = null

/** 엔진이 글자 폭을 잴 때 부르는 함수 (브라우저 캔버스로 재요. 글꼴 이름은 대체 글꼴로 바꿔서 그릴 때와 똑같이) */
let measureCtx: CanvasRenderingContext2D | null = null
let measureFont = ''

function installMeasure(): void {
  const g = globalThis as typeof globalThis & { measureTextWidth?: (font: string, text: string) => number }
  if (g.measureTextWidth) return
  g.measureTextWidth = (font: string, text: string) => {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
    if (!measureCtx) return text.length * 10
    if (font !== measureFont) {
      measureCtx.font = mapCanvasFont(font)
      measureFont = font
    }
    return measureCtx.measureText(text).width
  }
}

/** 글꼴을 새로 받은 뒤에는 글자 폭을 처음부터 다시 재게 해요 (예전 글꼴로 잰 값이 남지 않게) */
function resetMeasure(): void {
  measureCtx = null
  measureFont = ''
}

/** 한글 엔진 받기·준비 (한 번만) */
export function loadRhwp(): Promise<Rhwp> {
  if (!engine) {
    engine = (async () => {
      const mod = await import('@rhwp/core')
      installMeasure()
      await mod.default({ module_or_path: wasmUrl })
      return mod
    })().catch((e: unknown) => {
      engine = null
      throw e
    })
  }
  return engine
}

/** 엔진이 내는 오류 문장으로 암호 문서인지 가려요 */
function toOpenError(e: unknown): ConvertError {
  const msg = e instanceof Error ? e.message : String(e)
  if (/암호|password|encrypt|crypt|배포용|distribut/i.test(msg)) return new ConvertError('encrypted')
  return new ConvertError('broken')
}

type PageInfo = { width: number; height: number }

/**
 * 한글 엔진은 '진하게'를 글자 위에 얇은 테두리(strokeText)를 한 번 더 그려서 흉내 내요.
 * 그런데 그 테두리가 화소 1개보다 얇아서, 크롬(안드로이드)에서는 거의 안 보여 진한 글자가 보통 글자처럼 나와요.
 * 그래서 그리는 동안만 테두리를 1.5배로 두껍게 해요 (사파리와 크롬 결과가 비슷해져요).
 * fn 은 동기 함수여야 해요 (그동안 앱의 다른 캔버스는 그리지 않아요).
 */
const FAUX_BOLD_GAIN = 1.5

function withSteadyFauxBold<T>(fn: () => T): T {
  const proto = typeof CanvasRenderingContext2D === 'function' ? CanvasRenderingContext2D.prototype : null
  const own = proto ? Object.getOwnPropertyDescriptor(proto, 'strokeText') : undefined
  const orig = own?.value as CanvasRenderingContext2D['strokeText'] | undefined
  if (!proto || !own || typeof orig !== 'function') return fn()
  Object.defineProperty(proto, 'strokeText', {
    ...own,
    value(this: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number) {
      this.save()
      try {
        this.lineWidth = this.lineWidth * FAUX_BOLD_GAIN
        if (maxWidth === undefined) orig.call(this, text, x, y)
        else orig.call(this, text, x, y, maxWidth)
      } finally {
        this.restore()
      }
    },
  })
  try {
    return fn()
  } finally {
    Object.defineProperty(proto, 'strokeText', own)
  }
}

/** 인쇄할 때처럼 그리게 해요 (바탕쪽을 흐리게 하거나 문단 부호·투명 선을 그리지 않게). 엔진 기본값도 같지만 확실하게 */
function printLook(doc: InstanceType<Rhwp['HwpDocument']>): void {
  const settings: [string, boolean][] = [
    ['setDimMasterPages', false],
    ['setShowControlCodes', false],
    ['setShowParagraphMarks', false],
    ['setShowTransparentBorders', false],
  ]
  const d = doc as unknown as Record<string, unknown>
  for (const [name, on] of settings) {
    try {
      const fn = d[name]
      if (typeof fn === 'function') (fn as (v: boolean) => void).call(doc, on)
    } catch {
      // 없는 기능이면 넘어가요
    }
  }
}

export async function convertHwp(
  bytes: Uint8Array,
  out: RasterPdf,
  hooks: { ready: () => void; page: (page: number, pages: number) => void; warn: (w: string) => void },
): Promise<void> {
  let mod: Rhwp
  let fontsOk: boolean
  try {
    ;[mod, fontsOk] = await Promise.all([loadRhwp(), ensureFonts()])
  } catch {
    throw new ConvertError('failed', '한글 변환 엔진을 받지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.')
  }
  if (!fontsOk) hooks.warn('글꼴을 받지 못해서 휴대폰 기본 글꼴로 그렸어요. 글자 모양이 원본과 다를 수 있어요.')
  resetMeasure()
  hooks.ready()

  let doc: InstanceType<Rhwp['HwpDocument']>
  try {
    doc = withMappedCanvasFonts(() => new mod.HwpDocument(bytes))
  } catch (e) {
    throw toOpenError(e)
  }
  try {
    printLook(doc)
    let pages: number
    try {
      pages = doc.pageCount()
    } catch (e) {
      throw toOpenError(e)
    }
    if (!(pages > 0)) throw new ConvertError('broken')
    if (pages > MAX_PAGES) throw tooManyPages(pages)

    const ladder = new ScaleLadder()
    for (let i = 0; i < pages; i++) {
      hooks.page(i + 1, pages)
      await breathe()
      let info: PageInfo
      try {
        info = JSON.parse(doc.getPageInfo(i)) as PageInfo
      } catch (e) {
        throw toOpenError(e)
      }
      const jpeg = await rasterize(ladder, (scale) => {
        const canvas = document.createElement('canvas')
        const s = capScale(info.width, info.height, scale)
        withMappedCanvasFonts(() => withSteadyFauxBold(() => doc.renderPageToCanvas(i, canvas, s)))
        whiteBehind(canvas)
        return canvas
      })
      // 엔진의 쪽 크기는 96dpi 화소 → pt 는 0.75 배
      await out.addJpeg(jpeg, info.width * 0.75, info.height * 0.75)
    }
  } finally {
    try {
      doc.free()
    } catch {
      // 이미 풀렸으면 괜찮아요
    }
  }
}
