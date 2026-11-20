import { EVENT_COLORS, type CalEvent, type EventColor } from '../../lib/types'

/**
 * 일정 색 (파스텔). bg = 막대·칩 배경, ink = 그 위 글자, dot = 목록의 색 점·고르기 동그라미.
 * ink 는 bg 위에서 대비 4.5:1 이상이 되도록 같은 계열의 진한 색으로 골랐어요 (아래 contrastRatio 로 확인).
 *   pink 6.5 · peach 5.8 · butter 6.8 · mint 6.3 · sky 6.4 · lavender 7.0 · lilac 6.4 · aqua 6.3
 */
export const EVENT_PALETTE: Record<EventColor, { bg: string; ink: string; dot: string; label: string }> = {
  pink: { bg: '#ffe0ea', ink: '#9d1747', dot: '#f27aa0', label: '분홍' },
  peach: { bg: '#ffe5d4', ink: '#93400c', dot: '#f59a63', label: '살구' },
  butter: { bg: '#fff1bf', ink: '#6b4f00', dot: '#e8c235', label: '노랑' },
  mint: { bg: '#d5f5e6', ink: '#0c6340', dot: '#4fcf95', label: '민트' },
  sky: { bg: '#dcecfd', ink: '#1b5590', dot: '#5aa5ef', label: '하늘' },
  lavender: { bg: '#e5e6fd', ink: '#3c3ea8', dot: '#8b8ef0', label: '라벤더' },
  lilac: { bg: '#f1e2fb', ink: '#75319c', dot: '#c084e8', label: '연보라' },
  aqua: { bg: '#d3f3f5', ink: '#0b5f68', dot: '#3fc3cf', label: '청록' },
}

/** 서버에서 모르는 색 이름이 와도 화면이 깨지지 않게 */
export function paletteOf(color: string) {
  return EVENT_PALETTE[(color in EVENT_PALETTE ? color : 'sky') as EventColor]
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

/** WCAG 대비 (1 ~ 21) */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

if (import.meta.env.DEV) {
  for (const c of EVENT_COLORS) {
    const p = EVENT_PALETTE[c]
    if (contrastRatio(p.bg, p.ink) < 4.5) console.warn(`[캘린더] ${c} 색의 글자 대비가 4.5:1 보다 낮아요`)
  }
}

/** 아직 덜 쓴 색 (새 일정의 기본 색). 같으면 팔레트 순서대로 */
export function leastUsedColor(events: Pick<CalEvent, 'color'>[]): EventColor {
  const count = new Map<string, number>()
  for (const e of events) count.set(e.color, (count.get(e.color) ?? 0) + 1)
  let best: EventColor = EVENT_COLORS[0]
  let min = Infinity
  for (const c of EVENT_COLORS) {
    const n = count.get(c) ?? 0
    if (n < min) {
      min = n
      best = c
    }
  }
  return best
}
