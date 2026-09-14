/* ==========================================================================
   第 1 步（大模型路径）：这次是怎么「理解问题」的
   --------------------------------------------------------------------------
   ★ 规则路径的第 1 步摆的是「命中了哪几个关键词、各值多少分」——
     因为那条路确实是靠关键词判断的，命中依据就是它的全部诚意。
     大模型路径【一个关键词规则都没有参与】，所以那一块摆在这里是整块假话：
     `match.hits` 在这条路上恒为空集，页面会无条件显示
     「一条规则都没命中——所以你看到的是兜底的通用概览」，
     而这一次根本没有兜底这回事。

   ★ 换成摆这三样（全部是真实发生过的东西，不是解释性文案）：
     1. 我们【实际发给模型】的口径说明 —— 它能看到什么、看不到什么，一字不改；
     2. 模型的第一次响应原文 —— 它自己写的 SQL 就在这里面；
     3. 供应商返回的推理原文（思考模式下才有，可能非常长）。
     后两样默认收起来：它们是给「不信」的人看的，不是给人读的。

   ★ 只有第 1 样是常显的。理由：这一页最容易被质疑的一句是
     「你怎么保证模型没在瞎编」，答案的前半段就在这里 ——
     它只被告知了这 4 张表和这几个口径，别的什么都没有。
   ========================================================================== */

import type { LlmRunDetail } from '../../data/ai/llm/types'
import Disclosure from '../Disclosure'

/** 三块的标题。导出给脚本逐字断言，不在 JSX 里手写第二份。 */
export const LLM_NOTE_LABELS = {
  dialect: '这次交给模型的口径说明（原文，一字未改）',
  firstResponse: '模型的第一次响应原文（它自己写的 SQL 就在里面）',
  reasoning: '模型的思考过程原文（供应商返回的，可能很长）',
} as const

/** 口径说明常显时下面那行小字。 */
export const DIALECT_LEAD =
  '下面这段是本地按真实的建表语句和口径【现场生成】再原样发给模型的 —— ' +
  '它没有别的途径知道这份数据长什么样。所以它写出来的查询能对得上列名，靠的是这一段，不是猜。'

export function LlmNote({ detail }: { detail: LlmRunDetail }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <p className="mb-1.5 text-[11px] font-semibold text-ink-3">
          {LLM_NOTE_LABELS.dialect}
        </p>
        <p className="mb-2 text-[11.5px] leading-relaxed text-ink-2">{DIALECT_LEAD}</p>
        <pre className="max-h-72 overflow-auto rounded-lg border border-hairline bg-plane/40 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-ink-2">
          {detail.dialectCard}
        </pre>
      </div>

      {/* ★ 默认收起。这两段是「可以自己去查证」的证据，不是结论 ——
          展开摆一屏会把真正要读的「识别结果」挤到看不见的地方。 */}
      <Disclosure label={LLM_NOTE_LABELS.firstResponse} defaultOpen={false}>
        <pre className="max-h-80 overflow-auto rounded-lg border border-hairline bg-plane/40 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-ink-2">
          {detail.firstResponse}
        </pre>
      </Disclosure>

      {/* ★ reasoning 为 null 时【整块不渲染】，不留一个空框。
          留空框的话，读者会以为「模型的思考过程是空的」——
          而事实是这个供应商/这个模型压根没有把推理过程返回来。 */}
      {detail.reasoning && (
        <Disclosure label={LLM_NOTE_LABELS.reasoning} defaultOpen={false}>
          <pre className="max-h-80 overflow-auto rounded-lg border border-hairline bg-plane/40 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-ink-2">
            {detail.reasoning}
          </pre>
        </Disclosure>
      )}
    </div>
  )
}

export default LlmNote
