import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// 새 버전을 올린 뒤, 예전 화면을 열어 둔 휴대폰이 없어진 예전 조각 파일을 부르면 한 번만 새로 고쳐요
// (그대로 두면 '인터넷 연결을 확인해 주세요' 같은 엉뚱한 안내가 떠요)
window.addEventListener('vite:preloadError', (e) => {
  if (!navigator.onLine) return
  try {
    const last = Number(sessionStorage.getItem('am-attendance:chunk-reload') || 0)
    if (Date.now() - last < 60_000) return
    sessionStorage.setItem('am-attendance:chunk-reload', String(Date.now()))
  } catch {
    return
  }
  e.preventDefault()
  location.reload()
})

// 홈 화면에 추가했을 때 오프라인에서도 앱 화면이 뜨도록
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  })
}
