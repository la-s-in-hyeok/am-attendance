import { useMemo } from 'react'
import { useStore } from './store'
import { buildWeek, indexRecords, weekTotals, type GroupWeek, type WeekTotals } from './lib/compute'
import type { AttendanceRecord, ISODate, WeekNote } from './lib/types'

/** 모든 출석 기록 (배열) */
export function useRecordList(): AttendanceRecord[] {
  const records = useStore((s) => s.records)
  return useMemo(() => Object.values(records), [records])
}

/** 한 주일의 목장별 출석부 + 합계 */
export function useWeek(date?: ISODate): { date: ISODate; week: GroupWeek[]; totals: WeekTotals; note: WeekNote | undefined } {
  const current = useStore((s) => s.date)
  const d = date ?? current
  const groups = useStore((s) => s.groups)
  const members = useStore((s) => s.members)
  const records = useStore((s) => s.records)
  const note = useStore((s) => s.notes[d])
  return useMemo(() => {
    const index = indexRecords(Object.values(records))
    const week = buildWeek(groups, members, index, d)
    return { date: d, week, totals: weekTotals(week, note), note }
  }, [groups, members, records, note, d])
}

/** 활성(보관 안 된) 목장, 순서대로 */
export function useActiveGroups() {
  const groups = useStore((s) => s.groups)
  return useMemo(() => [...groups].filter((g) => !g.archived).sort((a, b) => a.order - b.order), [groups])
}
