import { useCallback, useState } from 'react'
import type { ISODate, Status } from '../../lib/types'
import { SERVICE_LABEL, STATUS_LABEL } from '../../lib/types'
import { recKey, serviceOf } from '../../lib/compute'
import { labelMD } from '../../lib/dates'
import { useStore } from '../../store'
import { Button, Icon, STATUS_STYLE, Sheet } from '../ui'

type AbsentStatus = Exclude<Status, 'present'>

const OPTIONS: { status: AbsentStatus; desc: string; border: string }[] = [
  { status: 'away', desc: '다른 지역에 있어요', border: 'border-away' },
  { status: 'nocontact', desc: '연락이 닿지 않아요', border: 'border-nocontact' },
  { status: 'other', desc: '사유를 직접 적어요', border: 'border-other' },
]

/** 기타 사유 빠른 입력 */
const QUICK_REASONS = ['일', '아픔', '여행', '늦잠', '다른 교회', '가족 행사']

interface Props {
  memberId: string
  date: ISODate
  onClose: () => void
}

/**
 * 결석 사유 고르기.
 * - 타지·연락두절: 누르면 바로 저장하고 닫힌다 (메모를 적어 두었으면 함께 저장)
 * - 기타: 사유를 적고 저장 (빈 사유는 저장 안 됨)
 */
export function AbsenceSheet({ memberId, date, onClose }: Props) {
  const member = useStore((s) => s.members.find((m) => m.id === memberId))
  const record = useStore((s) => s.records[recKey(date, memberId)])
  const groups = useStore((s) => s.groups)
  const setStatus = useStore((s) => s.setStatus)
  const clearStatus = useStore((s) => s.clearStatus)

  // 처음 열 때의 기록으로 칸을 채운다
  const [initial] = useState(() => record)
  const [mode, setMode] = useState<'pick' | 'other'>(initial?.status === 'other' ? 'other' : 'pick')
  const [reason, setReason] = useState(initial?.status === 'other' ? initial.reason : '')
  const initialMemo = initial && (initial.status === 'away' || initial.status === 'nocontact') ? initial.reason : ''
  const [memo, setMemo] = useState(initialMemo)
  const [memoOpen, setMemoOpen] = useState(initialMemo !== '')
  /** 기타를 직접 눌렀을 때만 입력칸에 바로 커서를 둔다 (열자마자 키보드가 뜨지 않게) */
  const [otherTapped, setOtherTapped] = useState(false)

  const pick = useCallback(
    (status: AbsentStatus) => {
      if (status === 'other') {
        setMode('other')
        setOtherTapped(true)
        if (!reason.trim() && memo.trim()) setReason(memo.trim())
        return
      }
      void setStatus(memberId, status, memo, date)
      onClose()
    },
    [reason, memo, setStatus, memberId, date, onClose],
  )

  const saveOther = () => {
    const r = reason.trim()
    if (!r) return
    void setStatus(memberId, 'other', r, date)
    onClose()
  }

  if (!member) return null

  const groupName = groups.find((g) => g.id === (record?.groupId ?? member.groupId))?.name
  const now = !record
    ? '미확인'
    : record.status === 'present'
      ? `${SERVICE_LABEL[serviceOf(record) ?? 1]} 출석`
      : `${STATUS_LABEL[record.status]}${record.reason ? ` · ${record.reason}` : ''}`

  return (
    <Sheet
      open
      onClose={onClose}
      title={member.name}
      footer={
        record ? (
          <Button
            variant="ghost"
            icon="undo"
            className="w-full"
            onClick={() => {
              void clearStatus(memberId, date)
              onClose()
            }}
          >
            미확인으로 되돌리기
          </Button>
        ) : undefined
      }
    >
      <p className="-mt-1 mb-4 text-sm text-ink-3">
        {labelMD(date)}
        {groupName ? ` · ${groupName}` : ''} · 지금 <span className="font-semibold text-ink-2">{now}</span>
      </p>

      <p className="mb-2 text-[15px] font-bold">왜 못 왔나요?</p>
      <div className="flex flex-col gap-2">
        {OPTIONS.map((o) => {
          const st = STATUS_STYLE[o.status]
          const isCurrent = record?.status === o.status
          const active = o.status === 'other' ? mode === 'other' || isCurrent : isCurrent
          return (
            <div key={o.status}>
              <button
                type="button"
                onClick={() => pick(o.status)}
                className={`flex h-16 w-full items-center gap-3 rounded-2xl border-2 px-4 text-left transition active:scale-[0.99] ${
                  active ? `${st.soft} ${o.border}` : 'border-transparent bg-bg hover:bg-[#f0f0ec]'
                }`}
              >
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${active ? 'bg-surface' : st.soft}`}>
                  <span className={`h-3 w-3 rounded-full ${st.dot}`} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-[17px] font-bold ${active ? st.ink : 'text-ink'}`}>{STATUS_LABEL[o.status]}</span>
                  <span className="block text-[13px] text-ink-3">{o.desc}</span>
                </span>
                {isCurrent ? (
                  <Icon name="check" size={20} strokeWidth={2.6} className={st.ink} />
                ) : o.status !== 'other' ? (
                  <Icon name="chevronRight" size={18} className="text-ink-3" />
                ) : null}
              </button>

              {o.status === 'other' && mode === 'other' && (
                <div className="anim-fade mt-2 rounded-2xl bg-other-soft/60 p-3">
                  <input
                    autoFocus={otherTapped}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                        e.preventDefault()
                        saveOther()
                      }
                    }}
                    enterKeyHint="done"
                    placeholder="예: 다른 교회 다님, 일, 늦잠"
                    aria-label="기타 사유"
                    className="h-12 w-full rounded-xl border border-line bg-surface px-4 outline-none transition placeholder:text-ink-3 focus:border-other"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    {QUICK_REASONS.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setReason(q)}
                        className={`h-11 rounded-full px-4 text-[14px] font-semibold transition sm:h-9 sm:px-3.5 ${
                          reason.trim() === q ? 'bg-other text-white' : 'bg-surface text-other-ink hover:bg-white/70'
                        }`}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                  <Button className="mt-3 w-full" size="lg" disabled={!reason.trim()} onClick={saveOther}>
                    기타로 저장
                  </Button>
                  {!reason.trim() && <p className="mt-2 text-center text-[13px] text-ink-3">사유를 적어야 저장할 수 있어요</p>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {mode === 'pick' &&
        (memoOpen ? (
          <div className="anim-fade mt-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink-2">메모 (선택)</span>
              <input
                autoFocus={initialMemo === ''}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="예: 안산, 군대, 해외"
                enterKeyHint="done"
                className="h-12 w-full rounded-2xl border border-line bg-[#fafaf8] px-4 outline-none transition placeholder:text-ink-3 focus:border-ink focus:bg-surface"
              />
            </label>
            <p className="mt-1.5 text-[13px] text-ink-3">메모를 적고 위에서 타지나 연락두절을 누르면 함께 저장돼요.</p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setMemoOpen(true)}
            className="mt-3 inline-flex h-11 items-center gap-1.5 rounded-xl px-1 text-sm font-semibold text-ink-3 hover:text-ink-2"
          >
            <Icon name="plus" size={16} />
            메모 함께 적기 (선택)
          </button>
        ))}
    </Sheet>
  )
}

/** 결석 시트를 여닫는 훅. 열려 있는 동안만 시트를 그린다 */
export function useAbsenceSheet(date: ISODate) {
  const [memberId, setMemberId] = useState<string | null>(null)
  const close = useCallback(() => setMemberId(null), [])
  const open = useCallback((id: string) => {
    // 완료된 목장 사람은 결석 창을 열지 않고 안내만 한다 (사유를 적어도 저장되지 않으니까)
    const s = useStore.getState()
    if (s.isMemberLocked(id, date)) {
      s.toastLocked()
      return
    }
    setMemberId(id)
  }, [date])
  const element = memberId ? <AbsenceSheet key={`${date}|${memberId}`} memberId={memberId} date={date} onClose={close} /> : null
  return { open, element }
}
