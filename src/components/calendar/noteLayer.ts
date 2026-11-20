/*
 * 휴대폰 회의록 층 (EventNotePage 가 써요). 편집기(Tiptap)와 따로 두어서, 편집기를 늦게 내려받는 구조를 깨지 않아요.
 *
 * 왜 필요해요?
 * - 키보드가 올라오면 아이폰은 페이지 전체를 위로 밀어 올리고(보이는 화면만 줄어요), 위쪽 띠(뒤로·도구 막대)도 같이 밀려나요.
 * - 그래서 회의록 화면 전체를 '보이는 화면(키보드 위)'에 딱 맞춘 고정 층으로 띄우고, 글은 그 안의 스크롤 칸에서만 움직여요.
 */

/**
 * 휴대폰: 회의록 층(layer)을 '보이는 화면'에 딱 맞춰요 (높이 = 키보드 위까지, 위치 = 보이는 화면 맨 위).
 * 그리고 페이지 자체는 굴러가지 않게 막아요. 글은 scroller 안에서만 움직여요.
 * 해제 함수를 돌려줘요.
 */
export function fitLayerToViewport(layer: HTMLElement, scroller: HTMLElement): () => void {
  const vv = window.visualViewport
  const root = document.documentElement
  const prevOverflow = root.style.overflow
  const prevOverscroll = root.style.overscrollBehavior
  root.style.overflow = 'hidden'
  root.style.overscrollBehavior = 'none'

  const update = () => {
    if (!vv) return
    layer.style.height = `${Math.round(vv.height)}px`
    const top = Math.max(0, Math.round(vv.offsetTop))
    layer.style.transform = top ? `translate3d(0, ${top}px, 0)` : ''
  }
  update()
  vv?.addEventListener('resize', update)
  vv?.addEventListener('scroll', update)
  window.addEventListener('scroll', update, { passive: true })

  // 아이폰은 overflow: hidden 이어도 키보드가 떠 있으면 페이지를 끌 수 있어요. 글 칸 밖이거나,
  // 글 칸이 이미 끝까지 굴러가 더 갈 곳이 없으면 그 손짓을 막아서 페이지(와 위쪽 띠)가 밀리지 않게 해요
  let startY = 0
  const onStart = (e: TouchEvent) => {
    if (e.touches.length === 1) startY = e.touches[0].clientY
  }
  const onMove = (e: TouchEvent) => {
    if (!e.cancelable || e.touches.length !== 1) return
    const target = e.target instanceof Node ? e.target : null
    if (target && scroller.contains(target)) {
      const dy = e.touches[0].clientY - startY
      const atTop = scroller.scrollTop <= 0
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1
      if (!((dy > 0 && atTop) || (dy < 0 && atBottom))) return
    }
    e.preventDefault()
  }
  layer.addEventListener('touchstart', onStart, { passive: true })
  layer.addEventListener('touchmove', onMove, { passive: false })

  return () => {
    vv?.removeEventListener('resize', update)
    vv?.removeEventListener('scroll', update)
    window.removeEventListener('scroll', update)
    layer.removeEventListener('touchstart', onStart)
    layer.removeEventListener('touchmove', onMove)
    layer.style.height = ''
    layer.style.transform = ''
    root.style.overflow = prevOverflow
    root.style.overscrollBehavior = prevOverscroll
  }
}
