/*
 * 회의록 페이지의 '뒤로 가기' 기록.
 * 열 때 history 에 { amNote: id } 를 하나 쌓아서 휴대폰 뒤로 가기가 회의록만 닫게 해요.
 * 창(Sheet)도 { amSheet } 를 쌓으므로, 위에 창 기록이 남아 있으면 그것이 빠진 뒤에 치워요.
 */

/** 닫혔지만 기록을 아직 치우지 않은 회의록 (바로 다시 열리면 그 자리를 이어 써요) */
let pendingBack: string | null = null

/** 지금 기록이 이 회의록 것인지 */
export function isNoteEntry(id: string): boolean {
  return history.state?.amNote === id
}

/** 회의록을 열 때: 기록을 하나 쌓아요 (이미 회의록 기록이 있으면 바꿔 써요) */
export function pushNoteEntry(id: string) {
  const st = (history.state ?? {}) as Record<string, unknown>
  // 방금 닫힌 회의록 기록이 아직 남아 있으면 치우지 않고 그 자리를 이어 써요 (React 개발 모드의 두 번 실행도 여기로)
  pendingBack = null
  if (st.amNote !== undefined) history.replaceState({ ...st, amNote: id }, '')
  else history.pushState({ ...st, amNote: id }, '')
}

/** 회의록을 닫을 때(뒤로 가기로 닫힌 게 아니면): 쌓아 둔 기록을 치워요 */
export function popNoteEntry(id: string) {
  pendingBack = id
  setTimeout(() => {
    if (pendingBack !== id) return
    pendingBack = null
    backWhenClear(id, 0)
  }, 0)
}

function backWhenClear(id: string, tries: number) {
  const st = history.state as Record<string, unknown> | null
  if (st?.amNote !== id) return
  if (st.amSheet === undefined) {
    history.back()
    return
  }
  // 위에 창 기록이 아직 있으면, 창이 자기 기록을 치울 때까지 기다려요
  if (tries > 8) return
  afterHistorySettles(() => backWhenClear(id, tries + 1))
}

/** 다음 popstate 가 오거나 잠깐(400ms) 지나면 fn 을 불러요 (창이 기록을 치우는 동안 기다리기) */
export function afterHistorySettles(fn: () => void) {
  let done = false
  const run = () => {
    if (done) return
    done = true
    window.removeEventListener('popstate', run)
    clearTimeout(timer)
    setTimeout(fn, 0)
  }
  window.addEventListener('popstate', run)
  const timer = setTimeout(run, 400)
}

/** 새로고침 뒤에 남아 있는 회의록 기록 지우기 (회의록이 안 열려 있는데 기록만 있으면) */
export function dropStaleNoteEntry() {
  const st = history.state as Record<string, unknown> | null
  if (!st || st.amNote === undefined || pendingBack !== null) return
  const rest = { ...st }
  delete rest.amNote
  history.replaceState(rest, '')
}
