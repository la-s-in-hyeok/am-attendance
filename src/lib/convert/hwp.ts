/**
 * 한글(.hwp·.hwpx) → 쪽 그림 → PDF  (@rhwp/core: Rust+WebAssembly 한글 엔진, MIT)
 * - 엔진 파일(wasm)이 커서(약 28MB, 압축하면 약 11MB) 한글 파일을 바꿀 때만 받아요.
 * - 꼭 renderPageToCanvas 로 그려요. SVG 를 그림으로 바꾸는 방법은 SVG 안에서 웹 글꼴이 안 먹어서 글자가 달라져요.
 */
import wasmUrl from '@rhwp/core/rhwp_bg.wasm?url'
import { ConvertError, throwIfAborted, tooManyPages, type ConvertHooks } from './errors'
import { ensureFonts, mapCanvasFont, withMappedCanvasFonts } from './fonts'
import type { RasterPdf } from './pdfkit'
import { breathe, capScale, rasterize, ScaleLadder, whiteBehind } from './raster'
import { MAX_PAGES } from './types'

type Rhwp = typeof import('@rhwp/core')

let engine: Promise<Rhwp> | null = null
/** 엔진·글꼴을 받는 동안 기다릴 수 있는 시간 (약 11MB 를 아주 느린 인터넷(초당 15KB 정도)으로 받아도 되게) */
const ENGINE_LOAD_MS = 15 * 60 * 1000
/**
 * 엔진이 한 번 멈추면(WebAssembly 오류) 그 엔진은 다시 쓸 수 없어요. 다시 띄우려 해도 같은 것을 돌려줘서
 * (wasm-bindgen 이 한 번 띄운 엔진을 기억해요) 화면을 새로 고쳐야 해요
 */
let engineBroken = false

const engineCrashed = () =>
  new ConvertError('failed', '한글 변환 엔진이 멈췄어요. 앱 화면을 새로 고친 뒤(앱을 껐다 켜도 돼요) 다시 해 주세요.')

/** WebAssembly 안에서 난 오류(엔진이 멈춤)인지 */
function isEngineCrash(e: unknown): boolean {
  return typeof WebAssembly !== 'undefined' && typeof WebAssembly.RuntimeError === 'function' && e instanceof WebAssembly.RuntimeError
}

/**
 * 배율을 낮추면 될 수도 있는 오류인지 (캔버스를 못 만들었거나 메모리가 모자람).
 * 엔진이 '이 쪽을 못 그려요' 하고 내는 오류는 배율을 낮춰도 같아서 손상된 파일로 알려요
 */
function isMemoryLike(e: unknown): boolean {
  if (e instanceof RangeError) return true
  if (typeof DOMException === 'function' && e instanceof DOMException) return true
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : null
  // 엔진이 문장 없는 것을 던지면 무슨 오류인지 몰라서 예전처럼 다시 해 봐요
  if (msg === null) return true
  // ('out of memory' 는 memory 로 잡혀요. 'index out of range' 같은 엔진 오류는 다시 해도 같아서 넣지 않아요)
  return /memory|alloc|canvas|context|too large|limit|메모리/i.test(msg)
}

function markBroken(e: unknown): void {
  console.warn('[convert] 한글 엔진 멈춤', e)
  engineBroken = true
  engine = null
  resetMeasure()
}

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
      // 미리 받기가 아직 진행 중이면 끝나기를 기다려요 (같은 28MB 를 두 번 받지 않게. 끝나면 캐시에서 바로 읽어요)
      await prefetching?.catch(() => undefined)
      await mod.default({ module_or_path: wasmUrl })
      return mod
    })().catch((e: unknown) => {
      engine = null
      throw e
    })
  }
  return engine
}

/**
 * 엔진 파일(wasm)만 받아 둬요 (띄우지는 않아요). 서비스 워커·브라우저 캐시에 들어가서 나중에 바로 띄울 수 있어요.
 * 받은 내용은 조금씩 읽고 버려서 메모리를 거의 쓰지 않아요
 */
let prefetching: Promise<void> | null = null

export function prefetchRhwp(): Promise<void> {
  if (engine) return Promise.resolve()
  if (!prefetching) {
    prefetching = (async () => {
      const res = await fetch(wasmUrl)
      const reader = res.body?.getReader()
      if (!reader) {
        await res.arrayBuffer()
        return
      }
      for (;;) if ((await reader.read()).done) break
    })().catch((e: unknown) => {
      prefetching = null
      throw e
    })
  }
  return prefetching
}

/** 엔진이 내는 오류 문장으로 암호 문서인지 가려요 */
function toOpenError(e: unknown): ConvertError {
  if (isEngineCrash(e)) {
    // 망가진 파일을 읽다가 엔진이 멈췄어요. 이 엔진은 다시 못 써요
    markBroken(e)
    return new ConvertError('broken')
  }
  const msg = e instanceof Error ? e.message : String(e)
  if (/암호|password|encrypt|crypt|배포용|distribut/i.test(msg)) return new ConvertError('encrypted')
  return new ConvertError('broken')
}

type PageInfo = { width: number; height: number }

/** 쪽 크기가 말이 되는지 (CSS 화소. 엔진이 NaN·0 을 주는 망가진 파일이 있어요) */
const sizeOk = (w: number, h: number) => Number.isFinite(w) && Number.isFinite(h) && w >= 10 && h >= 10 && w <= 20000 && h <= 20000

/** 쪽 크기를 모를 때 쓰는 A4 (96dpi 화소) */
const A4_PX = { width: 793.7, height: 1122.5 }

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

export async function convertHwp(bytes: Uint8Array, out: RasterPdf, hooks: ConvertHooks): Promise<void> {
  if (engineBroken) throw engineCrashed()
  let mod: Rhwp
  let fontsOk: boolean
  // 엔진(약 28MB)을 처음 받을 때는 느린 인터넷에서 몇 분 걸려요. 받는 동안에는 진행 알림이 없어서 넉넉히 기다려요
  // (다 받으면 hooks.ready() 가 평소 기준으로 되돌려요)
  hooks.allow?.(ENGINE_LOAD_MS)
  try {
    ;[mod, fontsOk] = await Promise.all([loadRhwp(), ensureFonts()])
  } catch {
    throw new ConvertError('failed', '한글 변환 엔진을 받지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.')
  }
  if (!fontsOk) hooks.warn('글꼴을 받지 못해서 휴대폰 기본 글꼴로 그렸어요. 글자 모양이 원본과 다를 수 있어요.')
  throwIfAborted(hooks.signal)
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
      throwIfAborted(hooks.signal)
      hooks.page(i + 1, pages)
      await breathe()
      let info: PageInfo
      try {
        info = JSON.parse(doc.getPageInfo(i)) as PageInfo
      } catch (e) {
        throw toOpenError(e)
      }
      // 쪽 크기를 못 읽으면 그린 캔버스 크기로 알아내요 (그것도 안 되면 손상된 파일)
      let size = sizeOk(Number(info?.width), Number(info?.height)) ? { width: Number(info.width), height: Number(info.height) } : null
      const jpeg = await rasterize(ladder, (scale) => {
        const canvas = document.createElement('canvas')
        const s = capScale(size?.width ?? A4_PX.width, size?.height ?? A4_PX.height, scale)
        try {
          withMappedCanvasFonts(() => withSteadyFauxBold(() => doc.renderPageToCanvas(i, canvas, s)))
        } catch (e) {
          // 엔진이 멈춘 것은 배율을 낮춰도 안 돼요. 캔버스·메모리 문제만 다시 해 봐요
          if (isEngineCrash(e)) {
            markBroken(e)
            throw engineCrashed()
          }
          if (isMemoryLike(e)) throw e
          console.warn('[convert] 한글 쪽 그리기 실패', e)
          throw new ConvertError('broken')
        }
        if (!size) {
          const w = canvas.width / s
          const h = canvas.height / s
          if (!sizeOk(w, h)) throw new ConvertError('broken')
          size = { width: w, height: h }
        }
        whiteBehind(canvas)
        return canvas
      })
      if (!size) throw new ConvertError('broken')
      // 엔진의 쪽 크기는 96dpi 화소 → pt 는 0.75 배
      await out.addJpeg(jpeg, size.width * 0.75, size.height * 0.75)
    }
  } catch (e) {
    if (isEngineCrash(e)) {
      markBroken(e)
      throw engineCrashed()
    }
    throw e
  } finally {
    try {
      doc.free()
    } catch {
      // 이미 풀렸으면 괜찮아요
    }
  }
}
