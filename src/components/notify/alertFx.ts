import type { NoticeKind } from '../../lib/types'

/**
 * 완료 알림의 소리·진동.
 * 브라우저는 사람이 화면을 한 번 누른 뒤에만 소리를 낼 수 있어서, 처음 누를 때 소리 장치를 깨워 둬요.
 */

let ctx: AudioContext | null = null

type AudioCtor = typeof AudioContext

export function unlockAudio() {
  try {
    const AC: AudioCtor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext
    if (!AC) return
    if (!ctx) ctx = new AC()
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
  } catch {
    ctx = null
  }
}

function tone(c: AudioContext, freq: number, start: number, length: number, gain = 0.16) {
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  g.gain.setValueAtTime(0.0001, start)
  g.gain.exponentialRampToValueAtTime(gain, start + 0.015)
  g.gain.exponentialRampToValueAtTime(0.0001, start + length)
  osc.connect(g).connect(c.destination)
  osc.start(start)
  osc.stop(start + length + 0.02)
}

/** 완료 = 딩동, 수정 = 띠띠띠 */
export function chime(kind: NoticeKind) {
  const c = ctx
  if (!c || c.state !== 'running') return
  try {
    const t = c.currentTime + 0.01
    if (kind === 'done') {
      tone(c, 880, t, 0.22)
      tone(c, 1318.5, t + 0.16, 0.34)
    } else {
      tone(c, 1318.5, t, 0.12)
      tone(c, 1318.5, t + 0.15, 0.12)
      tone(c, 1760, t + 0.3, 0.26)
    }
  } catch {
    /* 소리를 못 내도 괜찮아요 */
  }
}

export function buzz(kind: NoticeKind) {
  try {
    // 화면을 한 번도 누르지 않았으면 브라우저가 막아요 (콘솔 오류만 남아서 건너뛰어요)
    const ua = (navigator as { userActivation?: { hasBeenActive: boolean } }).userActivation
    if (ua && !ua.hasBeenActive) return
    navigator.vibrate?.(kind === 'done' ? [120, 60, 120] : [80, 50, 80, 50, 160])
  } catch {
    /* 진동을 못 쓰는 기기 (아이폰 등) */
  }
}
