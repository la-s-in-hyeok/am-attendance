/**
 * 문서 → PDF 변환 (모두 휴대폰·PC 브라우저 안에서 해요. 파일을 서버로 보내지 않아요)
 *
 *   한글(.hwp·.hwpx) · 워드(.docx) → 쪽마다 그림(JPEG)으로 그려 PDF 로 묶어요
 *   PDF → 열리는지·쪽수만 확인하고 그대로 써요
 *   사진 → A4 세로 한 쪽에 여백을 두고 넣어요
 *
 * 무거운 라이브러리(한글 엔진 wasm 약 28MB, docx-preview, html2canvas, pdf-lib)는
 * 필요할 때 따로 받아요. 이 파일은 가벼워서 화면 코드에서 바로 불러도 앱이 무거워지지 않아요.
 */
import { ConvertError, tooManyPages } from './errors'
import { extOf, hwpPasswordProtected, sniff } from './sniff'
import { MAX_INPUT_BYTES, MAX_PAGES, type ConvertProgress, type ConvertResult, type SourceKind } from './types'

export type { ConvertProgress, ConvertResult, SourceKind } from './types'
export type { ConvertErrorCode } from './errors'
export { ConvertError } from './errors'

/** 변환 코드 조각을 받아요. 인터넷이 끊겨 못 받으면 알아듣기 쉬운 안내로 바꿔요 */
async function loadPart<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load()
  } catch {
    throw new ConvertError('failed', '변환 도구를 받지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.')
  }
}

/** 파일 종류 알아보기: 'doc' 은 예전 워드 파일(바꿀 수 없음), null 은 모르는 파일 */
export async function detectKind(file: File): Promise<SourceKind | 'doc' | null> {
  try {
    return (await sniff(file)).kind
  } catch {
    return null
  }
}

// 휴대폰 메모리를 아끼려고 한 번에 한 파일씩 바꿔요
let queue: Promise<unknown> = Promise.resolve()

/** 파일 하나를 PDF 로 바꿔요. 실패하면 ConvertError (message 를 그대로 보여 주면 돼요) */
export function convertToPdf(file: File, onProgress?: (p: ConvertProgress) => void): Promise<ConvertResult> {
  const job = queue.then(
    () => run(file, onProgress),
    () => run(file, onProgress),
  )
  // 끝난 결과(PDF·미리보기)를 큐가 붙잡지 않게 값은 버려요
  queue = job.then(
    () => undefined,
    () => undefined,
  )
  return job
}

async function run(file: File, onProgress?: (p: ConvertProgress) => void): Promise<ConvertResult> {
  const progress = (p: ConvertProgress) => {
    try {
      onProgress?.(p)
    } catch {
      // 화면 쪽 오류가 변환을 멈추지 않게
    }
  }
  if (file.size > MAX_INPUT_BYTES) throw new ConvertError('too-big')
  progress({ stage: 'prepare' })

  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    // iCloud·구글 드라이브에서 아직 내려받지 않은 파일이면 이렇게 돼요
    throw new ConvertError('broken', '파일을 읽지 못했어요. 파일을 휴대폰에 내려받은 다음 다시 골라 주세요.')
  }
  if (bytes.length === 0) throw new ConvertError('broken', '빈 파일이에요. 내용이 있는 파일을 골라 주세요.')

  const s = await sniff(file, bytes)
  if (s.kind === 'doc') throw new ConvertError('doc-legacy')
  if (s.kind === null) throw new ConvertError('unsupported')
  if (s.encryptedOoxml) throw new ConvertError('encrypted')
  const kind: SourceKind = s.kind
  const warnings: string[] = []
  const warn = (w: string) => {
    if (!warnings.includes(w)) warnings.push(w)
  }

  try {
    if (kind === 'pdf') {
      const { inspectPdf } = await loadPart(() => import('./pdfkit'))
      const info = await inspectPdf(bytes)
      if (info.pages > MAX_PAGES) throw tooManyPages(info.pages)
      if (info.encrypted) warn('보안 설정이 걸린 PDF예요. 그대로 올릴 수는 있지만, 다른 파일과 하나로 합칠 때는 빠질 수 있어요.')
      progress({ stage: 'pdf', pages: info.pages })
      return { pdf: bytes, pages: info.pages, kind, previews: [], warnings }
    }

    if (kind === 'hwp' && hwpPasswordProtected(bytes)) throw new ConvertError('encrypted')

    const { RasterPdf } = await loadPart(() => import('./pdfkit'))
    const out = await RasterPdf.create(file.name.replace(/\.[^.]+$/, ''))
    const hooks = {
      ready: () => progress({ stage: 'prepare' }),
      page: (page: number, pages: number) => progress({ stage: 'render', page, pages }),
      warn,
    }
    if (kind === 'hwp' || kind === 'hwpx') {
      const { convertHwp } = await loadPart(() => import('./hwp'))
      await convertHwp(bytes, out, hooks)
      warn('한글 글꼴은 비슷한 무료 글꼴로 바꿔서 그렸어요. 미리보기로 확인해 주세요.')
    } else if (kind === 'docx') {
      const { convertDocx } = await loadPart(() => import('./docx'))
      await convertDocx(new Blob([bytes as BlobPart]), out, hooks)
    } else {
      const { convertImage } = await loadPart(() => import('./image'))
      progress({ stage: 'render', page: 1, pages: 1 })
      const ext = extOf(file.name)
      await convertImage(file, out, ext === 'heic' || ext === 'heif' || /heic|heif/i.test(file.type))
    }
    progress({ stage: 'pdf', pages: out.pages })
    const pdf = await out.save()
    return { pdf, pages: out.pages, kind, previews: out.previews, warnings }
  } catch (e) {
    if (e instanceof ConvertError) throw e
    console.error('[convert] 변환 실패', e)
    throw new ConvertError('failed')
  }
}

/** 여러 PDF 를 주어진 순서대로 하나로 합쳐요. 읽지 못한 것은 failed 에 label 로 알려 줘요 */
export async function mergePdfs(
  parts: { bytes: Uint8Array | ArrayBuffer; label: string }[],
): Promise<{ pdf: Uint8Array; pages: number; failed: string[] }> {
  const { mergePdfParts } = await loadPart(() => import('./pdfkit'))
  return mergePdfParts(parts)
}

/**
 * 변환 도구를 미리 받아 둬요 (예: 올리기 창을 열 때). 절대 오류를 내지 않아요.
 * kind 를 모르면 한글 엔진·워드 도구·글꼴을 모두 받아요 (데이터 절약 모드면 PDF 도구만).
 */
export function preloadConverter(kind?: SourceKind): void {
  try {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    const all = kind === undefined && conn?.saveData !== true
    const jobs: Promise<unknown>[] = [import('./pdfkit').then((m) => m.loadPdfLib())]
    const hwp = kind === 'hwp' || kind === 'hwpx' || all
    const docx = kind === 'docx' || all
    if (hwp) jobs.push(import('./hwp').then((m) => m.loadRhwp()))
    if (docx) jobs.push(import('./docx').then((m) => m.loadDocxLibs()))
    if (hwp || docx) jobs.push(import('./fonts').then((m) => m.ensureFonts()))
    for (const j of jobs) j.catch(() => undefined)
  } catch {
    // 미리 받기는 실패해도 괜찮아요 (변환할 때 다시 받아요)
  }
}
