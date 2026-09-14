/* ==========================================================================
   第 3 步（大模型路径）：这一次工具是怎么被选出来的
   --------------------------------------------------------------------------
   ★ 规则路径的第 3 步下面挂着两张卡片，写的是「为什么用 SQL / 为什么用 Python」——
     那是一份【事前】的判断。大模型路径没有这个：在模型开口之前，
     没有任何人知道它要用什么工具，所以那两张卡片的 why 是事后补写的。
     这件事本身必须说出来，否则同一块 UI 会让人以为工具也是提前选好的。

   ★ 这个组件【只加信息，不复述】。它摆的是别处都没有的那几个数：
       模型一共往返了几次、每一次各花了多久、累计用了多少 token。
     每次调用返回了几行、成没成，第 2 步的计划和第 4 步的结果卡里都已经有了 ——
     在这里再抄一遍就是第三个真相来源，改一处漏一处不会报错。

   ★ token 用量是【如实报出来】的，不做成本换算：
     单价随时会变，写死一个「约等于多少钱」迟早变成假话。
   ========================================================================== */

import type { LlmRunDetail } from '../../data/ai/llm/types'
import { formatMs, withThousands } from '../../utils/format'

/** 那块表上面那行小字。导出给脚本断言。 */
export const TOOL_TRAIL_LEAD =
  '★ 这一步的工具【不是事前选好的】—— 是大模型在过程中自己决定要调哪个、调几次。' +
  '所以这里的「为什么用它」是事后补写的，下面这几次往返才是真正发生过的事实。'

/** 一次工具都没调时的如实说明。 */
export const TOOL_TRAIL_NO_CALLS =
  '模型一次工具都没有调用，直接写了结论 —— 所以这次没有任何往返记录。'

export function LlmToolTrail({ detail }: { detail: LlmRunDetail }) {
  const calls = detail.toolCalls
  const totalMs = detail.requestMs.reduce((s, m) => s + m, 0)

  return (
    <div className="rounded-lg border border-hairline bg-plane/40 px-3.5 py-3">
      <p className="text-[11px] font-semibold text-ink-3">这一次的往返记录</p>
      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-2">{TOOL_TRAIL_LEAD}</p>

      <dl className="mt-2 flex flex-col gap-1.5">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2.5">
          <dt className="w-24 shrink-0 text-[11.5px] text-ink-3">请求次数</dt>
          <dd className="text-[12px] leading-relaxed text-ink-2">
            一共向大模型发了 {detail.requestCount} 次请求，累计耗时 {formatMs(totalMs)} ms
            {detail.requestMs.length > 0
              ? `（每次分别是 ${detail.requestMs.map(formatMs).join(' / ')} ms）`
              : ''}
            。★ 工具调用那几次和最后作答那一次是分开算的，所以请求次数通常比工具调用次数多 1。
          </dd>
        </div>

        <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2.5">
          <dt className="w-24 shrink-0 text-[11.5px] text-ink-3">工具调用</dt>
          <dd className="text-[12px] leading-relaxed text-ink-2">
            {calls.length === 0
              ? TOOL_TRAIL_NO_CALLS
              : `模型要求调用了 ${calls.length} 次工具，其中 ${calls.filter((c) => c.ok).length} 次真的跑成了。` +
                '每一次的原文、耗时、返回行数和失败原因都在第 4 步。'}
          </dd>
        </div>

        <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2.5">
          <dt className="w-24 shrink-0 text-[11.5px] text-ink-3">供应商 / 模型</dt>
          <dd className="text-[12px] leading-relaxed text-ink-2">
            {detail.providerLabel}（{detail.provider}）·{' '}
            <code className="font-mono text-[11.5px]">{detail.model}</code>
          </dd>
        </div>

        <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2.5">
          <dt className="w-24 shrink-0 text-[11.5px] text-ink-3">累计用量</dt>
          <dd className="text-[12px] leading-relaxed text-ink-2">
            输入 {withThousands(detail.usage.promptTokens)} · 输出{' '}
            {withThousands(detail.usage.completionTokens)}
            {/* 思考模式下的推理 token 是【单独计费】的，不并进输出里。
                它是 0 时整句不写 —— 写「推理 0 tokens」会让人以为模型没思考。 */}
            {detail.usage.reasoningTokens > 0
              ? ` · 其中推理 ${withThousands(detail.usage.reasoningTokens)}`
              : ''}{' '}
            tokens（合计 {withThousands(detail.usage.totalTokens)}）。★ 这是服务商报回来的原始用量，
            页面不做成本换算 —— 单价会变，写死一个金额迟早变成假话。
          </dd>
        </div>
      </dl>
    </div>
  )
}

export default LlmToolTrail
