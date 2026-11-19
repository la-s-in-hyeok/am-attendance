import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import { serviceOf } from '../../lib/compute'
import { currentSunday } from '../../lib/dates'
import type { GroupDay, ISODate } from '../../lib/types'
import { SERVICE_LABEL } from '../../lib/types'
import { groupDayKey, useStore } from '../../store'
import { useWeek } from '../../hooks'
import { Button, Confirm, Empty, Icon, SERVICE_STYLE, StackBar, SyncBadge } from '../ui'
import { MemberRow } from './MemberRow'
import { useAbsenceSheet } from './AbsenceSheet'
import { AddMemberInline } from './AddMemberInline'
import { CompactWeekSwitcher } from './CompactWeekSwitcher'
import { useToggleAttendance } from './attendUtils'
import { ServiceSwitch, useServiceMode } from './serviceMode'

/** 목장 하나의 출석 체크 화면 */
export function GroupDetail({ groupId }: { groupId: string }) {
  const { date, week } = useWeek()
  const gw = week.find((g) => g.group.id === groupId)
  const fallbackName = useStore((s) => s.groups.find((g) => g.id === groupId)?.name)
  const openGroup = useStore((s) => s.openGroup)
  const setDate = useStore((s) => s.setDate)
  const day = useStore((s) => s.groupDays[groupDayKey(date, groupId)])
  const toastLocked = useStore((s) => s.toastLocked)
  const service = useServiceMode((s) => s.service)
  const toggle = useToggleAttendance(date)
  const absence = useAbsenceSheet(date)

  // 완료된 목장은 실수로 바뀌지 않게 잠가 둬요 ('수정'을 누르면 다시 고칠 수 있어요)
  const locked = day?.state === 'done'
  const onLocked = useCallback(() => toastLocked(), [toastLocked])

  // 목장을 열면 맨 위부터
  useLayoutEffect(() => {
    window.scrollTo(0, 0)
  }, [groupId])

  const back = useCallback(() => {
    // 휴대폰 '뒤로 가기'와 같은 길로 닫아야 방문 기록이 꼬이지 않는다
    if ((history.state as { group?: string } | null)?.group) history.back()
    else openGroup(null)
  }, [openGroup])

  const names = useMemo(() => (gw ? gw.entries.map((e) => e.member.name) : []), [gw])

  const thisSunday = currentSunday()
  const name = gw?.group.name ?? fallbackName ?? '목장'
  const c = gw?.summary

  return (
    <div className="anim-fade">
      {/* 위쪽 고정 막대 */}
      {/* 좌우 여백은 App 의 main 여백(가로 모드 노치 포함)과 맞춘다 */}
      <div className="sticky top-0 z-30 -mt-3 mr-[calc(-1*max(1rem,env(safe-area-inset-right)))] ml-[calc(-1*max(1rem,env(safe-area-inset-left)))] border-b border-line/70 bg-bg/90 pt-[max(env(safe-area-inset-top),0.75rem)] pr-[max(1rem,env(safe-area-inset-right))] pb-3 pl-[max(1rem,env(safe-area-inset-left))] backdrop-blur-xl md:-mx-8 md:-mt-8 md:px-8 md:pt-6">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={back}
            aria-label="목장 목록으로"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-brand shadow-[var(--shadow-card)] ring-1 ring-line transition hover:bg-brand-soft active:bg-brand-soft"
          >
            <Icon name="chevronLeft" size={24} strokeWidth={2.4} />
          </button>
          <h1 className="line-clamp-2 min-w-0 flex-1 text-[21px] leading-tight font-bold tracking-tight [overflow-wrap:anywhere] md:text-[23px]">
            {name}
          </h1>
          <CompactWeekSwitcher />
        </div>
        {c && (
          <>
            {/* 1부/2부 고르기는 목록을 내려도 늘 보이도록 고정 막대에 둔다 */}
            <div className="mt-2 flex min-h-11 items-center justify-between gap-2 text-[14px]">
              <p className="tabular min-w-0 truncate font-semibold text-ink-2">
                출석 <span className="text-[16px] font-bold text-brand">{c.present}</span>
                <span className="text-ink-3"> / 총원 {c.total}</span>
                <span className="text-ink-3"> · 미확인 </span>
                <span className={c.unchecked > 0 ? 'font-bold text-ink' : 'text-ink-3'}>{c.unchecked}</span>
              </p>
              {locked ? (
                <span className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-ok-line bg-ok-soft pr-3 pl-1.5 text-[13px] font-bold text-ok">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ok-icon text-white">
                    <Icon name="check" size={14} strokeWidth={3} />
                  </span>
                  완료
                </span>
              ) : (
                <ServiceSwitch compact className="shrink-0" />
              )}
            </div>
            <StackBar
              className="mt-1.5"
              present={c.present}
              service2={c.service2}
              away={c.away}
              nocontact={c.nocontact}
              other={c.other}
              total={c.total}
            />
          </>
        )}
      </div>

      {date < thisSunday && (
        <Notice tone="past" onAction={() => setDate(thisSunday)} action="이번 주로">
          지난 주일 출석부를 수정하고 있어요
        </Notice>
      )}
      {date > thisSunday && (
        <Notice tone="future" onAction={() => setDate(thisSunday)} action="이번 주로">
          다음 주 출석부를 미리 보고 있어요
        </Notice>
      )}

      {!gw ? (
        <div className="mt-4 rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)]">
          <Empty title="이 주일 출석부에는 이 목장이 없어요">보관된 목장이거나 이 주일에는 기록이 없어요.</Empty>
          <div className="flex justify-center pb-8">
            <Button variant="secondary" icon="chevronLeft" onClick={back}>
              목장 목록으로
            </Button>
          </div>
        </div>
      ) : (
        <>
          {locked ? (
            <div className="h-3" />
          ) : (
            <div className="mt-3 mb-3 flex items-center justify-between gap-3 px-0.5">
              <p className="min-w-0 text-[13px] leading-snug text-ink-3">
                이름을 누르면{' '}
                <span className={`rounded-md px-1.5 py-px font-bold ${SERVICE_STYLE[service].soft} ${SERVICE_STYLE[service].ink}`}>
                  {SERVICE_LABEL[service]}
                </span>{' '}
                출석, 한 번 더 누르면 취소돼요
              </p>
              {day?.state === 'editing' ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2.5 py-0.5 text-[13px] font-bold text-accent-soft-ink">
                  <Icon name="edit" size={12} strokeWidth={2.4} />
                  수정 중
                </span>
              ) : gw.summary.total > 0 && gw.summary.unchecked === 0 ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-bold text-ok">
                  <Icon name="check" size={14} strokeWidth={2.8} className="text-ok-icon" />
                  모두 확인했어요
                </span>
              ) : (
                <span className="shrink-0">
                  <SyncBadge />
                </span>
              )}
            </div>
          )}

          {gw.entries.length === 0 ? (
            <div className="rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)]">
              <Empty title="이 주일 명단에 목장원이 없어요">아래에서 이름을 적어 새 가족을 추가해 주세요.</Empty>
            </div>
          ) : (
            <div className="@container">
              <div className="grid grid-cols-1 gap-2 @2xl:grid-cols-2">
                {gw.entries.map((e) => (
                  <MemberRow
                    key={e.member.id}
                    member={e.member}
                    status={e.status}
                    service={serviceOf(e.record)}
                    reason={e.record?.reason ?? ''}
                    onToggle={locked ? onLocked : toggle}
                    onAbsent={locked ? onLocked : absence.open}
                    locked={locked}
                  />
                ))}
              </div>
            </div>
          )}

          {locked ? (
            <button
              type="button"
              onClick={onLocked}
              className="mt-3 flex h-14 w-full items-center gap-2 rounded-2xl border-2 border-dashed border-line pl-3.5 text-left font-medium text-ink-3"
            >
              <Icon name="lock" size={18} className="shrink-0" />이 목장에 새 가족 추가
            </button>
          ) : (
            <AddMemberInline groupId={gw.group.id} groupName={gw.group.name} date={date} existingNames={names} />
          )}

          {date <= thisSunday && gw.entries.length > 0 && (
            <CompleteBar groupId={gw.group.id} date={date} day={day} unchecked={gw.summary.unchecked} />
          )}
        </>
      )}

      {absence.element}
    </div>
  )
}

/** "오전 11:42" (그 주일이 아닌 날 눌렀으면 "11/16 오전 9:10") */
function doneTimeLabel(iso: string | null, date: ISODate): string {
  if (!iso) return ''
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  try {
    const time = t.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Seoul' })
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(t)
    const get = (k: string) => parts.find((p) => p.type === k)?.value ?? ''
    const ymd = `${get('year')}-${get('month')}-${get('day')}`
    return ymd === date ? time : `${Number(get('month'))}/${Number(get('day'))} ${time}`
  } catch {
    return ''
  }
}

/** 화면 아래 고정: 완료 / 수정 / 수정 완료 */
function CompleteBar({ groupId, date, day, unchecked }: { groupId: string; date: ISODate; day: GroupDay | undefined; unchecked: number }) {
  const completeGroup = useStore((s) => s.completeGroup)
  const editGroup = useStore((s) => s.editGroup)
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState(false)
  const state = day?.state ?? 'open'

  const run = async (fn: () => Promise<boolean>) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }
  const complete = () => void run(() => completeGroup(groupId, date))
  const label = state === 'editing' ? '수정 완료' : '완료'
  const when = day ? doneTimeLabel(day.doneAt, date) : ''

  return (
    <>
      <div className="kb-hide sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 mt-5 md:bottom-6 md:mx-auto md:max-w-md">
        {/* 완료 = 초록 막대(체크·글자 함께), 완료 전·수정 중 = 파란 큰 버튼 */}
        <div
          className={`rounded-[24px] p-2 shadow-[var(--shadow-pop)] ring-1 backdrop-blur-xl ${
            state === 'done' ? 'bg-ok-soft/95 ring-ok-line' : 'bg-surface/95 ring-line'
          }`}
        >
          {state === 'done' ? (
            <div className="flex items-center gap-3 pl-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ok-icon text-white">
                <Icon name="check" size={19} strokeWidth={3} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[16px] leading-tight font-bold text-ok">완료</p>
                {(when || (day && day.editCount > 0)) && (
                  <p className="tabular mt-0.5 flex flex-wrap gap-x-1 text-[13px] leading-snug font-medium text-ink-2">
                    {[when, day && day.editCount > 0 ? `수정 ${day.editCount}번` : ''].filter(Boolean).map((t, i) => (
                      <span key={t} className="whitespace-nowrap">
                        {i > 0 && '· '}
                        {t}
                      </span>
                    ))}
                  </p>
                )}
              </div>
              <Button variant="secondary" size="lg" icon="edit" disabled={busy} className="shrink-0 px-4" onClick={() => void run(() => editGroup(groupId, date))}>
                수정
              </Button>
            </div>
          ) : (
            <Button variant="primary" size="lg" icon="check" className="w-full text-[18px] font-bold" disabled={busy} onClick={() => (unchecked > 0 ? setAsk(true) : complete())}>
              {label}
            </Button>
          )}
        </div>
      </div>
      <Confirm
        open={ask}
        title={`미확인 ${unchecked}명이 남아 있어요`}
        message="그래도 완료할까요?"
        confirmLabel={label}
        onConfirm={complete}
        onClose={() => setAsk(false)}
      />
    </>
  )
}

function Notice({
  tone,
  children,
  action,
  onAction,
}: {
  tone: 'past' | 'future'
  children: string
  action: string
  onAction: () => void
}) {
  return (
    <div
      className={`mt-3 flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold ${
        tone === 'past' ? 'bg-accent-soft text-accent-soft-ink' : 'bg-brand-soft text-brand-ink'
      }`}
    >
      <Icon name={tone === 'past' ? 'edit' : 'calendar'} size={16} className="shrink-0" />
      <span className="min-w-0 flex-1">{children}</span>
      <button
        type="button"
        onClick={onAction}
        className="relative h-9 shrink-0 rounded-full bg-surface px-3.5 text-[13px] font-bold text-brand shadow-[0_1px_3px_rgb(16_42_67/0.1)] before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']"
      >
        {action}
      </button>
    </div>
  )
}
