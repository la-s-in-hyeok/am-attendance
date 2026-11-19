import type { Backend } from './types'
import { LocalBackend } from './local'
import { SupabaseBackend } from './supabase'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Supabase 설정이 있으면 실제 서버, 없으면 체험 모드 */
export function createBackend(): Backend {
  if (url && key) return new SupabaseBackend(url, key)
  return new LocalBackend()
}
