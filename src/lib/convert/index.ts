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
import { abortReason, ConvertError, throwIfAborted, tooManyPages, type ConvertHooks } from './errors'
import { extOf, hwpPasswordProtected, sniff, zipTooLarge } from './sniff'
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

// 휴대폰 메모리를 아끼려고 한 번에 하나씩 해요 (변환·PDF 합치기 모두)
let queue: Promise<unknown> = Promise.resolve()

/** 큐에 넣는 일: result 는 부른 쪽에 돌려줄 결과, busy 는 그 일이 실제로 다 끝나서 메모리를 놓을 때 */
type Job<T> = { result: Promise<T>; busy: Promise<unknown> }

function enqueue<T>(task: () => Job<T>): Promise<T> {
  const started = queue.then(task)
  // 다음 일은 앞의 일이 정말 끝난 뒤에 시작해요 (취소해서 결과를 먼저 돌려줬어도 남은 정리가 끝날 때까지).
  // 끝난 결과(PDF·미리보기)를 큐가 붙잡지 않게 값은 버려요
  queue = started.then(
    (j) => j.busy.then(
      () => undefined,
      () => undefined,
    ),
    () => undefined,
  )
  return started.then((j) => j.result)
}

/**
 * 한동안(이 시간 동안) 진행이 하나도 없으면 멈춘 것으로 보고 끝내요. 쪽을 하나 그릴 때마다 다시 세요.
 * (변환 도구를 처음 받는 시간도 들어가서 넉넉하게 잡았어요)
 */
const STALL_MS = 5 * 60 * 1000

/**
 * 멈춘 뒤에도 그리던 쪽이 끝날 때까지는 변환 코드가 돌아요. 그동안 다음 변환을 시작하지 않고 기다리되,
 * 영영 안 끝나면(정말 멈춘 경우) 이만큼만 기다려요
 */
const ABORT_GRACE_MS = 30 * 1000

const stalled = () =>
  new ConvertError('failed', "변환이 너무 오래 걸려서 멈췄어요. 다른 앱을 닫고 다시 해 보거나, 한글·워드에서 'PDF로 저장'해서 올려 주세요.")

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export type ConvertOptions = {
  /** 화면에서 취소할 때 (멈추면 이 신호의 reason 으로 실패해요) */
  signal?: AbortSignal
}

/** 파일 하나를 PDF 로 바꿔요. 실패하면 ConvertError (message 를 그대로 보여 주면 돼요) */
export function convertToPdf(file: File, onProgress?: (p: ConvertProgress) => void, options?: ConvertOptions): Promise<ConvertResult> {
  const outer = options?.signal
  const job = enqueue(() => guarded(file, onProgress, outer))
  if (!outer) return job
  // 줄을 서서 기다리는 동안 취소해도 바로 실패를 돌려줘요 (차례가 오면 시작하지 않고 넘어가요)
  let onAbort: (() => void) | undefined
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortReason(outer))
    if (outer.aborted) onAbort()
    else outer.addEventListener('abort', onAbort, { once: true })
  })
  cancelled.catch(() => undefined)
  return Promise.race([job, cancelled]).finally(() => {
    if (onAbort) outer.removeEventListener('abort', onAbort)
  })
}

/**
 * 멈춤 신호와 시간 제한을 붙여서 돌려요. 멈추면 부른 쪽에는 바로 실패를 돌려주고,
 * 큐는 변환 코드가 다음 확인 지점에서 스스로 멈추고 정리할 때까지(최대 ABORT_GRACE_MS) 기다려요
 */
function guarded(file: File, onProgress: ((p: ConvertProgress) => void) | undefined, outer?: AbortSignal): Job<ConvertResult> {
  const ctl = new AbortController()
  const signal = ctl.signal
  // 멈춘 이유를 따로 들고 있어요 (iOS 15.4 미만 사파리는 abort(reason) 의 reason 을 버려요)
  let reason: unknown
  const abort = (r: unknown) => {
    if (signal.aborted) return
    reason = r
    ctl.abort(r)
  }
  const why = () => reason ?? abortReason(signal)
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = (ms = STALL_MS) => {
    clearTimeout(timer)
    timer = setTimeout(() => abort(stalled()), ms)
  }
  const onOuter = () => abort(outer ? abortReason(outer) : undefined)
  if (outer?.aborted) onOuter()
  else outer?.addEventListener('abort', onOuter, { once: true })
  const stop = new Promise<never>((_, reject) => {
    if (signal.aborted) reject(why())
    else signal.addEventListener('abort', () => reject(why()), { once: true })
  })
  stop.catch(() => undefined)
  // 차례를 기다리는 동안 이미 취소됐으면 시작하지 않아요
  if (signal.aborted) {
    outer?.removeEventListener('abort', onOuter)
    return { result: stop, busy: Promise.resolve() }
  }
  arm()
  const work = run(
    file,
    (p) => {
      // 멈춘 뒤에 남은 진행 알림은 화면에 보내지 않아요 (이미 실패로 끝난 변환이에요)
      if (signal.aborted) return
      arm()
      onProgress?.(p)
    },
    signal,
    (ms) => {
      if (!signal.aborted) arm(Math.max(ms, STALL_MS))
    },
  )
  work.catch(() => undefined)
  const result = Promise.race([work, stop]).finally(() => {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onOuter)
  })
  // 실제로 끝날 때: 변환 코드가 끝났을 때, 또는 멈춘 뒤 기다릴 만큼 기다렸을 때
  const busy = Promise.race([
    work.then(
      () => undefined,
      () => undefined,
    ),
    stop.then(
      () => undefined,
      () => sleep(ABORT_GRACE_MS),
    ),
  ])
  return { result, busy }
}

const EMPTY = new Uint8Array(0)

async function run(
  file: File,
  onProgress: (p: ConvertProgress) => void,
  signal: AbortSignal,
  allow: (ms: number) => void,
): Promise<ConvertResult> {
  const progress = (p: ConvertProgress) => {
    try {
      onProgress(p)
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
  // 풀면 엄청 커지는 ZIP(압축 폭탄)은 열기 전에 막아요
  if ((kind === 'docx' || kind === 'hwpx') && zipTooLarge(bytes))
    throw new ConvertError('too-big', "파일 안에 든 내용이 너무 커서 열 수 없어요. 한글·워드에서 'PDF로 저장'해서 올려 주세요.")
  throwIfAborted(signal)
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
    const hooks: ConvertHooks = {
      ready: () => progress({ stage: 'prepare' }),
      page: (page: number, pages: number) => progress({ stage: 'render', page, pages }),
      warn,
      signal,
      allow,
    }
    if (kind === 'hwp' || kind === 'hwpx') {
      const { convertHwp } = await loadPart(() => import('./hwp'))
      await convertHwp(bytes, out, hooks)
      warn('한글 글꼴은 비슷한 무료 글꼴로 바꿔서 그렸어요. 미리보기로 확인해 주세요.')
    } else if (kind === 'docx') {
      const { convertDocx } = await loadPart(() => import('./docx'))
      // 파일 내용은 상자에 담아 넘기고 여기서는 놓아요 (변환하는 동안 원본을 한 벌 더 들고 있지 않게)
      const input: { data: Uint8Array | null } = { data: bytes }
      bytes = EMPTY
      await convertDocx(input, out, hooks)
    } else {
      const { convertImage } = await loadPart(() => import('./image'))
      progress({ stage: 'render', page: 1, pages: 1 })
      const ext = extOf(file.name)
      await convertImage(file, out, ext === 'heic' || ext === 'heif' || /heic|heif/i.test(file.type))
    }
    throwIfAborted(signal)
    progress({ stage: 'pdf', pages: out.pages })
    const pdf = await out.save()
    return { pdf, pages: out.pages, kind, previews: out.previews, warnings }
  } catch (e) {
    if (e instanceof ConvertError) throw e
    // 멈춤 신호로 끝났으면 그 이유(시간 초과 안내, 또는 화면이 준 취소 이유)를 그대로
    if (signal.aborted) throw abortReason(signal)
    console.error('[convert] 변환 실패', e)
    throw new ConvertError('failed')
  }
}

/** 여러 PDF 를 주어진 순서대로 하나로 합쳐요. 읽지 못한 것은 failed 에 label 로 알려 줘요 */
export function mergePdfs(
  parts: { bytes: Uint8Array | ArrayBuffer; label: string }[],
): Promise<{ pdf: Uint8Array; pages: number; failed: string[] }> {
  // 변환과 같은 줄에 세워요 (큰 PDF 를 합치는 동안 다른 변환이 같이 돌면 메모리가 모자라요)
  return enqueue(() => {
    const result = (async () => {
      const { mergePdfParts } = await loadPart(() => import('./pdfkit'))
      return mergePdfParts(parts)
    })()
    return { result, busy: result }
  })
}

/**
 * 변환 도구를 미리 받아 둬요 (예: 올리기 창을 열 때). 절대 오류를 내지 않아요.
 * kind 를 모르면 한글 엔진·워드 도구·글꼴을 모두 받아요 (데이터 절약 모드면 PDF 도구만).
 * 한글 엔진은 kind 가 한글일 때만 띄워요. 모를 때는 파일만 받아 둬요 (띄우면 메모리를 수백 MB 써요)
 */
export function preloadConverter(kind?: SourceKind): void {
  try {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    const all = kind === undefined && conn?.saveData !== true
    const jobs: Promise<unknown>[] = [import('./pdfkit').then((m) => m.loadPdfLib())]
    const hwp = kind === 'hwp' || kind === 'hwpx' || all
    const docx = kind === 'docx' || all
    if (kind === 'hwp' || kind === 'hwpx') jobs.push(import('./hwp').then((m) => m.loadRhwp()))
    else if (hwp) jobs.push(import('./hwp').then((m) => m.prefetchRhwp()))
    if (docx) jobs.push(import('./docx').then((m) => m.loadDocxLibs()))
    if (hwp || docx) jobs.push(import('./fonts').then((m) => m.ensureFonts()))
    for (const j of jobs) j.catch(() => undefined)
  } catch {
    // 미리 받기는 실패해도 괜찮아요 (변환할 때 다시 받아요)
  }
}
