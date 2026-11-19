import { useState } from 'react'
import { useStore } from '../../store'
import { copyText, shareText } from './share'

/**
 * 보고 글 복사·공유 버튼에서 쓰는 도우미.
 * copied 는 '방금 이 글을 복사했는지' (글이 바뀌면 저절로 false)
 */
export function useCopyShare(text: string) {
  const toast = useStore((s) => s.toast)
  const [copiedFor, setCopiedFor] = useState<string | null>(null)
  const copied = copiedFor !== null && copiedFor === text

  async function copy() {
    if (await copyText(text)) {
      setCopiedFor(text)
      toast('복사했어요. 단톡방에 붙여 넣으세요', 'success')
      window.setTimeout(() => setCopiedFor((v) => (v === text ? null : v)), 2500)
    } else {
      toast('복사하지 못했어요. 다시 눌러 주세요.', 'error')
    }
  }

  async function share() {
    const r = await shareText(text)
    if (r === 'failed') toast('공유하지 못했어요. 글 복사하기를 눌러 주세요.', 'error')
  }

  return { copied, copy, share }
}
