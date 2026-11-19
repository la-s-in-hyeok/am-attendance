import { useCallback } from 'react'
import { useStore } from '../../store'
import { recKey, serviceOf } from '../../lib/compute'
import type { ISODate } from '../../lib/types'
import { useServiceMode } from './serviceMode'

/* ───────────── 이름 찾기 (초성 검색 지원) ───────────── */

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']

function choOf(ch: string): string | null {
  const c = ch.charCodeAt(0) - 0xac00
  return c >= 0 && c <= 11171 ? CHO[Math.floor(c / 588)] : null
}

function isJamo(ch: string): boolean {
  return /^[ㄱ-ㅎ]$/.test(ch)
}

function charMatch(q: string, n: string): boolean {
  if (q === n) return true
  // 'ㄱ' 은 '김'과 같은 첫소리로 본다
  return isJamo(q) && choOf(n) === q
}

/** '홍길동' 은 '길동', 'ㅎㄱㄷ', '홍ㄱ' 으로 찾을 수 있다 */
export function matchName(name: string, query: string): boolean {
  const q = [...query.replace(/\s+/g, '').toLowerCase()]
  if (q.length === 0) return false
  const n = [...name.replace(/\s+/g, '').toLowerCase()]
  for (let i = 0; i + q.length <= n.length; i++) {
    let ok = true
    for (let j = 0; j < q.length; j++) {
      if (!charMatch(q[j], n[i + j])) {
        ok = false
        break
      }
    }
    if (ok) return true
  }
  return false
}

/* ───────────── 출석 토글 ───────────── */

function tick() {
  try {
    navigator.vibrate?.(8)
  } catch {
    /* 진동을 못 쓰는 기기 */
  }
}

/**
 * 이름을 눌렀을 때 (지금 고른 예배 = service):
 * - 미확인·결석(타지·연락두절·기타) → 그 예배 출석
 * - 같은 예배로 출석 → 미확인 (취소)
 * - 다른 예배로 출석 → 고른 예배로 바꿈 (1부 ↔ 2부)
 * 콜백은 날짜·예배가 같으면 그대로라서 줄(MemberRow) 메모이즈가 깨지지 않는다.
 */
export function useToggleAttendance(date: ISODate) {
  const service = useServiceMode((s) => s.service)
  return useCallback(
    (memberId: string) => {
      const s = useStore.getState()
      // 완료된 목장이면 안내만 하고 아무것도 바꾸지 않는다 (되돌리기 안내도 띄우지 않게)
      if (s.isMemberLocked(memberId, date)) {
        s.toastLocked()
        return
      }
      const cur = s.records[recKey(date, memberId)]
      if (cur?.status === 'present' && serviceOf(cur) === service) {
        void s.clearStatus(memberId, date)
      } else {
        tick()
        void s.markPresent(memberId, service, date)
        // 결석으로 적어 둔 사람을 잘못 눌렀을 때 사유가 사라지지 않도록 '되돌리기'를 준다
        if (cur && cur.status !== 'present') {
          const name = s.members.find((m) => m.id === memberId)?.name ?? ''
          const prev = cur
          s.toast(`${name}님을 ${service}부 출석으로 바꿨어요`, 'info', {
            label: '되돌리기',
            run: () => void useStore.getState().setStatus(memberId, prev.status, prev.reason, prev.date),
          })
        }
      }
    },
    [date, service],
  )
}
