import { useRef, useState } from 'react'
import type { Group, ISODate, ReportFile } from '../../lib/types'
import { useStore } from '../../store'
import { Button, Confirm, Icon, Sheet } from '../ui'
import { StateIcon } from '../report/StatusGrid'
import { useGroupReports } from './useGroupReports'
import { useUploadFlow, type Converted, type FlowState } from './useUploadFlow'
import { PreviewStrip, PreviewViewer, usePreviewUrls } from './PagePreviews'
import { openReportPdf, useReportUrl } from './ReportUrl'
import { kstDateTime, sizeLabel } from './format'

/**
 * 목장 하나의 보고서 창.
 * - 마감 전·안 냄: '보고서 올리기' → PDF로 바꾸기 → 미리 보기 → [이대로 제출]
 * - 냄: 파일 카드 + [PDF 보기] (+ 마감 전 [다른 파일로 바꾸기] [삭제])
 * - 마감 후: 낸 목장은 보기만, 안 낸 목장은 안내만
 */
export function GroupSheet({
  date,
  group,
  file,
  closed,
  onClose,
}: {
  date: ISODate
  group: Group | null
  file: ReportFile | undefined
  closed: boolean
  onClose: () => void
}) {
  return (
    <Sheet open={group !== null} onClose={onClose} title={group ? `${group.name} 목장 보고서` : undefined}>
      {group && <SheetBody key={`${date}|${group.id}`} date={date} group={group} file={file} closed={closed} onClose={onClose} />}
    </Sheet>
  )
}

function SheetBody({
  date,
  group,
  file,
  closed,
  onClose,
}: {
  date: ISODate
  group: Group
  file: ReportFile | undefined
  closed: boolean
  onClose: () => void
}) {
  const flow = useUploadFlow(date, group.id, group.name, onClose)
  const input = useRef<HTMLInputElement>(null)
  const [askDelete, setAskDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const choose = () => input.current?.click()
  const st = flow.state

  const picker = (
    <input
      ref={input}
      type="file"
      // 확장자로 좁히지 않아요: 아이폰에서 hwp 가 회색으로 막혀서 고를 수 없어요. 고른 뒤에 검사해요
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(e) => {
        const f = e.target.files?.[0]
        // 같은 파일을 다시 골라도 알 수 있게 비워 둬요
        e.target.value = ''
        if (f) void flow.pick(f)
      }}
    />
  )

  const del = async () => {
    if (deleting) return
    setDeleting(true)
    const ok = await useGroupReports.getState().remove(date, group.id)
    setDeleting(false)
    if (ok) useStore.getState().toast(`${group.name} 목장 보고서를 지웠어요`, 'info')
  }

  // 올리는 흐름 중이면 그 화면
  if (st.step !== 'idle') {
    return (
      <>
        {picker}
        <FlowView state={st} closed={closed} onSubmit={() => void flow.submit()} onRepick={choose} onCancel={flow.reset} onClose={onClose} />
      </>
    )
  }

  return (
    <>
      {picker}
      <StatusLine done={!!file} closed={closed} />
      {file ? (
        <>
          <FileCard file={file} />
          <div className="mt-4 space-y-2">
            <ViewPdfButton path={file.path} />
            {!closed && (
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" icon="folder" onClick={choose} disabled={deleting}>
                  다른 파일로 바꾸기
                </Button>
                <Button variant="secondary" className="shrink-0 text-danger" icon="trash" onClick={() => setAskDelete(true)} disabled={deleting}>
                  {deleting ? '지우는 중…' : '삭제'}
                </Button>
              </div>
            )}
          </div>
          {closed && <p className="mt-3 text-[13px] leading-relaxed text-ink-3">마감돼서 바꾸거나 지울 수 없어요.</p>}
        </>
      ) : closed ? (
        <ClosedNote />
      ) : (
        <>
          <Button size="lg" icon="folder" className="w-full" onClick={choose}>
            보고서 올리기
          </Button>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-3">
            한글(hwp·hwpx), 워드(docx), PDF, 사진을 고르면 PDF로 바꿔서 내요. 마감 전에는 언제든 지우고 다시 올릴 수 있어요.
          </p>
        </>
      )}
      <Confirm
        open={askDelete}
        title="보고서 지우기"
        message={`${group.name} 목장 보고서를 지울까요? 지우면 다시 올릴 수 있어요.`}
        confirmLabel="지우기"
        danger
        onClose={() => setAskDelete(false)}
        onConfirm={() => void del()}
      />
    </>
  )
}

function StatusLine({ done, closed }: { done: boolean; closed: boolean }) {
  return (
    <p className={`mb-3 inline-flex items-center gap-1.5 text-[14px] font-bold ${done ? 'text-ok' : 'text-danger'}`}>
      <StateIcon done={done} />
      {done ? '제출' : '미제출'}
      {closed && (
        <span className="ml-1 inline-flex items-center gap-1 font-semibold text-ink-3">
          <Icon name="lock" size={14} /> 마감됨
        </span>
      )}
    </p>
  )
}

function ClosedNote() {
  return (
    <div className="flex items-start gap-2.5 rounded-2xl bg-muted p-4 text-[15px] leading-relaxed text-ink-2" role="note">
      <Icon name="lock" size={18} className="mt-0.5 shrink-0 text-ink-3" />
      마감돼서 더 올릴 수 없어요.
    </div>
  )
}

function FileCard({ file }: { file: ReportFile }) {
  const when = kstDateTime(file.uploadedAt)
  const size = sizeLabel(file.sizeBytes)
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-line bg-hover p-3.5">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ok-soft text-ok" aria-hidden="true">
        <Icon name="doc" size={22} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-snug font-bold [overflow-wrap:anywhere]">{file.fileName}</p>
        <p className="tabular mt-0.5 text-[13px] text-ink-2">
          {file.pages > 0 ? `${file.pages}쪽` : 'PDF'}
          {size && ` · ${size}`}
        </p>
        {when && <p className="mt-0.5 text-[13px] text-ink-3">{when}에 냄</p>}
      </div>
    </div>
  )
}

/** 'PDF 보기': 주소를 미리 받아 두었으면 링크로 바로, 아니면 누를 때 받아서 */
function ViewPdfButton({ path }: { path: string }) {
  const url = useReportUrl(path)
  const look =
    'inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-brand px-4 text-[15px] font-semibold text-white shadow-[0_4px_12px_rgb(10_114_180/0.25)] transition hover:bg-brand-deep active:bg-brand-deep'
  if (url)
    return (
      <a href={url} target="_blank" rel="noopener" className={look}>
        <Icon name="doc" size={18} />
        PDF 보기
      </a>
    )
  return (
    <button type="button" className={look} onClick={() => void openReportPdf(path)}>
      <Icon name="doc" size={18} />
      PDF 보기
    </button>
  )
}

/* ───────────── 올리는 흐름 화면 ───────────── */

function FlowView({
  state,
  closed,
  onSubmit,
  onRepick,
  onCancel,
  onClose,
}: {
  state: Exclude<FlowState, { step: 'idle' }>
  closed: boolean
  onSubmit: () => void
  onRepick: () => void
  onCancel: () => void
  onClose: () => void
}) {
  if (state.step === 'converting') {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center" role="status" aria-live="polite">
        <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-line border-t-brand" aria-hidden="true" />
        <p className="text-[16px] font-bold">{state.text}</p>
        <p className="text-[13px] text-ink-3">파일은 이 기기 안에서 바뀌어요.</p>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          그만하기
        </Button>
      </div>
    )
  }
  if (state.step === 'closed' || (closed && state.step === 'preview')) {
    return (
      <>
        <ClosedNote />
        <Button variant="secondary" className="mt-4 w-full" onClick={onClose}>
          닫기
        </Button>
      </>
    )
  }
  if (state.step === 'error') {
    return (
      <>
        <div className="rounded-2xl border border-danger-line bg-danger-soft p-4" role="alert">
          <p className="text-[15px] leading-relaxed font-semibold text-danger">{state.message}</p>
          {state.hint && <p className="mt-2 text-[14px] leading-relaxed text-ink-2">한글·워드에서 'PDF로 저장'한 파일을 올려도 돼요.</p>}
        </div>
        {/* 좁은 휴대폰에서도 글자가 두 줄로 꺾이지 않게 위아래로 */}
        <div className="mt-4 flex flex-col gap-2 min-[400px]:flex-row-reverse">
          <Button className="min-[400px]:flex-1" icon="folder" onClick={onRepick}>
            다른 파일 고르기
          </Button>
          <Button variant="secondary" className="min-[400px]:flex-1" onClick={onCancel}>
            취소
          </Button>
        </div>
      </>
    )
  }
  return <PreviewStep result={state.result} uploading={state.step === 'uploading'} onSubmit={onSubmit} onRepick={onRepick} />
}

function PreviewStep({ result, uploading, onSubmit, onRepick }: { result: Converted; uploading: boolean; onSubmit: () => void; onRepick: () => void }) {
  const urls = usePreviewUrls(result.previews)
  const [viewAt, setViewAt] = useState<number | null>(null)
  return (
    <>
      <p className="mb-2 text-[14px] leading-snug text-ink-2">
        <b className="font-bold text-ink [overflow-wrap:anywhere]">{result.fileName}</b>
        <span className="tabular"> · {result.pages}쪽</span>
      </p>
      {urls.length > 0 ? (
        <>
          <p className="mb-1.5 text-[13px] text-ink-3">이렇게 낼게요. 쪽을 누르면 크게 볼 수 있어요.</p>
          <PreviewStrip urls={urls} onOpen={setViewAt} />
        </>
      ) : (
        <div className="mb-3 flex items-center gap-3 rounded-2xl border border-line bg-hover p-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand" aria-hidden="true">
            <Icon name="doc" size={22} />
          </span>
          <p className="tabular text-[16px] font-bold">{result.pages}쪽 PDF</p>
        </div>
      )}
      {result.warnings.length > 0 && (
        <ul className="mb-3 space-y-1 rounded-2xl bg-accent-soft p-3 text-[14px] leading-relaxed text-accent-soft-ink" role="note">
          {result.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {!result.isPdf && (
        <p className="mb-4 text-[13px] leading-relaxed text-ink-3">
          글꼴 모양은 원본과 조금 다를 수 있어요. 내용이 깨졌으면 한글·워드에서 PDF로 저장해서 올려 주세요.
        </p>
      )}
      <div className="flex flex-col gap-2 min-[400px]:flex-row-reverse">
        <Button className="min-[400px]:flex-1" onClick={onSubmit} disabled={uploading} aria-busy={uploading}>
          {uploading ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
              올리는 중…
            </>
          ) : (
            '이대로 제출'
          )}
        </Button>
        <Button variant="secondary" className="min-[400px]:flex-1" onClick={onRepick} disabled={uploading}>
          다른 파일 고르기
        </Button>
      </div>
      {viewAt !== null && urls.length > 0 && <PreviewViewer urls={urls} start={viewAt} onClose={() => setViewAt(null)} />}
    </>
  )
}
