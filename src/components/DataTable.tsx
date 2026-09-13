/* 通用表格 —— 图表的「表格视图」和明细表都用它。
   不追求功能多，只要求：表头清楚、数字右对齐、行高一致、点表头能排序。

   两个设计上要注意的地方：

   1. 排序按【原始数值】排，不按显示出来的文字排。
      如果按文字排，"10000" 会排在 "9000" 前面（字符串比较）。
      所以 rows 里传的必须是原始数字，显示时再用 format 转成文字。

   2. bar 那一列会在数字左边画一根小条形。
      这样一张表就能同时表达"排名"和"精确数字"，
      不用再单独做一个双轴图（双轴图的两个刻度很容易误导人）。 */

import { useMemo, useState, type ReactNode } from 'react'

export interface Column {
  /** 对应数据里的字段名 */
  key: string
  /** 表头文字 */
  label: string
  /** 对齐方式：数字列一律右对齐，看起来才整齐 */
  align?: 'left' | 'right'
  /** 显示时怎么把原始值变成文字。不传就直接显示原值。 */
  format?: (value: number | string) => string
  /** 这一列能不能点表头排序，默认能 */
  sortable?: boolean
  /** 是否在数字左边画一根小条形 */
  bar?: boolean
}

interface DataTableProps {
  columns: Column[]
  /** 原始数据。数字要保持是数字，不要提前格式化成字符串。 */
  rows: Record<string, string | number>[]
  /** 初始按哪一列排序 */
  initialSortKey?: string
  initialSortDesc?: boolean
  maxHeight?: number
  /** 表格下方的补充说明 */
  footnote?: ReactNode
}

type SortState = { key: string; desc: boolean } | null

export default function DataTable({
  columns,
  rows,
  initialSortKey,
  initialSortDesc = true,
  maxHeight = 360,
  footnote,
}: DataTableProps) {
  const [sort, setSort] = useState<SortState>(
    initialSortKey ? { key: initialSortKey, desc: initialSortDesc } : null,
  )

  // 每一列的最大值，用来算条形长度
  const barMax = useMemo(() => {
    const out: Record<string, number> = {}
    for (const col of columns) {
      if (!col.bar) continue
      let max = 0
      for (const row of rows) {
        const v = row[col.key]
        if (typeof v === 'number' && v > max) max = v
      }
      out[col.key] = max
    }
    return out
  }, [columns, rows])

  const sorted = useMemo(() => {
    if (!sort) return rows
    // 保留原始下标，遇到相等时按原顺序排，避免每次点击顺序乱跳
    return rows
      .map((row, i) => ({ row, i }))
      .sort((a, b) => {
        const av = a.row[sort.key]
        const bv = b.row[sort.key]
        let diff = 0
        if (typeof av === 'number' && typeof bv === 'number') diff = av - bv
        else diff = String(av).localeCompare(String(bv), 'zh-CN')
        if (diff === 0) return a.i - b.i
        return sort.desc ? -diff : diff
      })
      .map((x) => x.row)
  }, [rows, sort])

  function toggleSort(key: string) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, desc: true }
      if (prev.desc) return { key, desc: false }
      return null // 第三次点击恢复原始顺序
    })
  }

  return (
    <div>
      <div
        className="overflow-auto rounded-lg border border-hairline"
        style={{ maxHeight }}
      >
        <table className="w-full border-collapse text-[12.5px]">
          <thead className="sticky top-0 z-10 bg-plane">
            <tr>
              {columns.map((col) => {
                const canSort = col.sortable !== false
                const active = sort?.key === col.key
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={
                      active ? (sort!.desc ? 'descending' : 'ascending') : undefined
                    }
                    className={`whitespace-nowrap border-b border-hairline px-3 py-2 text-[11.5px] font-semibold text-ink-2 ${
                      col.align === 'right' ? 'text-right' : 'text-left'
                    } ${canSort ? 'cursor-pointer select-none hover:text-ink' : ''}`}
                    onClick={canSort ? () => toggleSort(col.key) : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {canSort && (
                        /* 排序箭头：用形状而不是只用颜色表达状态 */
                        <svg
                          viewBox="0 0 10 12"
                          className="h-2.5 w-2"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                          style={{ opacity: active ? 1 : 0.28 }}
                        >
                          {active && sort!.desc ? (
                            <path d="M5 2.5v7M5 9.5 2.2 6.7M5 9.5l2.8-2.8" />
                          ) : (
                            <path d="M5 9.5v-7M5 2.5 2.2 5.3M5 2.5l2.8 2.8" />
                          )}
                        </svg>
                      )}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>

          <tbody>
            {sorted.map((row, i) => (
              <tr key={i} className="odd:bg-card even:bg-plane/50 hover:bg-brand-soft/60">
                {columns.map((col) => {
                  const raw = row[col.key]
                  const text = col.format ? col.format(raw) : String(raw)
                  const num = typeof raw === 'number' ? raw : null
                  const max = barMax[col.key] ?? 0
                  const pct = num !== null && max > 0 ? (num / max) * 100 : 0

                  return (
                    <td
                      key={col.key}
                      className={`whitespace-nowrap border-b border-hairline/70 px-3 py-1.5 text-ink ${
                        col.align === 'right' ? 'text-right tabular-nums' : 'text-left'
                      }`}
                    >
                      {col.bar && num !== null ? (
                        /* 条形 + 数字并排：条形给"谁大谁小"的直觉，数字给准确值 */
                        <span className="inline-flex items-center justify-end gap-2">
                          <span
                            className="inline-block h-[6px] shrink-0 rounded-full"
                            style={{
                              width: `${Math.max(2, (pct / 100) * 52)}px`,
                              background: '#bcd4f2',
                            }}
                            aria-hidden="true"
                          />
                          <span className="w-[56px] text-right">{text}</span>
                        </span>
                      ) : (
                        text
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {footnote && (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">{footnote}</p>
      )}
    </div>
  )
}
