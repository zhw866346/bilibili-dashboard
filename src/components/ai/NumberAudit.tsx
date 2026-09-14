/* ==========================================================================
   第 7 步（大模型路径）：把「数字核对」摊开
   --------------------------------------------------------------------------
   ★ 第 7 步是整页的页脚：读者读完所有结论之后，最后看到的是
     「这些数字是怎么来的」。大模型路径在这件事上多了一个全新的风险 ——
     「模型编一个看起来很合理的数字」—— 所以这一步必须比规则路径多说一层。

   ★ 和第 6 步那张卡顶上的 summary 是什么关系（这一条很要紧，别当成重复）：
     顶上那句是一行摘要（`数字核对 M / N；<auditSentence>`），而且它在一个
     可折叠的标题栏里。这一步的正文是把【同一份 audit 对象】摊开给人看。
     两处读的是同一个对象，不是各算一遍 —— 这里是排版不同，不是第二个真相来源。
     项目里明令禁止的是「同一样东西各算一遍」，不是「同一样东西分两处渲染」。

   ★ 三块内容各自有明确的落点，缺一块就等于把一种风险藏起来：
     1. 核对结果 —— M / N。找不到出处的数字【逐个原样列出来】，
        不能只说一句「有 3 个数字没找到出处」：不给出来，用户没法自己判断
        那是不是它编的。
     2. 两条拦截器警告 —— 一条查「把跌说成涨」（比的是数值），
        一条查「方向和趋势工具说的相反」（比的是方向字段）。
        两条的证据完全不同，所以必须分开显示，不能合成一句「模型的话和工具对不上」。
     3. 工具调用次数 vs 找不出处的数字 —— 这两个数放一起，
        「一次工具都没调、却写了 12 个数字」这种情形会自己显形。
   ========================================================================== */

import type { LlmRunDetail } from '../../data/ai/llm/types'
import { auditSentence } from '../../data/ai/llm/verify'

/** 那两条拦截器警告的标题。导出给脚本断言，不在 JSX 里手写第二份。 */
export const AUDIT_WARNING_TITLES = {
  growth: '「把跌说成涨」的检查',
  direction: '「涨跌方向和工具说的相反」的检查',
} as const

/** 没找到出处的那些数字上面那行标签。 */
export const AUDIT_MISSING_LABEL = '没找到出处的数字（原样列出来，不替你判断）'

export function NumberAudit({ detail }: { detail: LlmRunDetail }) {
  const audit = detail.audit

  return (
    <div className="flex flex-col gap-2.5">
      <div className="rounded-lg border border-hairline bg-plane/40 px-3.5 py-3">
        <p className="text-[11px] font-semibold text-ink-3">结论里的数字，逐个查了出处</p>

        {/* ★ 原话来自 verify.ts 的 auditSentence —— 和顶上那行摘要、
            以及本机检查逐字断言的是【同一个函数】。这里不重写一句话。 */}
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-2">{auditSentence(audit)}</p>

        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11.5px] text-ink-2 tabular">
          <span>
            工具调用 <strong className="font-semibold text-ink">{detail.toolCalls.length}</strong> 次
            {/* ★ 多轮时把「本次」和「本会话累计」分开写。
                只写一个数字的话，用户会以为整个会话就查了这么几次。 */}
            {detail.sessionToolCalls > detail.toolCalls.length && (
              <span className="text-ink-3">（本会话累计 {detail.sessionToolCalls} 次）</span>
            )}
          </span>
          <span>
            结论里的数字 <strong className="font-semibold text-ink">{audit.total}</strong> 个
          </span>
          <span>
            找到出处 <strong className="font-semibold text-ink">{audit.matched}</strong> 个
          </span>
        </div>
        {/* ★ 这句话必须跟着 audit.scope 走。
            多轮追问时还说「白名单只有本次工具返回的内容」就是一句假话 ——
            而它不会报错，只会让用户以为那个数字是这一轮查出来的。 */}
        <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
          {audit.scope === 'conversation'
            ? '核对的白名单是工具真正返回过的内容（结果表 + 窗口自带的几个日期），' +
              '再加上前面几轮核对通过的那些数字 —— 所以上面「找到出处」里有 ' +
              `${audit.matchedFromPrior} 个来自前几轮，不是这一轮查出来的。`
            : '核对的白名单只有工具真正返回过的内容（结果表 + 窗口自带的几个日期）。' +
              '「一次工具都没调、却写出十几个数字」这种情形，上面那两个数放一起就会显形。'}
        </p>

        {audit.missing.length > 0 && (
          <div className="mt-2">
            <p className="text-[11px] font-semibold text-ink-3">
              {AUDIT_MISSING_LABEL}（共 {audit.missing.length} 个）
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {audit.missing.map((m, i) => (
                <span
                  key={`${m}-${i}`}
                  className="rounded bg-down/10 px-1.5 py-0.5 font-mono text-[11px] text-[#b02a2a]"
                >
                  {m}
                </span>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
              ★ 这一列不代表模型在编 —— 也可能是它对结果做了我们没预料到的算术
              （求和、相减、换算单位）。但【我们无法替它确认】，所以原样列出来，
              由你去第 4 步的结果表里对。
            </p>
          </div>
        )}
      </div>

      {/* 两条拦截器。★ 各自独立渲染，不合成一句 —— 空的那条不渲染，
          两条都空时这一块也整块不出现（不留一个空框）。 */}
      {(detail.growthWarning || detail.directionWarning) && (
        <div className="rounded-lg border border-down/30 bg-down/5 px-3.5 py-3">
          <p className="text-[11px] font-semibold text-[#b02a2a]">
            下面这 {[detail.growthWarning, detail.directionWarning].filter(Boolean).length} 项
            是本地核对查出来的问题
          </p>
          {detail.growthWarning && (
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-2">
              <span className="font-semibold text-ink">{AUDIT_WARNING_TITLES.growth}：</span>
              {detail.growthWarning}
            </p>
          )}
          {detail.directionWarning && (
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-2">
              <span className="font-semibold text-ink">{AUDIT_WARNING_TITLES.direction}：</span>
              {detail.directionWarning}
            </p>
          )}
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
            这两条查的东西不一样：一条比的是变化率的【数值】，一条比的是趋势工具返回的
            【方向】字段。证据不同，所以分开显示 —— 合成一句「模型的话和工具对不上」，
            等于把「哪里对不上」这条线索扔掉。
          </p>
        </div>
      )}
    </div>
  )
}

export default NumberAudit
