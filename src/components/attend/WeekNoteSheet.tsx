import type { ISODate } from '../../lib/types'
import { currentSunday, labelMD } from '../../lib/dates'
import { Sheet } from '../ui'
import { WeekNoteEditor, type NoteSection } from './WeekNoteEditor'

/**
 * 새신자·방문·바나바(메모 포함)를 적는 창.
 * section: 누른 칸 ('방문'·'바나바'면 그 칸으로 내려서 연다).
 * 닫으면 입력 화면이 사라지면서 남은 내용을 저장한다 (WeekNoteEditor)
 */
export function WeekNoteSheet({
  date,
  open,
  section,
  onClose,
}: {
  date: ISODate
  open: boolean
  section?: NoteSection
  onClose: () => void
}) {
  const title = date === currentSunday() ? '새신자 · 방문 · 바나바' : `${labelMD(date)} 새신자 · 방문 · 바나바`
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <WeekNoteEditor key={date} date={date} focusSection={section} />
    </Sheet>
  )
}
