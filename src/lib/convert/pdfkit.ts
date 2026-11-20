/**
 * PDF 만들기·확인·합치기 (pdf-lib 는 필요할 때만 불러와요)
 */
import type { PDFDocument } from 'pdf-lib'
import { ConvertError, tooManyPages } from './errors'
import { opensWithoutPassword } from './pdfcrypt'
import { MAX_PAGES } from './types'

type PdfLib = typeof import('pdf-lib')

let lib: Promise<PdfLib> | null = null

export function loadPdfLib(): Promise<PdfLib> {
  if (!lib) {
    lib = import('pdf-lib').catch((e: unknown) => {
      lib = null
      throw e
    })
  }
  return lib
}

/** 쪽 그림(JPEG)을 한 장씩 받아 PDF 를 만들어요. 같은 JPEG 를 미리보기로도 모아 둬요 */
export class RasterPdf {
  readonly previews: Blob[] = []
  private readonly doc: PDFDocument

  private constructor(doc: PDFDocument) {
    this.doc = doc
  }

  static async create(title: string): Promise<RasterPdf> {
    const { PDFDocument } = await loadPdfLib()
    const doc = await PDFDocument.create()
    if (title) doc.setTitle(title)
    doc.setCreator('AM청년회 출석부')
    doc.setProducer('AM청년회 출석부')
    return new RasterPdf(doc)
  }

  get pages(): number {
    return this.previews.length
  }

  /** 쪽 하나 더하기. 크기는 pt (1pt = 1/72인치) */
  async addJpeg(jpeg: Blob, widthPt: number, heightPt: number): Promise<void> {
    if (this.previews.length >= MAX_PAGES) throw tooManyPages(this.previews.length + 1)
    const img = await this.doc.embedJpg(new Uint8Array(await jpeg.arrayBuffer()))
    const page = this.doc.addPage([widthPt, heightPt])
    page.drawImage(img, { x: 0, y: 0, width: widthPt, height: heightPt })
    this.previews.push(jpeg)
  }

  save(): Promise<Uint8Array> {
    return this.doc.save()
  }
}

function isEncryptedError(e: unknown, pdfLib: PdfLib): boolean {
  return e instanceof pdfLib.EncryptedPDFError || (e instanceof Error && /encrypt/i.test(e.message))
}

export type PdfInfo = { pages: number; encrypted: boolean }

/**
 * 올린 PDF 확인: 열리는지, 몇 쪽인지.
 * 보안 설정(인쇄·복사 제한 같은 소유자 암호)만 걸린 PDF 는 누구나 열 수 있어서 그대로 통과시키고,
 * 여는 암호가 걸린 PDF 는 'encrypted' 로 막아요.
 */
export async function inspectPdf(bytes: Uint8Array | ArrayBuffer): Promise<PdfInfo> {
  const pdfLib = await loadPdfLib()
  try {
    const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false })
    const pages = doc.getPageCount()
    if (pages < 1) throw new ConvertError('broken')
    return { pages, encrypted: false }
  } catch (e) {
    if (e instanceof ConvertError) throw e
    if (!isEncryptedError(e, pdfLib)) throw new ConvertError('broken')
  }
  try {
    const doc = await pdfLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
    const pages = doc.getPageCount()
    // 쪽 크기까지 읽히고, 여는 암호가 없어야 '열리는 PDF' 로 봐요
    if (pages > 0 && doc.getPages().every((p) => p.getWidth() > 0 && p.getHeight() > 0) && (await opensWithoutPassword(doc, pdfLib)))
      return { pages, encrypted: true }
  } catch {
    // 아래에서 안내해요
  }
  throw new ConvertError('encrypted')
}

/**
 * 여러 PDF 를 주어진 순서대로 하나로 합쳐요. 읽지 못한 것은 failed 에 이름(label)을 담아요.
 * (보안 설정이 걸린 PDF 는 쪽을 옮겨 담으면 내용이 깨져서 합치지 못해요. 하나뿐이면 그대로 돌려줘요)
 */
export async function mergePdfParts(
  parts: { bytes: Uint8Array | ArrayBuffer; label: string }[],
): Promise<{ pdf: Uint8Array; pages: number; failed: string[] }> {
  const pdfLib = await loadPdfLib()
  if (parts.length === 1) {
    try {
      const info = await inspectPdf(parts[0].bytes)
      if (info.encrypted) {
        const b = parts[0].bytes
        return { pdf: b instanceof Uint8Array ? b : new Uint8Array(b), pages: info.pages, failed: [] }
      }
    } catch {
      // 아래에서 똑같이 실패로 처리돼요
    }
  }
  const out = await pdfLib.PDFDocument.create()
  out.setCreator('AM청년회 출석부')
  out.setProducer('AM청년회 출석부')
  const failed: string[] = []
  for (const part of parts) {
    try {
      const src = await pdfLib.PDFDocument.load(part.bytes, { updateMetadata: false })
      const copied = await out.copyPages(src, src.getPageIndices())
      if (copied.length === 0) throw new Error('empty')
      for (const p of copied) out.addPage(p)
    } catch {
      failed.push(part.label)
    }
  }
  return { pdf: await out.save(), pages: out.getPageCount(), failed }
}
