import { useState } from 'react'
import { EVENT_COLORS, type CalEvent, type DayISO, type EventColor } from '../../lib/types'
import { addDays } from '../../lib/dates'
import { newId } from '../../lib/id'
import { useStore } from '../../store'
import { Button, Confirm, Icon, Sheet, TextField } from '../ui'
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

export function EventSheet({ target, onClose, onDeleted }: { target: SheetTarget | null; onClose: () => void; onDeleted?: (id: string) => void }) {
  return (
    <Sheet open={target !== null} onClose={onClose} title={target?.mode === 'edit' ? '일정 고치기' : '일정 추가'}>
      {target && (
        <EventForm key={target.mode === 'edit' ? target.event.id : `add|${target.date}`} target={target} onClose={onClose} onDeleted={onDeleted} />
      )}
    </Sheet>
  )
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
    <>
      <div className="space-y-5">
        <TextField
          label="제목"
          value={title}
          maxLength={TITLE_MAX}
          placeholder="예: 볼링대회"
          enterKeyHint="done"
          autoFocus={!editing}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            // 한글 조합 중에 누른 Enter 는 글자를 마무리하는 것이라 저장하지 않아요 (사파리는 keyCode 229)
            if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return
            e.preventDefault()
            void submit(e.currentTarget.value)
          }}
        />
        {t.length > TITLE_MAX && <p className="-mt-3 text-[13px] text-danger">제목은 {TITLE_MAX}자까지 쓸 수 있어요</p>}

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-ink-2">날짜</span>
            <button
              type="button"
              role="switch"
              aria-checked={multi}
              onClick={toggleMulti}
              className="relative -my-1 flex h-11 items-center gap-2 text-sm font-semibold text-ink-2"
            >
              여러 날
              <span className={`relative h-[26px] w-[44px] rounded-full transition ${multi ? 'bg-brand' : 'bg-track'}`} aria-hidden="true">
                <span
                  className={`absolute top-[3px] h-5 w-5 rounded-full bg-white shadow transition-[left] ${multi ? 'left-[21px]' : 'left-[3px]'}`}
                />
              </span>
            </button>
          </div>
          <div className={`grid gap-2 ${multi ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <DateInput label={multi ? '시작' : '날짜'} value={start} onChange={changeStart} />
            {multi && (
              <DateInput
                label="끝"
                value={end}
                min={DATE_RE.test(start) ? start : undefined}
                max={DATE_RE.test(start) ? addDays(start, MAX_SPAN) : undefined}
                onChange={setEnd}
              />
            )}
          </div>
          {datesOk ? (
            <p className="tabular mt-1.5 text-[13px] text-ink-3">
              {labelRange(start, realEnd, true)}
              {multi && ` · ${diffDays(start, realEnd) + 1}일`}
            </p>
          ) : (
            <p className="mt-1.5 text-[13px] text-danger">
              {DATE_RE.test(start) && DATE_RE.test(realEnd) && realEnd >= start ? '여러 날 일정은 60일까지 만들 수 있어요' : '날짜를 확인해 주세요'}
            </p>
          )}
        </div>

        <div>
          <span id="ev-color-label" className="mb-1.5 block text-sm font-medium text-ink-2">
            색
          </span>
          <div role="radiogroup" aria-labelledby="ev-color-label" className="flex flex-wrap gap-0.5">
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
                  className="flex h-11 w-11 items-center justify-center rounded-full"
                >
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-full transition ${on ? 'ring-2 ring-offset-2' : ''}`}
                    style={{ background: p.bg, boxShadow: `inset 0 0 0 2px ${p.dot}`, ['--tw-ring-color' as string]: p.ink }}
                  >
                    {on && <Icon name="check" size={16} strokeWidth={2.6} className="text-ink" />}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          {editing && (
            <Button variant="secondary" icon="trash" className="text-danger" onClick={() => setAskDelete(true)} disabled={saving}>
              삭제
            </Button>
          )}
          <Button className="flex-1" onClick={() => void submit()} disabled={!canSave}>
            {saving ? '저장하는 중…' : '저장'}
          </Button>
        </div>
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
    </>
  )
}

function DateInput({ label, value, min, max, onChange }: { label: string; value: string; min?: string; max?: string; onChange: (v: string) => void }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[13px] text-ink-3">{label}</span>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        required
        onChange={(e) => onChange(e.target.value)}
        className="h-12 w-full min-w-0 rounded-2xl border border-line bg-hover px-3 outline-none transition focus:border-brand focus:bg-surface"
      />
    </label>
  )
}
