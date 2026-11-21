import { MAX_INPUT_BYTES, MAX_PAGES } from './types'

export type ConvertErrorCode = 'unsupported' | 'doc-legacy' | 'broken' | 'encrypted' | 'too-big' | 'too-many-pages' | 'failed'

const SAVE_AS_PDF = "한글이나 워드에서 파일을 열고 'PDF로 저장'해서 올려 주세요."

const MESSAGE: Record<ConvertErrorCode, string> = {
  unsupported: '이 파일은 바꿀 수 없어요. 한글(HWP·HWPX), 워드(DOCX), PDF, 사진 파일을 올려 주세요.',
  'doc-legacy': "예전 워드 파일(.doc)은 바로 바꿀 수 없어요. 워드에서 '다른 이름으로 저장'으로 'Word 문서(.docx)'나 'PDF'로 저장해서 올려 주세요.",
  broken: `파일을 읽지 못했어요. 파일이 손상됐거나 다른 형식일 수 있어요. ${SAVE_AS_PDF}`,
  encrypted: `암호(보안)가 걸린 파일이라 열 수 없어요. 암호를 풀고 다시 저장하거나, ${SAVE_AS_PDF}`,
  'too-big': `파일이 너무 커요. ${Math.round(MAX_INPUT_BYTES / 1024 / 1024)}MB 이하로 줄이거나 나눠서 올려 주세요.`,
  'too-many-pages': `쪽수가 너무 많아요. 한 번에 ${MAX_PAGES}쪽까지 올릴 수 있어요. 필요한 쪽만 골라 'PDF로 저장'해서 올려 주세요.`,
  failed: `변환하다가 멈췄어요. 휴대폰 메모리가 모자랐을 수 있어요. 다른 앱을 닫고 다시 해 보거나, ${SAVE_AS_PDF}`,
}

/** 변환 실패. message 는 사용자에게 그대로 보여 줘도 되는 안내 문장이에요 */
export class ConvertError extends Error {
  readonly code: ConvertErrorCode

  constructor(code: ConvertErrorCode, message?: string) {
    super(message ?? MESSAGE[code])
    this.name = 'ConvertError'
    this.code = code
  }
}

/** 쪽수가 넘칠 때 (몇 쪽인지 알려 줘요) */
export function tooManyPages(pages: number): ConvertError {
  return new ConvertError(
    'too-many-pages',
    `${pages}쪽이라 너무 많아요. 한 번에 ${MAX_PAGES}쪽까지 올릴 수 있어요. 필요한 쪽만 골라 'PDF로 저장'해서 올려 주세요.`,
  )
}

/** 변환을 멈추라는 신호가 왔으면 멈춰요 (시간이 너무 오래 걸렸거나, 화면에서 취소했을 때) */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal)
}

export function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('변환을 멈췄어요.', 'AbortError')
}

/** 변환에 넘기는 공통 연결 (진행 알림·안내 문장·멈춤 신호) */
export type ConvertHooks = {
  ready: () => void
  page: (page: number, pages: number) => void
  warn: (w: string) => void
  signal?: AbortSignal
  /** 다음 단계가 오래 걸려도 된다고 알려요 (큰 엔진 파일 받기 등). 다음 진행 알림 전까지 이만큼(ms)은 멈춘 것으로 보지 않아요 */
  allow?: (ms: number) => void
}
