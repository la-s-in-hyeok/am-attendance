import { useState } from 'react'
import { EVENT_COLORS, type CalEvent, type DayISO, type EventColor } from '../../lib/types'
import { addDays } from '../../lib/dates'
import { newId } from '../../lib/id'
import { useStore } from '../../store'
import { Confirm, FormGroup, Icon, PageSheet, isTouchDevice } from '../ui'
import { diffDays, labelRange } from './calDates'
import { EVENT_PALETTE, leastUsedColor } from './colors'
import { useCalendar } from './useCalendar'
import { afterHistorySettles } from './noteHistory'

/** 일정 추가(날짜를 채워서) 또는 수정 */
export type SheetTarget = { mode: 'add'; date: DayISO } | { mode: 'edit'; event: CalEvent }

const TITLE_MAX = 60
/** 양 끝을 포함해서 60일까지 */
const MAX_SPAN = 59
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 일정 추가·수정 창 (iOS 캘린더의 '새 이벤트'처럼 화면을 거의 다 덮는 페이지 시트).
 * 맨 위 [취소 · 새 일정 · 추가]: 키보드가 올라와도 저장 버튼이 가려지지 않아요.
 */
export function EventSheet({ target, onClose, onDeleted }: { target: SheetTarget | null; onClose: () => void; onDeleted?: (id: string) => void }) {
  if (!target) return null
  return <EventForm key={target.mode === 'edit' ? target.event.id : `add|${target.date}`} target={target} onClose={onClose} onDeleted={onDeleted} />
}

function EventForm({ target, onClose, onDeleted }: { target: SheetTarget; onClose: () => void; onDeleted?: (id: string) => void }) {
  const events = useCalendar((s) => s.events)
  const editing = target.mode === 'edit' ? target.event : null
  // 새 일정의 id 는 창을 열 때 한 번만 만들어요 (저장을 두 번 눌러도 일정은 하나)
  const [id] = useState(() => editing?.id ?? newId())
  const [title, setTitle] = useState(editing?.title ?? '')
  const [start, setStart] = useState<DayISO>(editing?.startDate ?? (target.mode === 'add' ? target.date : ''))
  const [end, setEnd] = useState<DayISO>(editing?.endDate ?? (target.mode === 'add' ? target.date : ''))
  const [multi, setMulti] = useState(editing ? editing.endDate !== editing.startDate : false)
  const [color, setColor] = useState<EventColor>(() => editing?.color ?? leastUsedColor(events))
  const [saving, setSaving] = useState(false)
  const [askDelete, setAskDelete] = useState(false)
  const [autoFocus] = useState(() => !editing && !isTouchDevice())

  const realEnd = multi ? end : start
  const t = title.trim()
  const titleOk = t.length >= 1 && t.length <= TITLE_MAX
  const datesOk = DATE_RE.test(start) && DATE_RE.test(realEnd) && realEnd >= start && diffDays(start, realEnd) <= MAX_SPAN
  const canSave = titleOk && datesOk && !saving

  const changeStart = (v: string) => {
    if (!DATE_RE.test(v)) {
      setStart(v)
      return
    }
    // 시작일을 바꾸면 기간(며칠짜리)은 그대로
    const span = DATE_RE.test(start) && DATE_RE.test(end) && end >= start ? diffDays(start, end) : 0
    setStart(v)
    setEnd(addDays(v, span))
  }

  const toggleMulti = () => {
    if (!multi && DATE_RE.test(start) && end <= start) setEnd(addDays(start, 1))
    setMulti(!multi)
  }

  const submit = async (rawTitle = title) => {
    const finalTitle = rawTitle.trim()
    if (saving || finalTitle.length < 1 || finalTitle.length > TITLE_MAX || !datesOk) return
    setSaving(true)
    const saved = await useCalendar.getState().save({ id, title: finalTitle, startDate: start, endDate: realEnd, color })
    setSaving(false)
    // 실패하면 창을 닫지 않고 입력을 그대로 둬요 (오류 토스트는 저장소가 띄워요)
    if (!saved) return
    useStore.getState().toast(editing ? '저장했어요' : '일정을 추가했어요', 'success')
    onClose()
  }

  return (
    <PageSheet
      open
      onClose={onClose}
      title={editing ? '일정 수정' : '새 일정'}
      // 저장하는 동안에는 버튼만 잠가요 (글자가 바뀌면 닫히며 내려가는 창에 '저장 중'이 남아 보여요)
      action={{ label: editing ? '저장' : '추가', onClick: () => void submit(), disabled: !canSave }}
    >
      <div className="space-y-7 px-4 pt-3">
        <FormGroup note={t.length > TITLE_MAX ? <span className="text-danger">제목은 {TITLE_MAX}자까지 쓸 수 있어요</span> : undefined}>
          <input
            aria-label="제목"
            value={title}
            maxLength={TITLE_MAX}
            placeholder="제목 (예: 볼링대회)"
            enterKeyHint="done"
            autoFocus={autoFocus}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              // 한글 조합 중에 누른 Enter 는 글자를 마무리하는 것이라 저장하지 않아요 (사파리는 keyCode 229)
              if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return
              e.preventDefault()
              void submit(e.currentTarget.value)
            }}
            className="h-[52px] w-full bg-transparent px-4 text-[17px] outline-none placeholder:text-ink-3/80"
          />
        </FormGroup>

        <FormGroup
          note={
            datesOk ? (
              <span className="tabular">
                {labelRange(start, realEnd, true)}
                {multi && ` · ${diffDays(start, realEnd) + 1}일`}
              </span>
            ) : (
              <span className="text-danger">
                {DATE_RE.test(start) && DATE_RE.test(realEnd) && realEnd >= start ? '여러 날 일정은 60일까지 만들 수 있어요' : '날짜를 확인해 주세요'}
              </span>
            )
          }
        >
          <button type="button" role="switch" aria-checked={multi} onClick={toggleMulti} className="flex min-h-[52px] w-full items-center justify-between gap-3 px-4 text-left">
            <span className="text-[17px]">여러 날</span>
            <span className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-300 ${multi ? 'bg-brand' : 'bg-track'}`} aria-hidden="true">
              <span
                className="absolute top-[2px] left-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_6px_rgb(0_0_0/0.18)] transition-transform duration-300 ease-[var(--ease-ios)]"
                style={{ transform: multi ? 'translate3d(20px, 0, 0)' : 'translate3d(0, 0, 0)' }}
              />
            </span>
          </button>
          <DateRow label={multi ? '시작' : '날짜'} value={start} onChange={changeStart} />
          {multi && (
            <DateRow
              label="끝"
              value={end}
              min={DATE_RE.test(start) ? start : undefined}
              max={DATE_RE.test(start) ? addDays(start, MAX_SPAN) : undefined}
              onChange={setEnd}
            />
          )}
        </FormGroup>

        <FormGroup label={<span id="ev-color-label">색</span>}>
          <div role="radiogroup" aria-labelledby="ev-color-label" className="grid grid-cols-8 px-1.5 py-1">
            {EVENT_COLORS.map((c) => {
              const p = EVENT_PALETTE[c]
              const on = c === color
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={p.label}
                  title={p.label}
                  onClick={() => setColor(c)}
                  className="flex h-12 min-w-0 items-center justify-center rounded-full"
                >
                  <span
                    className={`flex h-[28px] w-[28px] items-center justify-center rounded-full transition-[box-shadow,scale] duration-200 ${on ? 'scale-100' : 'scale-[0.92]'}`}
                    style={{
                      background: p.bg,
                      boxShadow: on ? `inset 0 0 0 2px ${p.dot}, 0 0 0 2px #fff, 0 0 0 4px ${p.ink}` : `inset 0 0 0 2px ${p.dot}`,
                    }}
                  >
                    {on && <Icon name="check" size={15} strokeWidth={2.8} className="text-ink" />}
                  </span>
                </button>
              )
            })}
          </div>
        </FormGroup>

        {editing && (
          <FormGroup>
            <button
              type="button"
              onClick={() => setAskDelete(true)}
              disabled={saving}
              className="flex min-h-[52px] w-full items-center justify-center text-[17px] font-semibold text-danger transition-colors active:bg-danger-soft disabled:opacity-50"
            >
              일정 지우기
            </button>
          </FormGroup>
        )}
      </div>

      {editing && (
        <Confirm
          open={askDelete}
          title="일정 지우기"
          message={`‘${editing.title}’ 일정과 회의록을 지울까요?`}
          confirmLabel="지우기"
          danger
          onClose={() => setAskDelete(false)}
          onConfirm={() => {
            void useCalendar.getState().remove(editing.id)
            // 확인 창이 자기 '뒤로 가기' 기록을 치운 다음에 이 창을 닫아요 (두 창이 한꺼번에 닫히면 기록이 남아요)
            afterHistorySettles(() => {
              onClose()
              onDeleted?.(editing.id)
            })
          }}
        />
      )}
    </PageSheet>
  )
}

/** 날짜 한 줄: 왼쪽 이름, 오른쪽 회색 알약 (누르면 기기의 날짜 고르기) */
function DateRow({ label, value, min, max, onChange }: { label: string; value: string; min?: string; max?: string; onChange: (v: string) => void }) {
  return (
    <label className="flex min-h-[52px] items-center justify-between gap-3 px-4">
      <span className="text-[17px]">{label}</span>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        required
        onChange={(e) => onChange(e.target.value)}
        className="date-pill tabular h-9 w-[9.5rem] min-w-0 shrink rounded-lg bg-muted px-2.5 text-center text-[16px] text-ink outline-none focus:ring-2 focus:ring-brand"
      />
    </label>
  )
}
