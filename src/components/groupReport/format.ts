import type { ISODate } from '../../lib/types'
import { fileStamp } from '../../lib/report'

/** '11월 22일 오후 3:10' (한국 시간). 읽지 못하면 '' */
export function kstDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  try {
    return t.toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Seoul' })
  } catch {
    return ''
  }
}

/** 'AM청년회 목장보고서 2026.11.22.pdf' */
export function mergedFileName(date: ISODate): string {
  return `AM청년회 목장보고서 ${fileStamp(date)}.pdf`
}

/** '1.2MB', '820KB' */
export function sizeLabel(bytes: number): string {
  if (!bytes || bytes < 0) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

/** 저장소에 올릴 수 있는 PDF 크기 (서버 보관함 am-reports 제한·체험 모드와 같은 45MB) */
export const MAX_PDF_BYTES = 45 * 1024 * 1024

/** 휴대폰 공유 창으로 파일을 보낼 수 있는지 */
export function canShareFile(file: File): boolean {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
  } catch {
    return false
  }
}
