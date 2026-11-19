import { useStore } from '../../store'
import { Button, Sheet } from '../ui'
import { Callout } from './parts'

function Steps({ title, steps }: { title: string; steps: string[] }) {
  return (
    <div className="rounded-2xl border border-line p-4">
      <p className="mb-3 text-[15px] font-bold">{title}</p>
      <ol className="space-y-2.5">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-ink-2">
            <span className="tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-present text-[13px] font-bold text-ink">
              {i + 1}
            </span>
            <span className="min-w-0">{s}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** 홈 화면에 추가하는 방법 */
export function HomeScreenHelpSheet({ onClose }: { onClose: () => void }) {
  const toast = useStore((s) => s.toast)
  const url = `${location.origin}${location.pathname}`

  function copy() {
    const done = () => toast('주소를 복사했어요. 단톡방에 붙여 넣어 공유해 보세요', 'success')
    const fail = () => toast('복사하지 못했어요. 주소창의 주소를 길게 눌러 복사해 주세요', 'error')
    try {
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, fail)
      else fail()
    } catch {
      fail()
    }
  }

  return (
    <Sheet open onClose={onClose} title="홈 화면에 추가하기">
      <p className="mb-4 text-[15px] leading-relaxed text-ink-2">홈 화면에 추가하면 앱처럼 아이콘을 눌러 바로 열 수 있어요.</p>
      <div className="space-y-3">
        <Steps
          title="아이폰 (사파리)"
          steps={['사파리로 출석부 주소를 열어요', '아래쪽 공유 버튼(네모에서 화살표가 나오는 모양)을 눌러요', '‘홈 화면에 추가’를 누르고, 오른쪽 위 ‘추가’를 눌러요']}
        />
        <Steps
          title="안드로이드 (크롬)"
          steps={['크롬으로 출석부 주소를 열어요', '오른쪽 위 ⋮ (점 세 개) 메뉴를 눌러요', '‘홈 화면에 추가’ 또는 ‘앱 설치’를 눌러요']}
        />
      </div>
      <Callout className="mt-3" icon="kakao">
        카카오톡에서 링크를 눌러 열었다면, 먼저 메뉴(⋮ 또는 ⋯)에서 ‘다른 브라우저로 열기’를 눌러 사파리·크롬으로 열어 주세요. 삼성 인터넷은 아래쪽 ≡
        메뉴에서 ‘현재 페이지 추가’ → ‘홈 화면’을 눌러요.
      </Callout>
      <Button variant="secondary" icon="copy" className="mt-4 w-full" onClick={copy}>
        출석부 주소 복사하기
      </Button>
    </Sheet>
  )
}
