/* ==========================================================================
   一张 Python 案例卡
   --------------------------------------------------------------------------
   固定按这个顺序讲一件事（和 SQL 分析页的案例卡是同一套讲法）：

     ① 业务问题          —— 先说要解决什么，再谈怎么写代码
     ② 动到的数据 / Pandas 能力 —— 这段代码用了哪些表和哪些招式
     ③ Python 代码       —— 可展开、可复制、有语法高亮
     ④ 分析结果          —— 由页面传进来（图表 / 表格）
     ⑤ 分析解释          —— 从结果里读出的结论（文字由结果生成，不是写死的）
     ⑥ 业务意义          —— 这个结论对业务意味着什么

   顺序不能换。先甩一段代码再解释，读者不知道自己为什么要看它。

   ★ 代码是从哪儿来的
     不是在这里手写的，是从 PY_RESULTS.snippets 里取的 ——
     那个字段由 analyze.py 从自己的源码里切出来。
     所以页面上展示的代码 = 真跑过的代码，中间没有"我另抄一遍"这个环节。
     卡片右上角会写明这一点。
   ========================================================================== */

import type { ReactNode } from 'react'

import CodeBlock from '../CodeBlock'
import { PY_RESULTS } from '../../data/python/results.generated'
import type { PythonCase } from '../../data/python/cases'

interface PythonCaseCardProps {
  pythonCase: PythonCase
  /** ④ 分析结果。每个案例展示的东西不一样，所以由页面自己传进来 */
  children?: ReactNode
}

export default function PythonCaseCard({ pythonCase, children }: PythonCaseCardProps) {
  const snippet = PY_RESULTS.snippets[pythonCase.id]

  return (
    <section
      id={`py-case-${pythonCase.id}`}
      /* scroll-mt：页面顶部有吸顶的标题栏，跳转过来时要留出它的高度，
         否则卡片标题会被压在下面看不见。 */
      className="scroll-mt-24 rounded-xl border border-hairline bg-card"
    >
      {/* ---------- 卡片头 ---------- */}
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-hairline px-5 py-3">
        <span className="flex h-5 min-w-5 items-center justify-center rounded-md bg-ink px-1.5 text-[11px] font-semibold tabular-nums text-white">
          {String(pythonCase.no).padStart(2, '0')}
        </span>
        <h3 className="text-[13.5px] font-semibold text-ink">{pythonCase.title}</h3>
        <span className="rounded bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-ink">
          {pythonCase.scene}
        </span>

        {/* 代码来源说明。放在最显眼的位置，因为它就是"真跑过"的证据。 */}
        {snippet && (
          <span className="ml-auto rounded-md bg-plane px-2 py-0.5 text-[11px] tabular-nums text-ink-3">
            下面这段代码是本地真跑过的那一段（{snippet.split('\n').length} 行）
          </span>
        )}
      </header>

      <div className="flex flex-col gap-3.5 px-5 py-4">
        {/* ---------- ① 业务问题 ---------- */}
        <div>
          <Label>业务问题</Label>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink">
            {withEmphasis(pythonCase.question)}
          </p>
        </div>

        {/* ---------- ② 动到的数据 / Pandas 能力 ---------- */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div>
            <Label>动到的数据</Label>
            <div className="mt-1 flex flex-wrap gap-1">
              {pythonCase.tables.map((t) => (
                <code
                  key={t}
                  className="rounded border border-hairline bg-plane/60 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2"
                >
                  {t}
                </code>
              ))}
            </div>
          </div>
          <div>
            <Label>Pandas 能力</Label>
            <div className="mt-1 flex flex-wrap gap-1">
              {pythonCase.abilities.map((a) => (
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

        {/* ---------- ③ Python 代码 ---------- */}
        {snippet ? (
          <CodeBlock code={snippet} language="python" />
        ) : (
          <div className="rounded-lg border border-dashed border-down/30 bg-down/5 px-3 py-2.5 text-[11.5px] text-[#d03b3b]">
            结果文件里没有这个案例的代码片段（snippets.{pythonCase.id} 缺失）。
            重新跑一次 npm run data:refresh。
          </div>
        )}

        {/* ---------- ④ 分析结果 ---------- */}
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <Label>分析结果</Label>
            <span className="text-[10.5px] text-ink-3">
              下面这些数字和图表，全部来自上面那段代码的真实输出
            </span>
          </div>
          <div className="mt-1.5 flex flex-col gap-3">{children}</div>
        </div>

        {/* ---------- ⑤ 分析解释 ---------- */}
        {snippet && (
          <div className="rounded-lg border border-hairline bg-plane/40 px-3.5 py-2.5">
            <p className="text-[11px] font-semibold text-ink-3">分析解释</p>
            <p className="mt-1 whitespace-pre-line text-[12.5px] leading-relaxed text-ink-2">
              {withEmphasis(pythonCase.explain(PY_RESULTS))}
            </p>
          </div>
        )}

        {/* ---------- ⑥ 业务意义 ---------- */}
        <div className="flex gap-2.5">
          <span className="mt-[3px] h-fit shrink-0 rounded bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-ink">
            业务意义
          </span>
          <p className="text-[12.5px] leading-relaxed text-ink-2">
            {withEmphasis(pythonCase.meaning)}
          </p>
        </div>
      </div>
    </section>
  )
}

/** 小标题。四个区块共用，保证字号和颜色一致。 */
function Label({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold text-ink-3">{children}</p>
}

/* ==========================================================================
   把文案里的 **加粗** 渲染成真正的加粗
   --------------------------------------------------------------------------
   ★ 为什么必须有这个东西，而不是把 ** 从文案里删掉

     cases.ts 里的解释文字是用 `**……**` 标重点的（写起来像 Markdown）。
     但 React 渲染的是纯文本 —— 不加处理的话，页面上会原样显示出
     `**没有缺失值，但有"重复"**`，两个星号明晃晃地摆在那儿。

     这个坑我在别的项目里也踩过，所以这次是**用一个渲染检查抓出来的**，
     不是靠翻代码看出来的：把所有模块渲染一遍，数 HTML 里出现了几次 "**"。

   ★ 标记不成对时怎么办
     split('**') 之后的段数应当是奇数。如果文案里少写了一个 `**`，
     段数就是偶数 —— 这时**原样返回、不加粗**。宁可少一处加粗，
     也不能把半句话加粗、还让人以为是有意为之。
   ========================================================================== */
function withEmphasis(text: string): ReactNode {
  const parts = text.split('**')
  if (parts.length % 2 === 0) return text
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold text-ink">
        {part}
      </strong>
    ) : (
      part
    ),
  )
}
