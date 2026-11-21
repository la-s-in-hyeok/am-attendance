/**
 * 사진(JPG·PNG·WebP·HEIC 등) → A4 세로 한 쪽 PDF
 * - 사진의 회전 정보(EXIF)를 따라 바로 세워요.
 * - 여백을 두고 쪽 안에 꽉 차게(비율 유지) 가운데에 놓아요.
 */
import { ConvertError } from './errors'
import type { RasterPdf } from './pdfkit'
import { capScale, rasterize, ScaleLadder } from './raster'
import { RENDER_SCALES } from './types'

/** A4 (pt) */
const A4_W = 595.28
const A4_H = 841.89
/** 여백 (pt, 약 1cm) */
const MARGIN = 28

type Source = { img: CanvasImageSource; w: number; h: number; close: () => void }

/** 그릴 때 쓰는 가장 큰 크기 (A4 를 가장 큰 배율로 그린 긴 변 + 조금). 사진을 이보다 크게 풀 필요가 없어요 */
const DECODE_MAX_SIDE = Math.ceil((A4_H / 0.75) * RENDER_SCALES[0] * 1.1)

/**
 * 사진의 가로·세로 (회전 정보를 따른 값). 그림을 다 풀지 않고 크기만 읽어요.
 * <img> 는 크기를 먼저 알려 주고 실제로 그릴 때까지 풀지 않아요
 */
async function measure(file: Blob): Promise<{ w: number; h: number } | null> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    const done = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('image'))
    })
    img.src = url
    await done
    return img.naturalWidth > 0 && img.naturalHeight > 0 ? { w: img.naturalWidth, h: img.naturalHeight } : null
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * 큰 사진(4800만 화소 등)은 그릴 크기로 줄여서 풀어요. 원래 크기로 풀면 사진 한 장에 메모리를 수백 MB 써요.
 * 브라우저가 줄여 풀기(resizeWidth)를 못 하거나, 회전 정보를 다르게 읽은 것 같으면 null (원래 방법으로 풀어요)
 */
async function decodeSmall(file: Blob): Promise<Source | null> {
  const size = await measure(file)
  if (!size) return null
  const k = DECODE_MAX_SIDE / Math.max(size.w, size.h)
  if (k >= 1) return null
  const w = Math.max(1, Math.round(size.w * k))
  const h = Math.max(1, Math.round(size.h * k))
  let bmp: ImageBitmap | null = null
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth: w, resizeHeight: h, resizeQuality: 'high' })
    if (bmp.width !== w || bmp.height !== h) {
      bmp.close()
      return null
    }
    // 회전 정보를 <img> 와 같게 읽었는지: 줄여 푼 그림이 가로로 눕혀졌으면(세로 사진이 가로로) 원래 방법으로 해요.
    // 비율을 억지로 맞춘 그림이라 크기만으로는 알 수 없어서, 작게 한 장 더 풀어 비율을 봐요
    const probe = await createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth: 64, resizeQuality: 'low' })
    const ratioOk = Math.abs(probe.height / probe.width - size.h / size.w) < 0.05 * (size.h / size.w) + 0.02
    probe.close()
    if (!ratioOk) {
      bmp.close()
      return null
    }
    const b = bmp
    return { img: b, w: size.w, h: size.h, close: () => b.close() }
  } catch {
    bmp?.close()
    return null
  }
}

async function decode(file: Blob): Promise<Source | null> {
  if (typeof createImageBitmap === 'function') {
    const small = await decodeSmall(file)
    if (small) return small
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
      if (bmp.width > 0 && bmp.height > 0) return { img: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() }
      bmp.close()
    } catch {
      // 아래 <img> 로 다시 해 봐요 (사파리는 HEIC 를 <img> 로는 열어요)
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) return null
    // <img> 는 브라우저가 회전 정보를 알아서 따라요
    return { img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) }
  } catch {
    URL.revokeObjectURL(url)
    return null
  }
}

export async function convertImage(file: File, out: RasterPdf, isHeic: boolean): Promise<void> {
  const src = await decode(file)
  if (!src) {
    throw new ConvertError(
      isHeic ? 'unsupported' : 'broken',
      isHeic
        ? '이 브라우저에서는 HEIC 사진을 열 수 없어요. 사진을 JPG로 바꾸거나 화면을 캡처해서 올려 주세요.'
        : '사진을 열지 못했어요. 파일이 손상됐을 수 있어요. JPG나 PNG 사진으로 다시 올려 주세요.',
    )
  }
  try {
    const pageW = A4_W / 0.75 // CSS 화소
    const pageH = A4_H / 0.75
    const jpeg = await rasterize(new ScaleLadder(), (scale) => {
      const s = capScale(pageW, pageH, scale)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(pageW * s)
      canvas.height = Math.round(pageH * s)
      const c = canvas.getContext('2d')
      if (!c) throw new Error('no 2d context')
      c.fillStyle = '#ffffff'
      c.fillRect(0, 0, canvas.width, canvas.height)
      const m = (MARGIN / 0.75) * s
      const boxW = canvas.width - m * 2
      const boxH = canvas.height - m * 2
      const k = Math.min(boxW / src.w, boxH / src.h)
      const dw = src.w * k
      const dh = src.h * k
      c.imageSmoothingEnabled = true
      c.imageSmoothingQuality = 'high'
      c.drawImage(src.img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh)
      return canvas
    })
    await out.addJpeg(jpeg, A4_W, A4_H)
  } finally {
    src.close()
  }
}
