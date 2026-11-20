import { useCallback, useEffect, useRef, useState } from 'react'
import type { ISODate } from '../../lib/types'
import { useStore } from '../../store'
import { useGroupReports } from './useGroupReports'
import { MAX_PDF_BYTES } from './format'

/*
 * 보고서 올리기 흐름: 파일 고르기 → PDF로 바꾸기(진행 표시) → 미리 보기 → [이대로 제출] → 올리기.
 * 변환 모듈(src/lib/convert)은 크니까 처음 쓸 때만 내려받아요 (import()).
 */

/** 변환 결과 중 화면에 쓰는 것 */
export interface Converted {
  fileName: string
  pdf: Uint8Array
  pages: number
  /** 원래 PDF 였는지 (미리 보기 그림이 없어요) */
  isPdf: boolean
  previews: Blob[]
  warnings: string[]
}

export type FlowState =
  | { step: 'idle' }
  | { step: 'converting'; text: string }
  | { step: 'preview'; result: Converted }
  | { step: 'uploading'; result: Converted }
  | { step: 'error'; message: string; hint: boolean }
  | { step: 'closed' }

const FIRST_TEXT = '변환 프로그램 받는 중… (처음 한 번만)'
const WAIT_TEXT = '앞에서 고른 파일을 정리하는 중… 잠시만 기다려 주세요'

/**
 * 아직 끝나지 않은 변환 수 (이 화면 전체에서).
 * 변환은 한 번에 하나씩이고 '그만하기'로 멈출 수 없어서, 그만둔 파일이 끝나야 다음 파일을 시작해요
 */
let converting = 0

/** 변환 진행 (변환 모듈의 ConvertProgress 와 같은 모양) */
interface Progress {
  stage: 'prepare' | 'render' | 'pdf'
  page?: number
  pages?: number
}

function progressText(p: Progress, isPdf: boolean): string {
  if (p.stage === 'prepare') return isPdf ? 'PDF 살펴보는 중…' : FIRST_TEXT
  if (p.stage === 'render') {
    if (p.page && p.pages) return `${p.pages}쪽 중 ${p.page}쪽 바꾸는 중…`
    return 'PDF로 바꾸는 중…'
  }
  return 'PDF 만드는 중…'
}

/** 변환 모듈의 오류 코드 (모듈을 내려받기 전에도 쓸 수 있게 모양만 봐요) */
function convertCode(e: unknown): string | undefined {
  const x = e as { name?: string; code?: unknown } | null
  return x && typeof x.code === 'string' && x.name === 'ConvertError' ? x.code : undefined
}

export function useUploadFlow(date: ISODate, groupId: string, groupName: string, onDone: () => void) {
  const [state, setState] = useState<FlowState>({ step: 'idle' })
  /** 창을 닫거나 다른 파일을 고르면 하던 변환 결과는 버려요 */
  const run = useRef(0)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(
    () => () => {
      run.current++
    },
    [],
  )

  const pick = useCallback(async (file: File) => {
    const my = ++run.current
    const alive = () => run.current === my
    setState({ step: 'converting', text: '파일을 살펴보는 중…' })
    try {
      const conv = await import('../../lib/convert')
      if (!alive()) return
      const kind = await conv.detectKind(file)
      if (!alive()) return
      if (kind === 'doc') {
        setState({ step: 'error', message: "옛 워드 파일(.doc)은 바꿀 수 없어요. 워드에서 'docx'나 'PDF'로 저장해서 올려 주세요.", hint: false })
        return
      }
      if (kind === null) {
        setState({ step: 'error', message: '이 파일은 올릴 수 없어요. 한글(hwp·hwpx), 워드(docx), PDF, 사진 파일을 골라 주세요.', hint: true })
        return
      }
      conv.preloadConverter(kind)
      // 그만둔 앞 파일을 아직 바꾸는 중이면 그 차례를 기다린다고 알려요 (내 차례가 오면 진행 글로 바뀌어요)
      if (converting > 0) setState({ step: 'converting', text: WAIT_TEXT })
      else if (kind !== 'pdf') setState({ step: 'converting', text: FIRST_TEXT })
      converting++
      let out: Awaited<ReturnType<typeof conv.convertToPdf>>
      try {
        out = await conv.convertToPdf(file, (p: Progress) => {
          if (alive()) setState({ step: 'converting', text: progressText(p, kind === 'pdf') })
        })
      } finally {
        converting--
      }
      if (!alive()) return
      if (out.pdf.byteLength > MAX_PDF_BYTES) {
        setState({ step: 'error', message: '바꾼 PDF가 너무 커요 (45MB까지). 쪽수를 줄이거나 사진 크기를 줄여서 다시 올려 주세요.', hint: true })
        return
      }
      setState({
        step: 'preview',
        result: { fileName: file.name, pdf: out.pdf, pages: out.pages, isPdf: out.kind === 'pdf', previews: out.previews, warnings: out.warnings },
      })
    } catch (e) {
      console.error(e)
      if (!alive()) return
      const code = convertCode(e)
      const msg = e instanceof Error && /[가-힣]/.test(e.message) ? e.message : ''
      if (code) {
        // 안내 문장에 이미 'PDF로 저장' 이야기가 있으면 같은 말을 두 번 하지 않아요
        const message = msg || '파일을 PDF로 바꾸지 못했어요.'
        setState({ step: 'error', message, hint: !/PDF로 저장|PDF'로 저장/.test(message) })
      } else {
        // 변환 모듈을 받지 못했어요 (대개 인터넷 문제)
        setState({ step: 'error', message: msg || '변환 프로그램을 받지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.', hint: false })
      }
    }
  }, [])

  const submit = useCallback(async () => {
    if (state.step !== 'preview') return
    const result = state.result
    const my = ++run.current
    setState({ step: 'uploading', result })
    const outcome = await useGroupReports.getState().upload(date, groupId, result.pdf, result.fileName, result.pages)
    if (outcome === 'ok') {
      useStore.getState().toast(`${groupName} 목장 보고서를 냈어요`, 'success')
      if (run.current === my) {
        setState({ step: 'idle' })
        onDoneRef.current()
      }
      return
    }
    if (run.current !== my) return
    setState(outcome === 'closed' ? { step: 'closed' } : { step: 'preview', result })
  }, [state, date, groupId, groupName])

  const reset = useCallback(() => {
    run.current++
    setState({ step: 'idle' })
  }, [])

  return { state, pick, submit, reset }
}
