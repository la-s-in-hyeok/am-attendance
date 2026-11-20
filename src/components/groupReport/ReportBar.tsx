import { useMemo, useState } from 'react'
import type { Group, ISODate } from '../../lib/types'
import { useStore } from '../../store'
import { Button, Confirm } from '../ui'
import { downloadBlob } from '../report/share'
import { useGroupReports, type MergePart, type MergeState } from './useGroupReports'
import { canShareFile, mergedFileName } from './format'

/** 화면 아래에 붙는 막대 (출석보고의 '글 복사' 막대와 같은 자리·모양) */
const BAR =
  'kb-hide sticky bottom-[calc(65px+env(safe-area-inset-bottom))] z-10 mt-4 mr-[calc(-1*max(1rem,env(safe-area-inset-right)))] ml-[calc(-1*max(1rem,env(safe-area-inset-left)))] flex gap-2.5 border-t border-line bg-bg/95 py-3 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] backdrop-blur-xl md:pointer-events-none md:bottom-6 md:mx-0 md:justify-end md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none'

/** 마감 전: [마감하기] → 안 낸 목장을 알려 주는 확인 창 → 마감하고 합치기 */
export function CloseBar({ date, groups, missing, submitted }: { date: ISODate; groups: Group[]; missing: Group[]; submitted: number }) {
  const [ask, setAsk] = useState(false)
  const [busy, setBusy] = useState(false)
  const order = groups.length > 1 ? `${groups[0].name} → ${groups[groups.length - 1].name} 순서로 ` : ''
  const merge = submitted > 0 ? `낸 보고서 ${submitted}개를 ${order}한 PDF로 합쳐요.` : '아직 낸 보고서가 없어요.'
  const message =
    missing.length > 0
      ? `아직 안 낸 목장 ${missing.length}곳: ${missing.map((g) => g.name).join(', ')}. 마감하면 이 목장들은 더 올릴 수 없어요. ${merge}`
      : `모든 목장이 냈어요. 마감하면 더 바꾸거나 지울 수 없어요. ${merge}`

  const run = async () => {
    if (busy) return
    setBusy(true)
    const ok = await useGroupReports.getState().close(date)
    setBusy(false)
    if (ok) useStore.getState().toast(submitted > 0 ? '마감했어요. 보고서를 합치는 중이에요' : '마감했어요', 'success')
  }

  return (
    <>
      <div className={BAR}>
        <Button icon="lock" className="pointer-events-auto flex-1 md:min-w-64 md:flex-none" onClick={() => setAsk(true)} disabled={busy}>
          {busy ? '마감하는 중…' : '마감하기'}
        </Button>
      </div>
      <Confirm
        open={ask}
        title="이번 주 보고서 마감하기"
        message={message}
        confirmLabel={submitted > 0 ? '마감하고 합치기' : '마감하기'}
        onClose={() => setAsk(false)}
        onConfirm={() => void run()}
      />
    </>
  )
}

/** 마감 후: [합친 PDF 받기] [공유]. 합친 PDF 는 미리 준비해 둬요 */
export function MergedBar({ date, merge, parts }: { date: ISODate; merge: MergeState | null; parts: MergePart[] }) {
  const name = mergedFileName(date)
  const ready = merge?.status === 'ready' && merge.blob ? merge.blob : null
  const file = useMemo(() => (ready ? new File([ready], name, { type: 'application/pdf' }) : null), [ready, name])
  const shareable = file !== null && canShareFile(file)
  const empty = parts.length === 0
  const working = !empty && (!merge || merge.status === 'working')
  const failed = merge?.status === 'error'

  const download = () => {
    if (!ready) return
    downloadBlob(ready, name)
  }
  const share = async () => {
    if (!file) return
    try {
      await navigator.share({ files: [file], title: name.replace(/\.pdf$/, '') })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      console.error(e)
      useStore.getState().toast('공유하지 못했어요. [합친 PDF 받기]로 받아서 보내 주세요.', 'error')
    }
  }

  return (
    <div className={BAR}>
      {failed ? (
        <Button
          className="pointer-events-auto flex-1 md:min-w-64 md:flex-none"
          icon="undo"
          onClick={() => void useGroupReports.getState().prepareMerge(date, parts, true)}
        >
          다시 합치기
        </Button>
      ) : (
        <Button
          icon={working ? undefined : 'download'}
          className="pointer-events-auto flex-1 md:min-w-64 md:flex-none md:shadow-[var(--shadow-card)]"
          disabled={!ready}
          aria-busy={working}
          onClick={download}
        >
          {working && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />}
          {working ? '합치는 중…' : '합친 PDF 받기'}
        </Button>
      )}
      {shareable && (
        <Button variant="secondary" icon="share" className="pointer-events-auto shrink-0 md:shadow-[var(--shadow-card)]" onClick={() => void share()}>
          공유
        </Button>
      )}
    </div>
  )
}
