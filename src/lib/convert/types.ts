/**
 * 문서 → PDF 변환에서 함께 쓰는 타입과 한도
 * (이 파일과 errors.ts 는 가벼워서 바로 불러와도 돼요. 무거운 라이브러리는 각 파일 안에서 필요할 때 불러와요)
 */

/** 올릴 수 있는 원본 종류 */
export type SourceKind = 'hwp' | 'hwpx' | 'docx' | 'pdf' | 'image'

/** 진행 상황: 'prepare' = 변환 엔진·글꼴을 받고 파일을 읽는 중, 'render' = 쪽 그리는 중, 'pdf' = PDF 로 묶는 중 */
export interface ConvertProgress {
  stage: 'prepare' | 'render' | 'pdf'
  page?: number
  pages?: number
}

export interface ConvertResult {
  pdf: Uint8Array
  pages: number
  kind: SourceKind
  /** 쪽마다 JPEG 한 장 (hwp·hwpx·docx·사진). PDF 를 그대로 올리면 [] */
  previews: Blob[]
  /** 사용자에게 보여 줄 안내 (한국어) */
  warnings: string[]
}

/** 올릴 수 있는 파일 크기 (30MB) */
export const MAX_INPUT_BYTES = 30 * 1024 * 1024
/** 만들 수 있는 최대 쪽수 */
export const MAX_PAGES = 40
/** JPEG 화질 */
export const JPEG_QUALITY = 0.8
/** 그리는 배율: 2배로 그리고, 휴대폰 메모리가 모자라면 1.5배 → 1배로 낮춰요 */
export const RENDER_SCALES = [2, 1.5, 1] as const
