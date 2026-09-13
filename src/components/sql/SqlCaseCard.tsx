/* ==========================================================================
   一张 SQL 案例卡
   --------------------------------------------------------------------------
   固定按这个顺序讲一件事：

     ① 业务问题        —— 先说要解决什么，再谈怎么写 SQL
     ② 使用字段 / SQL 能力 —— 这条查询动了哪些数据、用了哪些招式
     ③ SQL 代码        —— 可展开、可复制、有语法高亮
     ④ 查询结果         —— 真的是这条 SQL 跑出来的，附真实耗时
     ⑤ 分析解释         —— 从结果里读出的结论（文字由结果生成，不是写死的）
     ⑥ 业务意义         —— 这个结论对业务意味着什么

   顺序不能换。先甩一段 SQL 再解释，读者不知道自己为什么要看它。
   ========================================================================== */

import type { ReactNode } from 'react'

import DataTable from '../DataTable'
import SqlCode from './SqlCode'
import type { QueryResult } from '../../data/sql/engine'
import type { SqlCase, SqlCaseRow } from '../../data/sql/cases'

/** 一条案例的查询状态 */
export type CaseStatus = 'pending' | 'running' | 'done' | 'error'

interface SqlCaseCardProps {
  sqlCase: SqlCase
  status: CaseStatus
  /** 查询成功时的结果 */
  result?: QueryResult
  /** 查询失败时的错误信息 */
  error?: string
}

/** 把「列名数组 + 二维值数组」转成表格组件要的「一行一个对象」 */
function toRows(result: QueryResult): Record<string, string | number>[] {
  return result.rows.map((values) => {
    const row: Record<string, string | number> = {}
    result.columns.forEach((name, i) => {
      const v = values[i]
      // 防御性处理：这几条查询不会真的返回 NULL，
      // 万一有，显示成破折号而不是把 "null" 打在表格里
      row[name] = v === null || v === undefined ? '—' : v
    })
    return row
  })
}

export default function SqlCaseCard({ sqlCase, status, result, error }: SqlCaseCardProps) {
  const rows = result ? toRows(result) : []
  const hasRows = status === 'done' && rows.length > 0

  return (
    <section
      id={`sql-case-${sqlCase.id}`}
      /* scroll-mt：页面顶部有吸顶的标题栏，跳转过来时要留出它的高度，
         否则卡片标题会被压在下面看不见。 */
      className="scroll-mt-24 rounded-xl border border-hairline bg-card"
    >
      {/* ---------- 卡片头 ---------- */}
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-hairline px-5 py-3">
        <span className="flex h-5 min-w-5 items-center justify-center rounded-md bg-ink px-1.5 text-[11px] font-semibold tabular-nums text-white">
          {String(sqlCase.no).padStart(2, '0')}
        </span>
        <h3 className="text-[13.5px] font-semibold text-ink">{sqlCase.title}</h3>
        <span className="rounded bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-ink">
          {sqlCase.scene}
        </span>

        {/* 真实耗时。这是"真的跑了"最直接的证据，所以放在最显眼的位置。 */}
        {status === 'done' && result && (
          <span className="ml-auto rounded-md bg-plane px-2 py-0.5 text-[11px] tabular-nums text-ink-3">
            查询耗时 {result.ms < 1 ? '<1' : Math.round(result.ms)} ms · {rows.length} 行
          </span>
        )}
        {status === 'running' && (
          <span className="ml-auto text-[11px] text-ink-3">查询中…</span>
        )}
      </header>

      <div className="flex flex-col gap-3.5 px-5 py-4">
        {/* ---------- ① 业务问题 ---------- */}
        <div>
          <Label>业务问题</Label>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink">{sqlCase.question}</p>
        </div>

        {/* ---------- ② 使用字段 / SQL 能力 ---------- */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div>
            <Label>使用字段</Label>
            <div className="mt-1 flex flex-wrap gap-1">
              {sqlCase.fields.map((f) => (
                <code
                  key={f}
                  className="rounded border border-hairline bg-plane/60 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2"
                >
                  {f}
                </code>
              ))}
            </div>
          </div>
          <div>
            <Label>SQL 能力</Label>
            <div className="mt-1 flex flex-wrap gap-1">
              {sqlCase.abilities.map((a) => (
                <span
                  key={a}
                  className="rounded bg-plane px-1.5 py-0.5 text-[10.5px] font-medium text-ink-2"
                >
                  {a}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ---------- ③ SQL 代码 ---------- */}
        <SqlCode sql={sqlCase.sql} />

        {/* ---------- ④ 查询结果 ---------- */}
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <Label>查询结果</Label>
            {result && status === 'done' && (
              <span className="text-[10.5px] text-ink-3">
                下面这张表就是上面那段 SQL 在浏览器里的 SQLite 上跑出来的
              </span>
            )}
          </div>

          <div className="mt-1.5">
            {status === 'running' || status === 'pending' ? (
              <div className="flex h-[72px] items-center justify-center rounded-lg border border-dashed border-hairline text-[11.5px] text-ink-3">
                正在查询…
              </div>
            ) : status === 'error' ? (
              <div className="rounded-lg border border-down/30 bg-down/5 px-3 py-2.5">
                <p className="text-[11.5px] font-medium text-[#d03b3b]">这条查询出错了</p>
                <p className="mt-1 font-mono text-[11px] leading-relaxed text-ink-2">{error}</p>
              </div>
            ) : !hasRows ? (
              <div className="rounded-lg border border-dashed border-hairline px-3 py-4 text-center text-[11.5px] text-ink-3">
                当前时间窗口内这条查询没有返回结果。
              </div>
            ) : (
              <DataTable columns={sqlCase.columns} rows={rows} maxHeight={320} />
            )}
          </div>

          {hasRows && sqlCase.resultNote && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">{sqlCase.resultNote}</p>
          )}
        </div>

        {/* ---------- ⑤ 分析解释 ---------- */}
        {hasRows && (
          <div className="rounded-lg border border-hairline bg-plane/40 px-3.5 py-2.5">
            <p className="text-[11px] font-semibold text-ink-3">分析解释</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
              {sqlCase.explain(rows)}
            </p>
          </div>
        )}

        {/* ---------- ⑥ 业务意义 ---------- */}
        <div className="flex gap-2.5">
          <span className="mt-[3px] h-fit shrink-0 rounded bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-ink">
            业务意义
          </span>
          <p className="text-[12.5px] leading-relaxed text-ink-2">{sqlCase.meaning}</p>
        </div>
      </div>
    </section>
  )
}

/** 小标题。四个区块共用，保证字号和颜色一致。 */
function Label({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold text-ink-3">{children}</p>
}
