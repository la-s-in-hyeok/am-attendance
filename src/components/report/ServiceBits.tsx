import type { Service } from '../../lib/types'
import { SERVICE_LABEL } from '../../lib/types'
import { SERVICE_COLOR_NAME, SERVICES } from '../../lib/report'
import { SERVICE_STYLE } from '../ui'
import { SERVICE_FILL, type SheetVariant } from './serviceStyle'

/** 예배 색 네모 (범례에 붙인다) */
export function ServiceSwatch({
  service,
  variant = 'screen',
  className = '',
}: {
  service: Service
  variant?: SheetVariant
  /** 크기·모양 (기본: 화면 12px, 인쇄 2.6mm) */
  className?: string
}) {
  const shape =
    className || (variant === 'screen' ? 'h-3 w-3 rounded-[4px]' : 'h-[2.6mm] w-[2.6mm] outline outline-[0.2mm] outline-black/50')
  return <span aria-hidden="true" className={`inline-block shrink-0 ${SERVICE_FILL[variant][service]} ${shape}`} />
}

/** '1부 18 · 2부 12' 를 예배 색 칩 두 개로 */
export function ServiceCounts({
  service1,
  service2,
  unit = '',
  className = '',
}: {
  service1: number
  service2: number
  /** 숫자 뒤에 붙일 글 (예: '명') */
  unit?: string
  className?: string
}) {
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      {SERVICES.map((s) => {
        const st = SERVICE_STYLE[s]
        return (
          <span key={s} className={`tabular inline-flex h-6 items-center rounded-full px-2.5 text-[13px] font-bold ${st.soft} ${st.ink}`}>
            {SERVICE_LABEL[s]} {s === 1 ? service1 : service2}
            {unit}
          </span>
        )
      })}
    </span>
  )
}

/** 범례: ■ 노랑 = 1부  ■ 민트 = 2부 */
export function ServiceLegend({ variant = 'screen', className = '' }: { variant?: SheetVariant; className?: string }) {
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      {SERVICES.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <ServiceSwatch service={s} variant={variant} />
          {SERVICE_COLOR_NAME[s]} = {SERVICE_LABEL[s]}
          {variant === 'print' ? ' 예배' : ''}
        </span>
      ))}
    </span>
  )
}
