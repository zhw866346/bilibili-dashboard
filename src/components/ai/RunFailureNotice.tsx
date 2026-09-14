/* ==========================================================================
   本次分析没跑成时的横幅 + 重试入口
   --------------------------------------------------------------------------
   ★ 为什么要有这个组件：
     在这之前，数据库起不来的时候，页面上只有一句夹在 warnings 列表里的
     「数据库引擎启动失败」。读者得自己往下翻才看得见，而且没有任何补救的办法 ——
     只能自己发现「再点一次开始分析」也能重来。这次把补救入口显式摆出来。

   ★ 为什么挂在 AgentWorkflow 里、而不是页面里：
     AgentWorkflow 是一个「给一份轨迹就渲染」的纯组件，命令行脚本能拿一份
     合成的失败轨迹把它渲染出来、逐句断言。页面（AiAnalyst）的轨迹是内部状态，
     脚本够不着。放在这里，这个横幅的每一句话都是可机器验证的。

   ★ 「数据库没起来」和「起来了但每条 SQL 都失败」是两回事，不能共用一句文案。
     前者是环境问题（浏览器不支持 WebAssembly / 内存不足），重试有意义；
     后者是查询本身的问题，重试大概率还是同样的结果。混成一句就是在含糊。
   ========================================================================== */

import type { AgentTrace } from '../../data/ai/types'

/** 按钮上的字。导出成常量，让脚本能数它出现了几次，不用手抄。 */
export const RETRY_LABEL = '重试一次'

/** 横幅标题。★ 不写「失败了」「出错了」——写清楚【哪件事】没做成。 */
export const RUN_FAILURE_TITLE = '本次没有真的执行 SQL'

export default function RunFailureNotice({
  trace,
  onRetry,
}: {
  trace: AgentTrace
  onRetry: () => void
}) {
  /* engineMode === 'none' 是「数据库根本没起来」的权威判据（runner 只在降级分支里留 none）。
     其余情况就是库起来了、但每条 SQL 都执行失败。 */
  const engineDown = trace.engineMode === 'none'

  return (
    <div className="rounded-xl border border-down/30 bg-down/5 px-4 py-3.5">
      <p className="text-[12.5px] font-semibold text-[#b02a2a]">{RUN_FAILURE_TITLE}</p>

      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-2">
        {engineDown ? (
          <>
            数据库这一次没能在你的浏览器里启动起来，所以第 4 步没有真的执行 SQL，
            第 5 步里凡是要读 SQL 结果的图都画不出来（每张图下面写明了缺的是哪一条查询）。
          </>
        ) : (
          <>
            数据库起来了，但这次准备的 SQL 一条都没有执行成功，
            所以第 5 步里凡是要读 SQL 结果的图都没有数据可画（每张图下面写了原因）。
          </>
        )}{' '}
        结论、数据依据和业务洞察来自前端口径与离线跑好的 Pandas 结果，不受影响。
      </p>

      <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-3">
        详细原因写在第 4 步的说明里。点下面这个按钮会把
        「{trace.plan.question}」（近 {trace.plan.days} 天）从头再跑一遍 ——
        重跑的是这一句问题，不是输入框里现在写的内容。
      </p>

      <button
        type="button"
        onClick={onRetry}
        className="mt-2.5 rounded-lg bg-ink px-4 py-2 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90"
      >
        {RETRY_LABEL}
      </button>
    </div>
  )
}
