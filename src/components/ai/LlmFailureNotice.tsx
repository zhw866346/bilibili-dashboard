/* ==========================================================================
   大模型路径的失败横幅（四种）
   --------------------------------------------------------------------------
   ★ 为什么不和规则路径那个 RunFailureNotice 共用一个组件（两条硬理由）：

     1. 恢复动作的【代价】完全不同。规则路径的「重试一次」是在本机重算一遍 ——
        不联网、不花钱。大模型路径的「重试」是【再发一轮请求、再计一次 token】。
        共用一个按钮，用户会以为重试是免费的。
     2. 规则路径那两句话（「结论来自前端口径与离线 Pandas，不受影响」）
        在大模型路径下【是假的】—— 那里根本没有离线模板兜底。

     RunFailureNotice 因此【一行未改】，这个文件自己写自己的外框。

   ★ 四种失败的判据和排序（下面有断言钉着）：

     crashed      【页面自己抛了异常】。★ 它在 `mode !== 'llm'` 那个判据【前面】——
                  这一种两条路都会发生，而且规则路径上 RunFailureNotice 那两句话
                  恰好是假的（那一刻什么都没跑完）。所以它不挑路。
     ── 下面三种只在大模型路径上成立 ──
     aborted      跑到一半停了（超时 / 断线 / 被限流 / key 不对）。
                  它【最外层】：它解释了为什么后两样也会缺。
     tools-failed 模型写的工具一次都没跑成。这是【因】。
     unstructured 工具跑成了，但模型最后那段没按结构化格式写。这是【果】。
                  「因」必须排在「果」前面说。

   ★ 有一条不变量（已核实，不是猜的）：`unstructured === true` 时
     `aborted` 必然不存在 —— loop.ts 里 answer 的唯一一次赋值在 try 里，
     catch 只设 aborted、不碰 answer，而初始值 `parseLlmAnswer('')` 走的是
     `rawText === ''` 分支、unstructured 为 false。
     所以真正需要排序的只有两对；这条不变量本身也有断言。
   ========================================================================== */

import type { AgentTrace } from '../../data/ai/types'

/* --------------------------------------------------------------------------
   一、对外的话术常量（导出，脚本逐字断言）
   -------------------------------------------------------------------------- */

/** 「重试」按钮上的字。★ 规则路径那个叫 RETRY_LABEL，两个常量刻意不同名。 */
export const LLM_RETRY_LABEL = '重试一次（会再发一轮请求）'

/**
 * 切到规则路径的按钮上的字。
 * ★ 后半句「结果会不一样」【不能删】—— 两条路是两套完全不同的实现
 *   （一个是模型自己查、一个是关键词规则 + 模板填数），
 *   不写清楚，用户会以为只是换台机器重算了一遍同一个东西。
 */
export const SWITCH_TO_RULE_LABEL = '改用规则再跑一遍（结果会不一样）'

/** 重试的代价。★ 单独一句，因为它是这个文件里唯一一句关于「钱」的话。 */
export const LLM_RETRY_COST_NOTE =
  '★ 重试的代价和规则路径不一样：大模型路径每重试一次，就会再向大模型服务发一轮请求、再计一次用量。'

export type LlmFailureKind = 'aborted' | 'tools-failed' | 'unstructured' | 'crashed'

export interface LlmFailureBanner {
  /** 横幅标题 */
  title: string
  /** 发生了什么。要说清判据，不能笼统说「失败了」。 */
  body: string
  /** 按钮下面那行小字：点了之后会发生什么 */
  actionNote: string
  /** 显不显示「再试一次」 */
  retry: boolean
  /** 显不显示「改用规则」 */
  switchToRule: boolean
  /**
   * ★ 只在【大模型路径】上才显示「改用规则」的那个开关。
   *
   * 为什么需要它：`crashed`（页面自己抛异常）这一种失败**两条路都会发生**，
   * 而「改用规则再跑一遍（结果会不一样）」这句话在规则路径上是一句【假话】——
   * 那儿本来就是规则路径，再跑一遍结果一模一样。
   * 所以这一个开关必须看路，不能像另外三个那样写死。
   *
   * ★ 它是个【附加】条件，不是第二个真相来源：`switchToRule` 仍然是主开关。
   */
  switchToRuleOnlyOnLlm?: boolean
}

/**
 * 四份文案。
 *
 * ★ 写成 Record<LlmFailureKind, …>：加第四种失败而不补文案是【编译错误】。
 *   这个项目里已经用过三次的老办法（ChartId / ToolChoice.mode / RunMode）。
 */
export const LLM_FAILURE_BANNER: Record<LlmFailureKind, LlmFailureBanner> = {
  aborted: {
    title: '这次分析跑到一半停了，没有得到结论',
    body:
      '模型在写出结论之前就中断了（超时、断线、被限流，或者本机的后端被关掉了）。' +
      '★ 这一页【不会】替你换成本地模板把话说完 —— 那样你看到的会是一份' +
      '「看起来像模型给的、其实是本地模板给的」结论，比直接说没跑成还糟。' +
      '下面的执行记录是真的：已经跑成的那几次调用，结果照常显示在第 4 步。',
    actionNote:
      '「重试」会把【同一句话、同一个时间窗口】重新发一遍，不是重跑输入框里现在的内容。' +
      LLM_RETRY_COST_NOTE,
    retry: true,
    switchToRule: true,
  },
  'tools-failed': {
    title: '模型写的工具，一次都没有跑成功',
    body:
      '模型确实调用了工具（每一条的原文和失败原因都在第 4 步），但每一条都执行失败了 —— ' +
      '所以这一次【没有任何真实数据】。它写的结论请只当作模型的推测，不要当数据看。',
    actionNote:
      '别急着重试：先看第 4 步里那几条失败原因。如果写的是「后端关了」或「数据库没起来」，' +
      '先把它们恢复再重试 —— 否则会得到一模一样的结果。',
    retry: true,
    switchToRule: true,
  },
  unstructured: {
    title: '模型给了回答，但不是我们要的结构',
    body:
      '工具跑成功了，模型也写了东西 —— 可它最后那一段不是要求的 JSON 结构，' +
      '所以只能把它的原文整段贴在第 6 步。★ 第 4 步里的工具结果是【真的】，' +
      '第 6 步那段文字没有经过结构化，也没有逐个数过其中数字的出处。',
    actionNote: '重试会重新发一轮。' + LLM_RETRY_COST_NOTE,
    retry: true,
    switchToRule: false,
  },

  /* ★ 第四种：页面【自己】抛了异常。
     这一份文案是【两条路共用】的，所以每一句话都必须在大模型路径和规则路径上
     同时为真 —— 不许出现「模型」「后端」「网络」这类只在一条路上成立的词。
     （别的三种都可以提模型，因为它们的判据里就写着 mode === 'llm'。） */
  crashed: {
    title: '分析停在半路了 —— 是这一页自己的代码出的错',
    body:
      '不是大模型的问题，也不是后端或网络的问题：是页面这一侧在整理结果的时候' +
      '抛了一个异常，所以这一次没能走完。★ 这属于这一页自身的缺陷，' +
      '跟你问了什么、有没有联网、有没有开后端都无关 —— 换句话说，' +
      '重试一次多半会一模一样地再错一次。原始报错原文就在下面，' +
      '请把它连同你问的那句话一起反馈，那是修这个问题的唯一线索。',
    actionNote:
      '「重试」会把【同一句话、同一个时间窗口】重新跑一遍，' +
      '不是重跑输入框里现在的内容。',
    retry: true,
    /* 见接口里那段注释：规则路径上「改用规则」是句假话，所以这个开关只看大模型那条路。 */
    switchToRule: true,
    switchToRuleOnlyOnLlm: true,
  },
}

/* --------------------------------------------------------------------------
   二、判据
   -------------------------------------------------------------------------- */

/**
 * 这一次该挂哪个横幅。null = 不挂。
 *
 * ★ 先判 `mode !== 'llm'`：规则路径的失败由 RunFailureNotice 负责，
 *   两边都挂就会在同一屏上说两遍「没跑成」，而且说法不一样。
 *
 * ★ `crashed` 是【唯一的例外】，它在那个判据【前面】：
 *   页面自己抛异常这件事，两条路上都会发生，而且规则路径上
 *   RunFailureNotice 那两句话（「结论来自前端口径与离线 Pandas，不受影响」）
 *   恰好是假的 —— 那一刻什么都没跑完。
 *   所以这一种必须两条路都管，见下面那两行注释。
 */
export function llmFailureKind(trace: AgentTrace): LlmFailureKind | null {
  /* ★ 必须放在 `mode !== 'llm'` 前面。放到后面的话，
     规则路径的崩溃【一条横幅都不会挂】—— 页面又回到那种
     「什么都不说、就是没动静」的状态，正是这个字段要消灭的东西。 */
  if (trace.crashed) return 'crashed'

  if (trace.mode !== 'llm') return null
  if (trace.aborted) return 'aborted'
  if (trace.steps[3].status === 'error') return 'tools-failed'
  if (trace.data?.llmAnswer?.unstructured === true) return 'unstructured'
  return null
}

/**
 * 后端错误码 → 一句「你该做什么」。
 *
 * ★ 用【开放集合 + 兜底】，不写成 Record<> 逼穷举。
 *   码是后端在运行时给的（还有 `HTTP_${status}`、`UNKNOWN` 这种拼出来的），
 *   前端根本枚举不完。写成 Record 的后果不是编译错误，而是
 *   「后端加了一个新码 → 页面上显示 undefined」—— 这正是要避免的。
 *   有兜底的话，最坏也只是少一句建议，不会漏一个 undefined 到屏幕上。
 */
const ABORT_HINTS: Record<string, string> = {
  NO_KEY:
    '本机后端起来了，但没读到 API key。检查 server/.env 在不在、里面那一行有没有填。',
  NETWORK_FAILED:
    '本机后端连不上 —— 它多半已经被关掉了。重新跑 npm run server 把那个窗口开回来。',
  NETWORK_TIMEOUT: '本机后端在限定的时间内没有回应。等十几秒再试一次。',
  UPSTREAM_TIMEOUT: '大模型服务自己超时了 —— 这是服务商那边的问题，不是本机的。等一会儿再试。',
  RATE_LIMIT: '被大模型服务限流了。等十几秒再试，别连着重试。',
  UPSTREAM_ERROR: '大模型服务返回了错误（服务商那边的问题，不是本机的）。',
  BAD_JSON: '回来的内容不是合法 JSON。多半是中间有代理或网关插了一手。',
  ORIGIN_DENIED:
    '这一页的地址，后端不认识 —— 最常见的原因是 5173 端口被上一个没关掉的窗口占着，' +
    '浏览器就开到了别的端口。把多余的窗口关掉，重新跑一次 npm run server 再试。',
}

/** 一个不认识的码也要给一句有用的话，并且【把码原样报出来】，不吞掉线索。 */
export const ABORT_HINT_FALLBACK =
  '这个错误码页面还不认识，建议看后端那个黑窗口里的日志 —— 失败的原因它会打在那里。'

export function abortHint(code: string): string {
  return ABORT_HINTS[code] ?? ABORT_HINT_FALLBACK
}

/* --------------------------------------------------------------------------
   三、组件
   -------------------------------------------------------------------------- */

export function LlmFailureNotice({
  trace,
  onRetry,
  onSwitchToRule,
}: {
  trace: AgentTrace
  onRetry: () => void
  onSwitchToRule: () => void
}) {
  const kind = llmFailureKind(trace)
  if (!kind) return null

  const banner = LLM_FAILURE_BANNER[kind]
  const abort = trace.aborted
  const crashed = trace.crashed

  /* 「改用规则」在规则路径上是一句假话（本来就是规则路径，再跑一遍结果一样），
     所以带 switchToRuleOnlyOnLlm 的那一种只在真走大模型时才显示这个按钮。 */
  const showSwitch =
    banner.switchToRule && !(banner.switchToRuleOnlyOnLlm && trace.mode !== 'llm')

  return (
    <div className="rounded-xl border border-down/30 bg-down/5 px-4 py-3.5">
      <p className="text-[12.5px] font-semibold text-[#b02a2a]">{banner.title}</p>

      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-2">{banner.body}</p>

      {/* 停在哪一次请求、后端原话、以及一句该做什么 —— 三样都来自 trace，
          不编。abort.detail 可能很长（后端把上游的响应体贴进来了），截断后显示。 */}
      {abort && (
        <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-ink-2">
          停在【第 {abort.atRequest} 次请求】。后端原话：
          {abort.message}
          {abort.detail ? `（补充：${abort.detail.slice(0, 300)}）` : ''}
          <br />
          <span className="font-sans">{abortHint(abort.code)}</span>
        </p>
      )}

      {/* ★ 页面自己抛的异常：原文照登，一个字都不加工、不截断。
          它是修这个缺陷的唯一线索 —— 加工过的报错会把栈和字段名弄丢。 */}
      {crashed && (
        <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-ink-2">
          原始报错：{crashed.reason}
        </p>
      )}

      <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-3">
        {banner.actionNote}
        本次问的是「{trace.plan.question}」（近 {trace.plan.days} 天）。
      </p>

      <div className="mt-2.5 flex flex-wrap gap-2">
        {banner.retry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg bg-ink px-4 py-2 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90"
          >
            {LLM_RETRY_LABEL}
          </button>
        )}
        {showSwitch && (
          <button
            type="button"
            onClick={onSwitchToRule}
            className="rounded-lg border border-hairline bg-card px-4 py-2 text-[12.5px] font-medium text-ink transition-colors hover:border-ink-3"
          >
            {SWITCH_TO_RULE_LABEL}
          </button>
        )}
      </div>
    </div>
  )
}

export default LlmFailureNotice
