import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const hasUrl = Boolean(env.VITE_SUPABASE_URL?.trim())
  const hasKey = Boolean(env.VITE_SUPABASE_ANON_KEY?.trim())

  // 배포용 빌드인데 서버 설정이 빠졌으면 멈춘다.
  // (모르고 '체험 모드'로 배포하면 각자 휴대폰에만 저장돼서 출석이 모이지 않는다)
  // 일부러 체험판을 만들 때만: VITE_DEMO=1 npm run build
  if (command === 'build' && env.VITE_DEMO !== '1') {
    if (!hasUrl || !hasKey) {
      const missing = [!hasUrl && 'VITE_SUPABASE_URL', !hasKey && 'VITE_SUPABASE_ANON_KEY'].filter(Boolean).join(', ')
      throw new Error(
        `\n\n[출석부] Supabase 설정이 없어요: ${missing}\n` +
          `app/.env 파일(또는 Vercel·Netlify의 환경 변수)에 값을 넣고 다시 빌드해 주세요. README의 '실제로 모두가 함께 쓰기'를 보세요.\n` +
          `체험판을 일부러 만들려면: VITE_DEMO=1 npm run build\n`,
      )
    }
  }

  // 알림(앱을 꺼 두어도 받는 푸시)은 VITE_VAPID_PUBLIC_KEY 가 있어야 켜진다. 빌드는 하되 알려 준다
  if (command === 'build' && env.VITE_DEMO !== '1' && !env.VITE_VAPID_PUBLIC_KEY?.trim()) {
    console.warn(
      '\n[출석부] VITE_VAPID_PUBLIC_KEY 가 없어요. 앱을 꺼 둔 휴대폰에는 완료 알림이 가지 않아요 (앱을 열어 둔 사람에게는 가요). README의 알림 설정을 보세요.\n',
    )
  }

  return {
    plugins: [react(), tailwindcss()],
    base: './',
    build: {
      chunkSizeWarningLimit: 1500,
    },
  }
})
