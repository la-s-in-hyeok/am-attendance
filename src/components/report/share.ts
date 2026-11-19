/** 복사·공유·파일 받기 도우미 (휴대폰 사파리·크롬에서도 되도록) */

/** 글 복사. 성공하면 true */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 아래 방법으로 다시 시도 */
  }
  // 예전 방식: 보이지 않는 입력칸에 넣고 선택해서 복사
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('aria-hidden', 'true')
  ta.style.position = 'fixed'
  ta.style.top = '0'
  ta.style.left = '0'
  ta.style.width = '1px'
  ta.style.height = '1px'
  ta.style.opacity = '0'
  ta.style.fontSize = '16px' // iOS 확대 방지
  document.body.appendChild(ta)
  try {
    ta.focus()
    ta.select()
    ta.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(ta)
  }
}

export function canShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
}

/** 휴대폰 공유 창. 'shared' | 'cancelled' | 'failed' */
export async function shareText(text: string): Promise<'shared' | 'cancelled' | 'failed'> {
  if (!canShare()) return 'failed'
  try {
    await navigator.share({ text })
    return 'shared'
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
    return 'failed'
  }
}

/** 파일 받기: blob 주소를 만들어 링크를 눌러 준다. 주소는 잠시 뒤에 정리 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  // iOS 사파리는 파일을 다 읽기 전에 주소를 없애면 실패하므로 넉넉히 기다린다
  setTimeout(() => {
    URL.revokeObjectURL(url)
    a.remove()
  }, 60_000)
}

export const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const
