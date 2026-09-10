/* ==========================================================================
   年龄段的唯一权威定义
   --------------------------------------------------------------------------
   全站所有涉及年龄的图表、表格、计算，都必须从这里取分组。
   这样就不会出现"首页按 6 段分组、用户页按 4 段分组"这种口径打架的问题。

   要改分组规则，只改这一个文件。
   ========================================================================== */

import type { AgeGroupId } from '../types'

export interface AgeGroupDef {
  id: AgeGroupId
  /** 图表上显示的文字 */
  label: string
  /** 表格里显示的文字（更短） */
  shortLabel: string
  /** 年龄下限（含） */
  min: number
  /** 年龄上限（含）。最后一档给一个大数表示"以上" */
  max: number
}

export const AGE_GROUPS: AgeGroupDef[] = [
  { id: '18-24', label: '18–24岁', shortLabel: '18–24', min: 18, max: 24 },
  { id: '25-31', label: '25–31岁', shortLabel: '25–31', min: 25, max: 31 },
  { id: '32-40', label: '32–40岁', shortLabel: '32–40', min: 32, max: 40 },
  { id: '40+', label: '40岁以上', shortLabel: '40+', min: 41, max: 999 },
]

/** 只保留 id 的数组，方便遍历 */
export const AGE_GROUP_IDS: AgeGroupId[] = AGE_GROUPS.map((g) => g.id)

/** 根据具体年龄判断属于哪一组 */
export function ageGroupOf(age: number): AgeGroupId {
  const hit = AGE_GROUPS.find((g) => age >= g.min && age <= g.max)
  return hit ? hit.id : '40+'
}

/** 取分组的显示文字 */
export function ageGroupLabel(id: AgeGroupId, short = false): string {
  const def = AGE_GROUPS.find((g) => g.id === id)
  if (!def) return id
  return short ? def.shortLabel : def.label
}
