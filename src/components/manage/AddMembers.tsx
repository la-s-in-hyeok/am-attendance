import { useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'
import type { Group, ISODate, Member } from '../../lib/types'
import { sundayOnOrBefore } from '../../lib/dates'
import { Button, Card, Icon, Segmented, TextArea } from '../ui'
import { Callout, SameNameNotice } from './parts'
import { cleanName, findSameName, labelDay, normName, onEnter, parseNames, restoreGapNote, suffixExample } from './lib'
import { useGroupMap, useRosterSplit } from './useManage'

type Mode = 'one' | 'many'

/** 목장원 추가: 한 명씩 / 여러 명 한꺼번에 */
export function AddMembers({ group }: { group: Group }) {
  const date = useStore((s) => s.date)
  const addMembers = useStore((s) => s.addMembers)
  const restoreMember = useStore((s) => s.restoreMember)
  const toast = useStore((s) => s.toast)
  const { current, removed } = useRosterSplit()
  const groupMap = useGroupMap()

  const [mode, setMode] = useState<Mode>('one')
  const [name, setName] = useState('')
  const [bulk, setBulk] = useState('')
  const [pickedDate, setPickedDate] = useState<ISODate | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const joinedOn = pickedDate ?? date

  /* ── 한 명 ── */
  const one = cleanName(name)
  const oneHasSeparator = /[,，、\n]/.test(name)
  const oneMatches = useMemo(() => findSameName(one, current), [one, current])
  const oneRemoved = useMemo(() => removed.filter((m) => normName(m.name) === normName(one)), [removed, one])

  async function addOne() {
    if (!one || busy) return
    if (oneHasSeparator) {
      switchToMany(name)
      return
    }
    setBusy(true)
    const added = await addMembers(group.id, [one], joinedOn)
    setBusy(false)
    // 실패하면 store 가 오류를 알려 준다. 넣은 이름은 그대로 두어 다시 누를 수 있게
    if (added.length === 0) return
    setName('')
    toast(`${one}님을 ${group.name} 목장에 추가했어요`, 'success')
    inputRef.current?.focus()
  }

  async function restoreHere(m: Member) {
    if (busy) return
    setBusy(true)
    // 다시 넣으면서 이 목장으로 옮기는 것까지 한 번에 저장한다
    const ok = await restoreMember(m.id, group.id)
    setBusy(false)
    if (!ok) return
    setName('')
    toast(`${m.name}님을 다시 ${group.name} 목장 명단에 넣었어요`, 'success')
  }

  /* ── 여러 명 ── */
  const tokens = useMemo(() => parseNames(bulk), [bulk])
  const analysis = useMemo(() => {
    const seen = new Set<string>()
    return tokens.map((t) => {
      const key = normName(t)
      const repeated = seen.has(key)
      seen.add(key)
      const existing = findSameName(t, current)
      const wasRemoved = removed.filter((m) => normName(m.name) === key)
      return { name: t, repeated, existing, wasRemoved }
    })
  }, [tokens, current, removed])
  const repeatedNames = [...new Set(analysis.filter((a) => a.repeated).map((a) => a.name))]
  const existingHits = analysis.filter((a) => !a.repeated && a.existing.length > 0)
  const removedHits = analysis.filter((a) => !a.repeated && a.wasRemoved.length > 0)
  /** 구분 예시에 쓸 이름 (걸린 이름 중 첫 번째) */
  const flaggedName = existingHits[0]?.name ?? repeatedNames[0] ?? removedHits[0]?.name ?? '김철수'

  function switchToMany(text: string) {
    setBulk(text)
    setName('')
    setMode('many')
  }

  function dropToken(i: number) {
    setBulk(tokens.filter((_, j) => j !== i).join(', '))
  }

  async function addMany() {
    if (tokens.length === 0 || busy) return
    setBusy(true)
    const added = await addMembers(group.id, tokens, joinedOn)
    setBusy(false)
    if (added.length === 0) return
    setBulk('')
    toast(`${added.length}명을 ${group.name} 목장에 추가했어요`, 'success')
  }

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[16px] font-bold">목장원 추가</h3>
        <Segmented<Mode>
          value={mode}
          onChange={setMode}
          className="shrink-0 whitespace-nowrap max-md:*:h-11"
          options={[
            { value: 'one', label: '한 명' },
            { value: 'many', label: '여러 명' },
          ]}
        />
      </div>

      {mode === 'one' ? (
        <>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={name}
              maxLength={20}
              placeholder="이름 (예: 홍길동)"
              enterKeyHint="done"
              aria-label="추가할 이름"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={onEnter(() => void addOne())}
              className="h-12 min-w-0 flex-1 rounded-2xl border border-line bg-[#fafaf8] px-4 outline-none transition placeholder:text-ink-3 focus:border-ink focus:bg-surface"
            />
            <button
              type="button"
              disabled={!one || busy}
              onClick={() => void addOne()}
              className="inline-flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-2xl bg-present px-5 text-[15px] font-semibold text-ink transition hover:brightness-[0.97] active:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Icon name="plus" size={18} />
              추가
            </button>
          </div>

          {oneHasSeparator && (
            <Callout className="mt-2" icon="users">
              여러 명을 넣으시려는 것 같아요.{' '}
              <button type="button" className="font-bold underline underline-offset-2" onClick={() => switchToMany(name)}>
                ‘여러 명’으로 넣기
              </button>
            </Callout>
          )}
          {!oneHasSeparator && <SameNameNotice name={one} matches={oneMatches} className="mt-2" />}
          {!oneHasSeparator &&
            oneRemoved.map((m) => (
              <Callout key={m.id} className="mt-2" icon="undo">
                <p>
                  명단에서 뺀 사람 중에 <b>{m.name}</b>님({groupMap.get(m.groupId)?.name ?? '?'})이 있어요. 같은 분이면 새로 넣지 말고
                  다시 넣어 주세요. 지난 출석 기록이 이어져요.
                </p>
                {restoreGapNote(m, date) && <p className="mt-1 text-ink-3">{restoreGapNote(m, date)}</p>}
                <Button size="sm" variant="secondary" className="mt-2" disabled={busy} onClick={() => void restoreHere(m)}>
                  {m.name}님 다시 넣기
                </Button>
              </Callout>
            ))}
        </>
      ) : (
        <>
          <TextArea
            value={bulk}
            rows={3}
            placeholder={'김철수, 이영희, 박민수\n또는 한 줄에 한 명씩 붙여 넣어도 돼요'}
            aria-label="추가할 이름들"
            onChange={(e) => setBulk(e.target.value)}
          />
          <p className="mt-1.5 px-1 text-[13px] text-ink-3">쉼표, 띄어쓰기, 줄바꿈으로 나눠요.</p>

          {tokens.length > 0 && (
            <div className="mt-3">
              <p className="mb-2 px-1 text-[13px] font-semibold text-ink-2">미리 보기 · {tokens.length}명</p>
              <div className="flex flex-wrap gap-1.5">
                {analysis.map((a, i) => {
                  const warn = a.repeated || a.existing.length > 0 || a.wasRemoved.length > 0
                  return (
                    <span
                      key={`${a.name}-${i}`}
                      className={`inline-flex h-9 items-center gap-0.5 rounded-full pr-1 pl-3 text-[14px] font-semibold ${
                        warn ? 'bg-danger/10 text-danger' : 'bg-present-soft text-present-ink'
                      }`}
                    >
                      {a.name}
                      <button
                        type="button"
                        aria-label={`${a.name} 빼기`}
                        onClick={() => dropToken(i)}
                        // 보이는 크기는 작게, 누르는 자리는 44px 가깝게 (after 로 넓힌다)
                        className="relative flex h-8 w-8 items-center justify-center rounded-full after:absolute after:-inset-1.5 hover:bg-black/5"
                      >
                        <Icon name="x" size={14} />
                      </button>
                    </span>
                  )
                })}
              </div>

              {(repeatedNames.length > 0 || existingHits.length > 0 || removedHits.length > 0) && (
                <Callout tone="warn" icon="users" className="mt-3">
                  {repeatedNames.length > 0 && <p>두 번 적은 이름: {repeatedNames.join(', ')}</p>}
                  {existingHits.map((a) => (
                    <p key={`e-${a.name}`}>
                      {a.name} → 이미 {a.existing.map((m) => `${m.name}(${groupMap.get(m.groupId)?.name ?? '?'})`).join(', ')}
                    </p>
                  ))}
                  {removedHits.map((a) => (
                    <p key={`r-${a.name}`}>{a.name} → 명단에서 뺀 사람 중에 있어요. 같은 분이면 ‘한 명’에서 다시 넣으면 기록이 이어져요.</p>
                  ))}
                  <p className="mt-1">다른 분이면 {suffixExample(flaggedName)}처럼 구분해 주세요. 그래도 그대로 넣을 수 있어요. 빨간 이름은 ×로 뺄 수 있어요.</p>
                </Callout>
              )}
            </div>
          )}

          <Button size="lg" className="mt-4 w-full" icon="plus" disabled={tokens.length === 0 || busy} onClick={() => void addMany()}>
            {tokens.length > 0 ? `${tokens.length}명 추가하기` : '이름을 넣어 주세요'}
          </Button>
        </>
      )}

      {/* 언제부터 명단에 나오는지 */}
      <label className="relative mt-3 flex min-h-11 cursor-pointer flex-wrap items-center gap-x-1.5 px-1 text-[13px] text-ink-3">
        <Icon name="calendar" size={15} className="shrink-0" />
        <span>
          <b className="text-ink-2">{labelDay(joinedOn)} 출석부</b>부터 명단에 나와요
        </span>
        <span className="ml-1 font-semibold text-ink-2 underline underline-offset-2">날짜 바꾸기</span>
        <input
          type="date"
          aria-label="명단에 넣을 주일 고르기"
          className="absolute inset-0 cursor-pointer opacity-0"
          value={joinedOn}
          onClick={(e) => {
            // PC 브라우저에서도 눌렀을 때 달력이 바로 뜨게
            try {
              e.currentTarget.showPicker?.()
            } catch {
              /* 지원하지 않는 브라우저 */
            }
          }}
          onChange={(e) => {
            const v = e.target.value
            if (v) setPickedDate(sundayOnOrBefore(v))
          }}
        />
      </label>
    </Card>
  )
}
