/* 회의록 도구 막대 아이콘 (선 아이콘, 24px 그리드). ui.tsx 의 ICONS 와 같은 모양으로 그려요 */

const PATHS = {
  heading: 'M6 5v14M16 5v14M6 12h10',
  bullet: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  ordered: 'M10 6h10M10 12h10M10 18h10M4 4.5h1.5V9M4 9h3M4 14.5a1.5 1.5 0 013 0c0 1.5-3 2.2-3 4.5h3',
  task: 'M4 5h5v5H4zM5.5 15.5l1.5 1.5 3-3M13 7.5h7M13 16h7',
  toggle: 'M5 5l5 4-5 4zM13 9h7M8 18h12',
  divider: 'M3 12h18M7 6h10M7 18h10',
  bold: 'M7 5h6a3.5 3.5 0 010 7H7zM7 12h7a3.5 3.5 0 010 7H7z',
} as const

export type ToolIcon = keyof typeof PATHS

export function ToolbarIcon({ name, size = 20 }: { name: ToolIcon; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'bold' ? 2.3 : 1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
