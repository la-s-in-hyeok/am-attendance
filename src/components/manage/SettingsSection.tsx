import { useMemo, useState, type ReactNode } from 'react'
import { useStore } from '../../store'
import { heldSundays } from '../../lib/compute'
import { useRecordList } from '../../hooks'
import { Card, Confirm } from '../ui'
import { HomeScreenHelpSheet } from './HomeScreenHelpSheet'
import { PasscodeSheet } from './PasscodeSheet'
import { ListCard, MenuRow, SectionTitle } from './parts'
import { downloadBackup, resetDemoData } from './lib'
import { useRosterSplit } from './useManage'

type Open = null | 'pass' | 'help' | 'logout' | 'reset'

/** 설정: 비밀번호, 백업, 홈 화면 추가, 로그아웃, 앱 정보 */
export function SettingsSection() {
  const mode = useStore((s) => s.backend.mode)
  const logout = useStore((s) => s.logout)
  const toast = useStore((s) => s.toast)
  const groups = useStore((s) => s.groups)
  const { current, removed } = useRosterSplit()
  const records = useRecordList()
  const [open, setOpen] = useState<Open>(null)
  const [backingUp, setBackingUp] = useState(false)

  const activeGroups = groups.filter((g) => !g.archived).length
  const sundays = useMemo(() => heldSundays(records).size, [records])

  async function backup() {
    if (backingUp) return
    setBackingUp(true)
    try {
      const res = await downloadBackup()
      toast(
        res.partial ? '서버에 연결이 안 돼서 지금 화면에 있는 내용으로 백업했어요' : `백업 파일을 저장했어요 (출석 기록 ${res.records}건)`,
        res.partial ? 'info' : 'success',
      )
    } catch (e) {
      console.error(e)
      toast('백업 파일을 만들지 못했어요. 다시 해 주세요', 'error')
    } finally {
      setBackingUp(false)
    }
  }

  // 넓은 PC: 왼쪽에 설정, 오른쪽에 앱 정보
  return (
    <section className="mt-10 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-5">
      <div>
        <SectionTitle>설정</SectionTitle>
        <ListCard>
          <MenuRow icon="lock" title="비밀번호 바꾸기" sub="목자·총무가 함께 쓰는 비밀번호예요" onClick={() => setOpen('pass')} />
          <MenuRow
            icon="download"
            title="데이터 백업 받기"
            sub={backingUp ? '백업 파일을 만드는 중…' : '목장·명단·출석 기록 전체를 파일 하나로 저장해요'}
            disabled={backingUp}
            onClick={() => void backup()}
          />
          <MenuRow icon="plus" title="홈 화면에 추가하는 방법" sub="앱처럼 아이콘을 눌러 바로 열 수 있어요" onClick={() => setOpen('help')} />
          <MenuRow icon="logout" title="로그아웃" sub="이 기기에서 나가요" onClick={() => setOpen('logout')} />
        </ListCard>
      </div>

      <div>
        <SectionTitle className="mt-8 lg:mt-0">앱 정보</SectionTitle>
        <Card className="divide-y divide-line px-5">
          <InfoRow label="저장 방식">
            {mode === 'cloud' ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-ok" />
                서버 연결됨
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-accent" />
                체험 모드
              </span>
            )}
          </InfoRow>
          <InfoRow label="목장">{activeGroups}개</InfoRow>
          <InfoRow label="목장원">
            {current.length}명{removed.length > 0 && <span className="text-ink-3"> · 뺀 사람 {removed.length}명</span>}
          </InfoRow>
          <InfoRow label="출석 받은 주일">{sundays}번</InfoRow>
          <InfoRow label="만든 곳">남군산교회 AM청년회</InfoRow>
        </Card>
        <p className="mt-2 px-1 text-[13px] leading-relaxed text-ink-3">
          {mode === 'cloud'
            ? '모든 목자·총무가 같은 출석부를 함께 봐요. 한 사람이 바꾸면 다른 휴대폰에도 바로 반영돼요.'
            : '체험 모드예요. 이 기기(브라우저)에만 저장되고 다른 사람과 공유되지 않아요.'}
        </p>

        {mode === 'local' && (
          <ListCard className="mt-4">
            <MenuRow
              icon="undo"
              danger
              title="체험 데이터 초기화"
              sub="이 기기에 저장된 체험용 명단·출석을 처음 상태로 되돌려요"
              onClick={() => setOpen('reset')}
            />
          </ListCard>
        )}
      </div>

      {open === 'pass' && <PasscodeSheet onClose={() => setOpen(null)} />}
      {open === 'help' && <HomeScreenHelpSheet onClose={() => setOpen(null)} />}
      <Confirm
        open={open === 'logout'}
        title="로그아웃할까요?"
        confirmLabel="로그아웃"
        message="다시 들어올 때 비밀번호를 넣어야 해요. 저장된 출석부는 그대로 있어요."
        onConfirm={logout}
        onClose={() => setOpen(null)}
      />
      <Confirm
        open={open === 'reset'}
        title="체험 데이터를 초기화할까요?"
        confirmLabel="초기화"
        danger
        message={
          <>
            이 기기에서 넣어 본 출석 체크·명단 변경이 모두 지워지고, 처음 명단(엑셀 출석부)으로 돌아가요. 비밀번호도 0000으로 돌아가요.
            <br />
            <span className="text-[13px] text-ink-3">서버에 저장된 실제 데이터와는 상관없어요.</span>
          </>
        }
        onConfirm={resetDemoData}
        onClose={() => setOpen(null)}
      />
    </section>
  )
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-4 py-3 text-[15px]">
      <span className="shrink-0 text-ink-3">{label}</span>
      <span className="min-w-0 text-right font-semibold">{children}</span>
    </div>
  )
}
