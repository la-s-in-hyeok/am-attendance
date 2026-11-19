import { useState, type ReactNode } from 'react'
import { Card, Icon, type IconName } from '../ui'
import { ROLE_LABEL, type Group, type Member, type Role } from '../../lib/types'
import { useStore } from '../../store'
import { useActiveGroups } from '../../hooks'
import { currentSunday } from '../../lib/dates'
import { labelDay, suffixExample } from './lib'
import { useGroupInfo, useGroupMap } from './useManage'

/** 구역 제목 */
export function SectionTitle({ children, right, className = '' }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={`mb-2.5 flex min-h-9 items-center justify-between gap-3 px-1 ${className}`}>
      <h2 className="flex min-w-0 items-baseline gap-2 text-[17px] font-bold tracking-tight">{children}</h2>
      {right}
    </div>
  )
}

/**
 * 줄 목록 카드.
 * wide 를 주면 넓은 PC 화면에서 두 줄로 나란히 보여 준다 (휴대폰은 그대로 한 줄씩).
 * 칸 사이 선은 각 줄의 아래·오른쪽 선으로 그리고, 맨 아래 선은 카드 밖으로 1px 밀어 감춘다.
 */
export function ListCard({ children, className = '', wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  if (wide)
    return (
      <Card className={`overflow-hidden ${className}`}>
        <div className="-mb-px grid lg:grid-cols-2 [&>*]:border-b [&>*]:border-line lg:[&>*:nth-child(odd):not(:last-child)]:border-r">
          {children}
        </div>
      </Card>
    )
  return <Card className={`divide-y divide-line overflow-hidden ${className}`}>{children}</Card>
}

/** 아이콘 + 제목 + 설명 한 줄 버튼 */
export function MenuRow({
  icon,
  title,
  sub,
  onClick,
  danger,
  disabled,
  right,
}: {
  icon: IconName
  title: ReactNode
  sub?: ReactNode
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
  right?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-[60px] w-full items-center gap-3.5 px-4 py-3 text-left transition hover:bg-black/[0.02] active:bg-black/5 disabled:cursor-default disabled:opacity-60"
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
          danger ? 'bg-danger/10 text-danger' : 'bg-[#f3f3ef] text-ink-2'
        }`}
      >
        <Icon name={icon} size={19} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[15px] font-semibold ${danger ? 'text-danger' : ''}`}>{title}</span>
        {sub && <span className="mt-0.5 block text-[13px] leading-snug text-ink-3">{sub}</span>}
      </span>
      {right ?? <Icon name="chevronRight" size={18} className="shrink-0 text-ink-3" />}
    </button>
  )
}

/** 목자 / 총무 표시 */
export function RoleTag({ role }: { role: Role }) {
  if (!role) return null
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[12px] font-bold ${
        role === 'leader' ? 'bg-present text-ink' : 'bg-present-soft text-present-ink'
      }`}
    >
      {ROLE_LABEL[role]}
    </span>
  )
}

/** 안내 상자 */
export function Callout({
  tone = 'info',
  icon,
  children,
  className = '',
}: {
  tone?: 'info' | 'warn' | 'danger'
  icon?: IconName
  children: ReactNode
  className?: string
}) {
  const style =
    tone === 'warn'
      ? 'bg-present-soft text-present-ink'
      : tone === 'danger'
        ? 'bg-danger/10 text-danger'
        : 'bg-[#f3f3ef] text-ink-2'
  return (
    <div className={`flex gap-2.5 rounded-2xl px-4 py-3 text-[13px] leading-relaxed ${style} ${className}`}>
      {icon && <Icon name={icon} size={17} className="mt-px shrink-0" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/** 점 목록 */
export function Bullets({
  items,
  small,
  className = '',
}: {
  items: (ReactNode | false | null | undefined)[]
  small?: boolean
  className?: string
}) {
  return (
    <ul className={`space-y-1.5 leading-relaxed ${small ? 'text-[13px] text-ink-3' : 'text-[15px] text-ink-2'} ${className}`}>
      {items.filter(Boolean).map((t, i) => (
        <li key={i} className="flex gap-2.5">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full bg-ink-3 ${small ? 'mt-[8px]' : 'mt-[10px]'}`} />
          <span className="min-w-0">{t}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * 지금 보고 있는 주일이 이번 주가 아니면 알려 준다.
 * 지난·다음 주일 출석부를 일부러 열어 두었으면 추가·이동·빼기가 그 주일부터 적용되기 때문이다 (lib/roster.ts).
 * 이번 주를 보고 있을 때의 평일 규칙(다음 주일부터)은 이동·빼기 화면에서 정확한 날짜와 함께 따로 알려 준다.
 */
export function ViewingDateNotice({ className = '' }: { className?: string }) {
  const date = useStore((s) => s.date)
  const setDate = useStore((s) => s.setDate)
  const now = currentSunday()
  if (date === now) return null
  return (
    <Callout tone="warn" icon="calendar" className={className}>
      지금 <b>{labelDay(date)}</b> 출석부를 보고 있어요. 목장원 추가·이동·빼기가 이 주일 출석부부터 적용돼요.{' '}
      <button type="button" onClick={() => setDate(now)} className="font-bold underline underline-offset-2">
        이번 주로 바꾸기
      </button>
    </Callout>
  )
}

/** 목장 고르기 (큰 버튼 두 줄) */
export function GroupPicker({
  excludeId,
  onPick,
  disabled,
}: {
  excludeId?: string
  onPick: (g: Group) => void
  disabled?: boolean
}) {
  const groups = useActiveGroups()
  const info = useGroupInfo()
  const list = groups.filter((g) => g.id !== excludeId)
  if (list.length === 0) return <p className="py-6 text-center text-sm text-ink-3">옮길 수 있는 다른 목장이 없어요.</p>
  return (
    <div className="grid grid-cols-2 gap-2">
      {list.map((g) => (
        <button
          key={g.id}
          type="button"
          disabled={disabled}
          onClick={() => onPick(g)}
          className="flex min-h-[64px] flex-col items-start justify-center rounded-2xl border border-line bg-surface px-4 py-2.5 text-left transition hover:border-ink-3 active:bg-present-soft disabled:opacity-50"
        >
          <span className="w-full truncate text-[15px] font-bold">{g.name}</span>
          <span className="text-xs text-ink-3">{info.get(g.id)?.count ?? 0}명</span>
        </button>
      ))}
    </div>
  )
}

/** 같은(비슷한) 이름이 이미 있을 때 경고. 추가는 막지 않는다 */
export function SameNameNotice({ name, matches, className = '' }: { name: string; matches: Member[]; className?: string }) {
  const groupMap = useGroupMap()
  if (matches.length === 0) return null
  return (
    <Callout tone="warn" icon="users" className={className}>
      <p className="font-bold">비슷한 이름이 이미 있어요</p>
      <p>{matches.map((m) => `${m.name}(${groupMap.get(m.groupId)?.name ?? '?'})`).join(', ')}</p>
      <p className="mt-1">
        다른 분이면 {suffixExample(name)}처럼 구분해 주세요. 그래도 그대로 넣을 수 있어요.
      </p>
    </Callout>
  )
}

/** 접었다 펴는 카드 */
export function Collapsible({
  title,
  count,
  icon,
  children,
  defaultOpen = false,
}: {
  title: ReactNode
  count?: ReactNode
  icon: IconName
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[60px] w-full items-center gap-3.5 px-4 py-3 text-left transition hover:bg-black/[0.02] active:bg-black/5"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#f3f3ef] text-ink-2">
          <Icon name={icon} size={19} />
        </span>
        <span className="min-w-0 flex-1 text-[15px] font-semibold">
          {title} {count !== undefined && <span className="text-ink-3">{count}</span>}
        </span>
        <Icon name="chevronDown" size={18} className={`shrink-0 text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="anim-fade divide-y divide-line border-t border-line">{children}</div>}
    </Card>
  )
}

/** 첫 글자 동그라미 */
export function Initial({ text }: { text: string }) {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-present-soft text-[16px] font-extrabold text-present-ink">
      {Array.from(text.trim())[0]?.toUpperCase() ?? '?'}
    </span>
  )
}
