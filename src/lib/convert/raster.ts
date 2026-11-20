/**
 * 캔버스 → JPEG 공통 도구
 * - iOS 사파리는 캔버스 하나가 약 1,670만 화소를 넘거나 메모리가 모자라면 그림이 비거나 실패해요.
 *   그래서 화소 수를 미리 줄이고, 실패하면 배율을 2 → 1.5 → 1 로 낮춰 다시 그려요.
 */
import { ConvertError } from './errors'
import { JPEG_QUALITY, RENDER_SCALES } from './types'

/** 캔버스 하나의 최대 화소 수 / 한 변 길이 (iOS 한계보다 조금 작게) */
const MAX_AREA = 16_000_000
const MAX_SIDE = 8000

/** 한 번 낮춘 배율은 그 파일의 남은 쪽에도 그대로 써요 */
export class ScaleLadder {
  private i = 0

  get scale(): number {
    return RENDER_SCALES[this.i]
  }

  lower(): boolean {
    if (this.i >= RENDER_SCALES.length - 1) return false
    this.i++
    return true
  }
}

/** w×h(CSS 화소) 크기를 scale 배로 그려도 캔버스 한계를 넘지 않게 배율을 줄여요 */
export function capScale(w: number, h: number, scale: number): number {
  if (!(w > 0 && h > 0)) return scale
  return Math.min(scale, Math.sqrt(MAX_AREA / (w * h)), MAX_SIDE / Math.max(w, h))
}

/** 투명한 곳에 흰 바탕을 깔아요 (안 깔면 JPEG 에서 까만 선이 생겨요) */
export function whiteBehind(canvas: HTMLCanvasElement): void {
  const c = canvas.getContext('2d')
  if (!c) return
  c.save()
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.globalCompositeOperation = 'destination-over'
  c.fillStyle = '#ffffff'
  c.fillRect(0, 0, canvas.width, canvas.height)
  c.restore()
}

export function toJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', JPEG_QUALITY)
    } catch {
      resolve(null)
    }
  })
}

/** 캔버스 메모리를 바로 돌려줘요 (iOS 는 이렇게 해야 빨리 풀려요) */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0
  canvas.height = 0
}

/** 화면이 멈추지 않게 잠깐 쉬어요 (진행 표시가 그려질 틈) */
export const breathe = () => new Promise<void>((r) => setTimeout(r, 0))

export const memoryFail = () =>
  new ConvertError(
    'failed',
    "휴대폰 메모리가 모자라서 그리지 못했어요. 다른 앱을 닫고 다시 해 보거나, PC에서 하거나, 한글·워드에서 'PDF로 저장'해서 올려 주세요.",
  )

/**
 * draw(배율) 로 캔버스를 그려 JPEG 로 바꿔요. 실패하면 배율을 낮춰 다시 해요.
 * (ConvertError 는 그대로 넘겨요)
 */
export async function rasterize(ladder: ScaleLadder, draw: (scale: number) => HTMLCanvasElement | Promise<HTMLCanvasElement>): Promise<Blob> {
  for (;;) {
    let canvas: HTMLCanvasElement | null = null
    try {
      canvas = await draw(ladder.scale)
      if (canvas.width > 0 && canvas.height > 0) {
        const jpeg = await toJpeg(canvas)
        if (jpeg && jpeg.size > 0) return jpeg
      }
    } catch (e) {
      if (e instanceof ConvertError) throw e
      console.warn('[convert] 그리기 실패, 배율을 낮춰 다시 해요', e)
    } finally {
      if (canvas) releaseCanvas(canvas)
    }
    if (!ladder.lower()) throw memoryFail()
  }
}
