import type { Service } from '../../lib/types'
import { SERVICE_HEX } from '../../lib/report'

export type SheetVariant = 'screen' | 'print'

/**
 * 예배별 출석 칸 색 (Tailwind 클래스)
 * - screen: 앱 색 (노랑 present / 민트 present2)
 * - print: 엑셀 원본과 같은 값 (노랑 FFD700 / 민트 9BE5C8)
 */
export const SERVICE_FILL: Record<SheetVariant, Record<Service, string>> = {
  screen: { 1: 'bg-present', 2: 'bg-present2' },
  print: { 1: 'bg-[#FFD700]', 2: 'bg-[#9BE5C8]' },
}

/** 인쇄용 예배 색 (#FFD700 …) — 인라인 style 이 필요할 때 */
export const SERVICE_PRINT_HEX: Record<Service, string> = { 1: `#${SERVICE_HEX[1]}`, 2: `#${SERVICE_HEX[2]}` }
