import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { handleReportAuthError, koreanMessage } from './useGroupReports'

/*
 * 'PDF 보기' 주소. 서버 주소는 10분만 쓸 수 있어서, 창을 열 때 미리 받아 두고(8분 안이면 그대로)
 * 누르면 <a target=_blank> 로 바로 열어요. 아이폰 홈 화면 앱에서도 앱 화면을 떠나지 않고 열려요.
 * 아직 못 받았으면 누를 때 빈 창을 먼저 열고(팝업 막기 피하기) 주소를 받으면 그 창에 넣어요.
 */

const FRESH_MS = 8 * 60_000

/** 체험 모드의 blob 주소는 잠시 뒤에 치워요 (막 연 새 창이 다 읽을 때까지 기다려요) */
function revokeLater(url: string) {
  if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function useReportUrl(path: string | null): string | null {
  const [got, setGot] = useState<{ path: string; url: string; at: number } | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!path) return
    let alive = true
    let made: string | null = null
    useStore
      .getState()
      .backend.reportFileUrl(path)
      .then((url) => {
        made = url
        if (alive) setGot({ path, url, at: Date.now() })
        else revokeLater(url)
      })
      .catch((e) => {
        // 미리 받기 실패는 조용히 (누를 때 다시 받아요)
        console.error(e)
        handleReportAuthError(e)
      })
    // 주소가 낡기 전에 새로 받아요
    const t = setTimeout(() => alive && setTick((n) => n + 1), FRESH_MS)
    return () => {
      alive = false
      clearTimeout(t)
      if (made) revokeLater(made)
    }
  }, [path, tick])

  if (!path || !got || got.path !== path || Date.now() - got.at > FRESH_MS) return null
  return got.url
}

/** 누를 때 주소를 받아서 여는 방법 (미리 받지 못했을 때) */
export async function openReportPdf(path: string): Promise<void> {
  // 누른 바로 그때 빈 창을 열어야 팝업으로 막히지 않아요
  let w: Window | null = null
  try {
    w = window.open('', '_blank')
  } catch {
    w = null
  }
  try {
    const url = await useStore.getState().backend.reportFileUrl(path)
    if (w && !w.closed) {
      try {
        w.opener = null
      } catch {
        /* 무시 */
      }
      w.location.href = url
      revokeLater(url)
    } else {
      // 새 창이 막혔으면 이 화면에서 열어요
      revokeLater(url)
      location.assign(url)
    }
  } catch (e) {
    w?.close()
    console.error(e)
    if (handleReportAuthError(e)) return
    useStore.getState().toast(koreanMessage(e, 'PDF를 열지 못했어요. 인터넷 연결을 확인해 주세요.'), 'error')
  }
}
