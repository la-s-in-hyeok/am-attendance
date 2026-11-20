/**
 * 사진(JPG·PNG·WebP·HEIC 등) → A4 세로 한 쪽 PDF
 * - 사진의 회전 정보(EXIF)를 따라 바로 세워요.
 * - 여백을 두고 쪽 안에 꽉 차게(비율 유지) 가운데에 놓아요.
 */
import { ConvertError } from './errors'
import type { RasterPdf } from './pdfkit'
import { capScale, rasterize, ScaleLadder } from './raster'

/** A4 (pt) */
const A4_W = 595.28
const A4_H = 841.89
/** 여백 (pt, 약 1cm) */
const MARGIN = 28

type Source = { img: CanvasImageSource; w: number; h: number; close: () => void }

async function decode(file: Blob): Promise<Source | null> {
  if (typeof createImageBitmap === 'function') {
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
