/* ==========================================================================
   SQL / Python 代码切换器
   --------------------------------------------------------------------------
   ★ 为什么不做成两个并排的框？
     因为 SQL 一段十几行、Python 一段几十行，并排会让每一边都窄到没法读。
     切换着看，一次只读一段，反而清楚。

   ★ 为什么还要分开标「真执行」和「离线跑过」？
     这两种代码的可信度不是一回事：
       SQL  —— 就是在这个页面里当场跑出来的，旁边有真实耗时；
       Python —— 是 analyze.py 在本机离线跑过的代码，页面读的是那次的结果。
     做成一模一样的两个 Tab，会让人以为 Python 也是当场跑的。那是假话。

   ★ 代码高亮直接用 CodeBlock（Stage 5/6 就在用的那个组件），
     不复制第二份 tokenizer —— 复制出来的那份迟早会跟着原版跑偏。
   ========================================================================== */

import { useState } from 'react'

import CodeBlock from '../CodeBlock'

export interface CodeTab {
  key: string
  /** Tab 上的文字 */
  label: string
  language: 'sql' | 'python'
  code: string
  /** 这段代码是怎么来的：真执行 / 离线跑过。页面上必须写清楚 */
  provenance: 'live' | 'offline'
  /** 这段代码在做什么 */
  note?: string
}

const PROVENANCE_TEXT: Record<'live' | 'offline', string> = {
  live: '浏览器本地真执行',
  offline: '离线真跑过的代码',
}

export default function SqlPythonTabs({ tabs }: { tabs: CodeTab[] }) {
  const [active, setActive] = useState(0)
  if (tabs.length === 0) return null

  const current = tabs[Math.min(active, tabs.length - 1)]

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap rounded-md border border-hairline p-px">
          {tabs.map((t, i) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(i)}
              className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                i === active ? 'bg-ink text-white' : 'text-ink-3 hover:text-ink-2'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <span
          className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
          style={
            current.provenance === 'live'
              ? { background: 'rgba(12,163,12,0.09)', color: '#0a7d0a' }
              : { background: 'rgba(237,161,0,0.12)', color: '#8a5f00' }
          }
        >
          {PROVENANCE_TEXT[current.provenance]}
        </span>
      </div>

      {current.note && (
        <p className="text-[11.5px] leading-relaxed text-ink-2">{current.note}</p>
      )}

      <CodeBlock
        code={current.code}
        language={current.language}
        collapsedLines={current.language === 'python' ? 10 : 6}
      />
    </div>
  )
}
