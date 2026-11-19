import type { ButtonHTMLAttributes } from 'react'
import { Icon } from '../ui'

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'>

/** 글 복사하기 (파란 대표 버튼). copied 면 '복사했어요' */
export function CopyButton({ copied, className = '', ...rest }: Props & { copied: boolean }) {
  return (
    <button
      type="button"
      className={`inline-flex h-[52px] min-w-0 items-center justify-center gap-2 rounded-2xl bg-brand px-4 text-[16px] font-bold whitespace-nowrap text-white shadow-[0_4px_12px_rgb(10_114_180/0.25)] transition hover:bg-brand-deep active:bg-brand-deep disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none ${className}`}
      {...rest}
    >
      <Icon name={copied ? 'check' : 'copy'} size={20} strokeWidth={2} />
      {copied ? '복사했어요' : '글 복사하기'}
    </button>
  )
}

/** 공유 (파란 테두리 버튼) */
export function ShareButton({ className = '', ...rest }: Props) {
  return (
    <button
      type="button"
      className={`inline-flex h-[52px] min-w-26 shrink-0 items-center justify-center gap-1.5 rounded-2xl border-[1.5px] border-brand bg-surface px-4 text-[16px] font-bold whitespace-nowrap text-brand transition hover:bg-brand-soft active:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      {...rest}
    >
      <Icon name="share" size={19} strokeWidth={2} />
      공유
    </button>
  )
}
