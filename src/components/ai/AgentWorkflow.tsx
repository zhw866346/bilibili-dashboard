/* ==========================================================================
   Agent 工作流 —— 把一次分析摊开成七步
   --------------------------------------------------------------------------
   七步：理解问题 → 制定分析计划 → 选择工具 → 执行分析 → 得到分析结果
        → 输出业务洞察 → 标注分析可信度

   ★ 为什么每一步都要能展开看到依据？
     因为「AI 说活跃度下降了」这句话，本身没有任何可信度。
     可信度来自「它跑了哪条 SQL、查出来哪几行、从哪几个数字推出这句话」。
     所以每一步都把原始的东西摆出来：命中的是哪些关键词、
     要跑的是哪段 SQL、结果表长什么样、耗时多少。

   ★ 前三步是同步产生的（毫秒级），不加任何假等待。
     硬加一个「思考中…」的延迟是表演，不是能力。
     这个页面要证明的是分析链路是真的，不是看起来像在思考。

   ★ 第 4 步的两条状态说明（引擎跑在主线程 / 数据库没起来）
     都是如实写的，不是可以省略的装饰。读者有权知道这一次到底跑成没跑成。
   ========================================================================== */

import type { BuildProgress } from '../../data/sql/engine'
import type { AgentTrace, SqlOutcome, TraceStep } from '../../data/ai/types'
import type { ToolChoice } from '../../data/ai/types'
import { CHART_META } from '../../data/ai/chartMeta'
import { INTENT_BY_ID } from '../../data/ai/intents'
import { IMPLEMENTED_INTENT_IDS } from '../../data/ai/demos'
import { LLM_ABORTED_NO_INSIGHT, MODE_LABEL, TRACE_MODE_LABEL } from '../../data/ai/llm/intent'
import { PY_RESULTS } from '../../data/python/results.generated'
import { formatCount, formatMs } from '../../utils/format'
import ChartCard from '../ChartCard'
import CodeBlock from '../CodeBlock'
import DataTable from '../DataTable'
import Disclosure from '../Disclosure'
import { ChartBoard } from './charts'
import { ChartLoading } from './chartStates'
import AnalysisContextCard from './AnalysisContextCard'
import EvidencePanel from './EvidencePanel'
import InsightList from './InsightList'
import LlmFailureNotice from './LlmFailureNotice'
import LlmNote from './LlmNote'
import LlmToolTrail from './LlmToolTrail'
import NumberAudit from './NumberAudit'
import RunFailureNotice from './RunFailureNotice'
import SqlPythonTabs from './SqlPythonTabs'
import type { CodeTab } from './SqlPythonTabs'
import StepCard from './StepCard'
import { TrustFooter } from './TrustFooter'

/* --------------------------------------------------------------------------
   小工具
   -------------------------------------------------------------------------- */

/** 把 SQL 结果转成表格组件要的「一行一个对象」，NULL 显示成破折号 */
function toTableRows(outcome: SqlOutcome): Record<string, string | number>[] {
  return outcome.rows.map((r) => {
    const row: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(r)) {
      row[k] = v === null || v === undefined ? '—' : v
    }
    return row
  })
}

/** 工具名 → 中文 */
const TOOL_LABEL = { sql: 'SQL', python: 'Python / Pandas', frontend: '汇总' } as const

/**
 * 工具「怎么执行的」徽章。
 *
 * ★ 这一段是被一个真缺陷逼出来的，写在这里免得以后有人图省事改回三目：
 *
 *   原来是 `t.mode === 'live' ? A : B`。而大模型路径的 Python 工具 mode 是
 *   **'server'**（本机真起了一个进程算）—— 于是「本机真起了一个 Python 进程」
 *   被显示成「读取离线运行结果」，恰好把这一页最想证明的那件事说反了。
 *   它不报错、类型也对、脚本全绿。
 *
 * ★ 所以：字从 MODE_LABEL 来（唯一真相来源，第 3 步的摘要 loop.ts 也读它），
 *   颜色写在这里；写成 Record<ToolChoice['mode'], …>，加一个成员不补是编译错误。
 */
const TOOL_MODE_BADGE: Record<ToolChoice['mode'], { bg: string; color: string }> = {
  live: { bg: 'rgba(12,163,12,0.09)', color: '#0a7d0a' },
  offline: { bg: 'rgba(237,161,0,0.12)', color: '#8a5f00' },
  /* 蓝色是刻意和大模型路径的其他标记区分开：它不是「本地真跑」也不是「离线读结果」，
     它是【这台机器上真的起了一个进程】。 */
  server: { bg: 'rgba(37,99,235,0.10)', color: '#1d4ed8' },
}

/**
 * 「已经实现了哪几类问题」——从已实现清单【生成】，不手写。
 *
 * ★ 手写这句话的下场：第 3 步给这一页加了第二类问题之后，
 *   原来那句「已经实现的是『用户活跃度下降』这一类问题」就变成半句假话，
 *   而且不报错、不抛异常，只是静静地少说了一类。
 *   从 IMPLEMENTED_INTENT_IDS 生成之后，以后再加意图它自动跟着变。
 */
const IMPLEMENTED_TYPES = IMPLEMENTED_INTENT_IDS.map(
  (id) => INTENT_BY_ID[id]?.analysisType ?? id,
).join('」「')

/* --------------------------------------------------------------------------
   「查看分析过程」那个折叠区
   -------------------------------------------------------------------------- */

/** 折叠条上那个总开关的字。导出给命令行检查用，不手抄。 */
export const FOLD_LABEL = '查看分析过程'

/**
 * 折叠条右边那行小字。
 *
 * ★ 从第 4 步自己的 summary 派生，【不另写一套文案】。
 *   第 4 步的 summary 由 runner 按真实结果写，已经覆盖了四种情况：
 *     正在准备数据库… / 真跑了 N 条 SQL，共返回 M 行，最慢的一条 X ms /
 *     数据库没有启动起来，本次没有真的执行 SQL / 本次没有需要执行的 SQL
 *   再写一份「第 1–4 步 · 真跑了 N 条 SQL」就等于有了两个真相来源——
 *   今天一致，将来改一处就悄悄分叉，而且不报错。
 */
export function processFoldHint(steps: TraceStep[]): string {
  return `第 1–4 步 · ${steps[3].summary}`
}

/* --------------------------------------------------------------------------
   主组件
   -------------------------------------------------------------------------- */

interface AgentWorkflowProps {
  trace: AgentTrace
  /** 建库进度。只有第 4 步在进行中时才需要显示 */
  progress: BuildProgress | null
  /**
   * 这次分析没跑成时，点「重试一次」要做什么。
   *
   * ★ 为什么这个回调挂在这里、而不是让这个组件自己去调页面：
   *   这样它就是一个「给一份轨迹就渲染」的纯组件，命令行脚本能拿一份
   *   合成的失败轨迹把它渲染出来、逐句断言。页面（AiAnalyst）的轨迹是内部状态，
   *   脚本够不着 —— 挂在页面里的话，这个横幅的文案就没人验得了。
   */
  onRetry: () => void
  /**
   * 这一次分析正在跑。★ 只有第 7 步的页脚用它 ——
   * 「这一次跑的是哪条路」只有在真跑过之后才说得准，而「正在跑」和
   * 「还没开始」在别的地方分不出来（两者的 data 都是 null）。
   */
  busy: boolean
  /**
   * 用户在大模型那条路失败之后，选择「改用规则再跑一遍」。
   *
   * ★ 和大模型横幅里的「重试」是两个完全不同的动作，所以是两个回调：
   *   重试 = 再发一轮请求（花用量）；改用规则 = 换一套实现重算（不花钱，结果也不一样）。
   */
  onSwitchToRule: () => void
}

export default function AgentWorkflow({
  trace,
  progress,
  busy,
  onRetry,
  onSwitchToRule,
}: AgentWorkflowProps) {
  const { plan, data, steps } = trace
  const { match, intent } = plan

  /* ★ 这一趟是不是大模型路径。用 intent.id 而不是 match.hits.length ——
     后者在这条路上【恒为空集】，拿它判断「是不是没命中关键词」永远为真。 */
  const isLlm = intent.id === 'llm'

  const sqlTools = plan.tools.filter((t) => t.tool === 'sql')
  const pyTools = plan.tools.filter((t) => t.tool === 'python')

  /* ★ 标签页清单在这里算一次，下面既拿它渲染、也拿它决定那句说明该怎么说。
     分开算两次的话，「说明里说有 Python 段」和「实际显示几段」迟早对不上，
     而它们对不上时不会报错。
     ★ 判据取【真的生成了几个标签】，不取 plan.pyCaseIds.length ——
       buildTabs 里 `if (!code) return` 会跳过引用不到源码的 id，
       所以 pyCaseIds 非空不等于真有 Python 标签。 */
  const codeTabs = buildTabs(trace)
  const offlinePyTabCount = codeTabs.filter((t) => t.provenance === 'offline').length

  return (
    <div className="flex flex-col gap-3">
      {/* ================= 本次没跑成时的横幅 + 重试入口 =================
          放在最上面、且在折叠区【外面】：读者第一眼就该知道这次有没有真的执行 SQL，
          而不是往下翻到 warnings 列表里才发现，也不是被一个默认收起的开关挡住。 */}
      {/*
        ★ 两个横幅【各管各的路】，绝不并列显示：
          · RunFailureNotice 是规则路径的（它那两句话里有一句
            「结论来自前端口径与离线 Pandas，不受影响」—— 大模型路径下这句是假的，
            那里根本没有离线模板兜底）；
          · LlmFailureNotice 内部自己判据，不是大模型路径就返回 null。
        所以这里的分工是「规则路径加条件、大模型路径组件自己判」，
        两边都不会在同一屏上说两遍「没跑成」。

        ★ `!trace.crashed` 这半句非加不可：页面自己抛异常时（runner.ts 的
          crashedTrace），还在跑的那些步骤会被如实标成 'error' —— 第 4 步算一个。
          那条路下 RunFailureNotice 的两句话都是【假的】：它说「结论来自前端口径与
          离线 Pandas，不受影响」，而那一刻整轮分析刚炸掉，什么都没跑完。
          同一屏上一条说「没跑完」、一条说「不受影响」，比少一条横幅糟得多。
          真正的说法由 LlmFailureNotice 的 crashed 那一份负责（它两条路都管）。
      */}
      {trace.mode !== 'llm' && !trace.crashed && steps[3].status === 'error' && (
        <RunFailureNotice trace={trace} onRetry={onRetry} />
      )}
      <LlmFailureNotice
        trace={trace}
        onRetry={onRetry}
        onSwitchToRule={onSwitchToRule}
      />

      {/* ================= 折叠区：从问题到结果（第 1–4 步）+ 代码 =================
          ★ 右边界停在第 4 步。【第 5 步的图表绝不能放进来】——
            折叠区用 display:none 收起，而 display:none 的容器宽度是 0，
            Recharts 的 ResponsiveContainer 会画出一片空白。
            这条约束有机器断言守着（有一条检查专门核对图表标题不在折叠区里）。 */}
      <Disclosure label={FOLD_LABEL} hint={processFoldHint(steps)}>
      {/* ================= 第 1 步：理解问题 ================= */}
      <StepCard
        no={1}
        title="理解问题"
        status={steps[0].status}
        summary={steps[0].summary}
        badge={
          /* ★ 这句原来是【写死】的「规则匹配 · 非大模型」。写死的话，
             大模型路径的第 1 步会顶着一句「非大模型」显示 ——
             这一页最要命的一句话，恰好在这一页最核心的那条路上说反了。
             现在查 TRACE_MODE_LABEL，加第四态不补是编译错误。 */
          <span className="rounded bg-plane px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-3">
            {TRACE_MODE_LABEL[trace.mode]}
          </span>
        }
      >
        <div className="rounded-lg border border-hairline bg-plane/40 px-3.5 py-3">
          <p className="text-[11px] font-semibold text-ink-3">你问的是</p>
          <p className="mt-1 text-[12.5px] text-ink">{plan.question}</p>
          <p className="mt-2 text-[11px] font-semibold text-ink-3">
            {/* ★ 大模型路径下【没有归一化这一步】—— 问题原样发出去。
                照抄「归一化之后」就是在描述一个没有发生过的处理。 */}
            {isLlm ? '原样发给模型的是' : '机器读到的是（归一化之后）'}
          </p>
          <p className="mt-1 font-mono text-[11.5px] leading-relaxed text-ink-2">
            {match.normalized}
          </p>
        </div>

        {/* ★ 这一块【只对规则路径成立】，所以必须按 isLlm 分叉。
            大模型路径下 match.hits 恒为空集、unmatched 恒为 false，
            于是原来那句「一条规则都没命中——所以你看到的是兜底的通用概览」
            会【无条件】显示出来，而这一次根本没有规则参与、也没有兜底。
            读到这句话的人会以为模型答不上来才退而求其次，那是反的。 */}
        {!isLlm && match.unmatched && (
          <div className="rounded-lg border border-hairline bg-plane/60 px-3.5 py-2.5">
            <p className="text-[12px] leading-relaxed text-ink-2">
              <strong className="font-semibold text-ink">没有匹配到已实现的分析类型。</strong>
              下面给的是一份全站概览，不是针对你那个问题的分析。
              已经实现的是「{IMPLEMENTED_TYPES}」这几类问题，可以点上面的示例试试。
            </p>
          </div>
        )}

        {!match.unmatched && match.alternates.length > 0 && (
          <p className="text-[11.5px] leading-relaxed text-ink-2">
            这句话里还识别到其他类型的问题（
            {match.alternates.map((a) => INTENT_BY_ID[a]?.analysisType ?? a).join('、')}），
            本次先回答主问题。
          </p>
        )}

        <div>
          <p className="mb-1.5 text-[11px] font-semibold text-ink-3">识别结果</p>
          <dl className="flex flex-col gap-1.5">
            {plan.slots.map((s) => (
              <div key={s.label} className="flex flex-col gap-0.5 sm:flex-row sm:gap-2.5">
                <dt className="w-20 shrink-0 text-[11.5px] text-ink-3">{s.label}</dt>
                <dd className="text-[12.5px] leading-relaxed text-ink-2">{s.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* ★ 大模型路径摆的是【别的证据】：我们实际发给它的口径说明、
            它第一次响应的原文、它的思考过程。这三样都是真实发生过的东西，
            而「命中的关键词」在那条路上根本不存在。 */}
        {/* ★ 这一轮到底在分析什么（「他们」被理解成了谁）。
            摆在第 1 步里，因为这句话就是「理解问题」这一步的产物 ——
            放到结论旁边就太晚了：读结论的时候，人已经默认它答的是自己问的那件事。 */}
        {isLlm && trace.llm && <AnalysisContextCard detail={trace.llm} />}

        {isLlm ? (
          <div>
            <p className="mb-1.5 text-[11px] font-semibold text-ink-3">
              模型看到了什么（这是它的全部信息来源，没有别的）
            </p>
            <p className="mb-2 text-[11.5px] leading-relaxed text-ink-3">
              ★ 这一次【没有任何关键词规则参与】—— 不是「规则都没命中所以兜底了」，
              而是这一条路压根不用规则。判断问题是什么、该查什么，都是模型自己做的。
            </p>
            {trace.llm ? (
              <LlmNote detail={trace.llm} />
            ) : (
              <p className="text-[11.5px] leading-relaxed text-ink-3">
                模型的调用记录还没有回来 —— 回来之后，这里会摆出它的口径说明和首次响应原文。
              </p>
            )}
          </div>
        ) : (
          <div>
            <p className="mb-1.5 text-[11px] font-semibold text-ink-3">
              命中的关键词（这是判断依据，你可以自己看匹得准不准）
            </p>
            {match.hits.length === 0 ? (
              <p className="text-[11.5px] text-ink-3">
                一条规则都没命中——所以你看到的是兜底的通用概览。
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {match.hits.map((h) => (
                  <div key={h.ruleId} className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11.5px] text-ink-2">{h.label}</span>
                    {h.keywords.map((k) => (
                      <span
                        key={k}
                        className="rounded bg-brand-soft px-1.5 py-0.5 text-[10.5px] font-medium text-brand-ink"
                      >
                        {k}
                      </span>
                    ))}
                    <span className="text-[10.5px] text-ink-3">权重 {h.weight}</span>
                  </div>
                ))}
                <p className="text-[11px] text-ink-3">
                  总分 {match.score}（够 1.5 分才算「问的就是这件事」）。
                  识别规则写在 src/data/ai/intents.ts 里，逐条可读、可改。
                </p>
              </div>
            )}
          </div>
        )}
      </StepCard>

      {/* ================= 第 2 步：制定分析计划 ================= */}
      {/*
        ★ note={steps[1].note} 非传不可，别删。

          大模型路径的第 2 步是【事后】从真实发生过的工具调用记录反推出来的，
          不是事前写好的计划 —— loop.ts:469 把 POST_HOC_PLAN_NOTE 挂在
          steps[1].note 上，就是为了让这一页把这句话说出来。

          这里原先漏传，于是那句话一个字都没显示过：读者看到一张条理清楚的
          计划表，会理所当然地以为模型是先想好再照着做的。
          而「这份计划是事后生成的」恰恰是这一页最不能让人误会的一件事 ——
          不报错、类型也对、页面看着还挺好，只是把人往反方向引。

          StepCard 只要收到 note 就渲染（StepCard.tsx:76-80），第 4 步
          （:402）也是这么用的。
      */}
      <StepCard
        no={2}
        title="制定分析计划"
        status={steps[1].status}
        summary={steps[1].summary}
        note={steps[1].note}
      >
        <ol className="flex flex-col gap-2">
          {plan.planSteps.map((p) => (
            <li key={p.no} className="flex gap-2.5">
              <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded bg-plane text-[10px] font-semibold text-ink-2">
                {p.no}
              </span>
              <div className="min-w-0">
                <p className="text-[12.5px] font-medium text-ink">
                  {p.title}
                  <span className="ml-1.5 rounded bg-plane px-1.5 py-px text-[10px] font-medium text-ink-3">
                    {TOOL_LABEL[p.tool]}
                  </span>
                </p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-2">{p.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </StepCard>

      {/* ================= 第 3 步：选择工具 ================= */}
      <StepCard
        no={3}
        title="选择工具"
        status={steps[2].status}
        summary={steps[2].summary}
      >
        <div className="grid gap-2.5 lg:grid-cols-2">
          {[...sqlTools, ...pyTools].map((t) => (
            <div key={t.tool} className="rounded-lg border border-hairline bg-plane/40 px-3.5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] font-semibold text-ink">
                  {t.tool === 'sql' ? 'SQL（SQLite）' : 'Python（Pandas）'}
                </span>
                <span
                  className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
                  style={TOOL_MODE_BADGE[t.mode]}
                >
                  {MODE_LABEL[t.mode]}
                </span>
              </div>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-2">{t.why}</p>
            </div>
          ))}

          {/*
            ★ 空态也要说句话。plan.tools 在大模型路径下是按【真实发生过的调用】
              反推出来的：模型一次工具都没调时它是空数组，而这一整块会静静消失 ——
              读者会以为「选择工具」这一步没问题，其实这一步压根没发生。
          */}
          {sqlTools.length + pyTools.length === 0 && (
            <p className="rounded-lg border border-dashed border-hairline px-3.5 py-2.5 text-[11.5px] leading-relaxed text-ink-3">
              {isLlm
                ? '模型这一次没有调用任何工具，所以没有可展示的工具选择 —— 它直接写了结论。'
                : '这一次没有需要选择的工具。'}
            </p>
          )}
        </div>

        {/* 大模型路径额外摆一块：这一次到底往返了几次。别处都没有这几个数。 */}
        {trace.llm && <LlmToolTrail detail={trace.llm} />}
      </StepCard>

      {/* ================= 第 4 步：执行分析 ================= */}
      <StepCard
        no={4}
        title="执行分析"
        status={steps[3].status}
        summary={steps[3].summary}
        note={steps[3].note}
      >
        {progress && steps[3].status === 'running' && (
          <div className="rounded-lg border border-hairline bg-plane/40 px-3.5 py-2.5">
            <p className="text-[11.5px] text-ink-2">
              {progress.label}
              {progress.total > 0 && ` —— ${progress.done} / ${progress.total}`}
            </p>
            {progress.total > 0 && (
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-hairline">
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-200"
                  style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/*
          ★ 判据是 data.outcomes（本次真实跑过的每一次调用），不是 plan.queries。

            原先写的是 `plan.queries.length === 0` —— 而 queries 现在【只装 SQL】，
            所以 Python 那一次调用不进 queries。于是会出现「queries 空、
            outcomes 不空」的组合，这一整块被跳过：页面上写着「这一次没有
            需要执行的 SQL」，而结果表里明明躺着一条 Python 算出来的结果。
            整块消失 = 看不见，这个项目已经栽过一次。

          ⚠️ 订正一句我先前写在这里的话。原来写的是「模型只调了 Python 的话
             queries 是空的」，读起来像「模型可以单独调一次成事的 Python」。
             实测不成立：tools.ts:332-349 要求 python_analysis 的 source 必须
             指向【前面一次成功的 sql_query】，所以「一次 SQL 都没有、只有
             Python」的这种组合，唯一能真实出现的形态是那条 Python 调用
             【失败】（NO_SUCH_SOURCE，模型引用了不存在的 source）。
             断言就是按这个真实形态写的，不是按想象写的。
             留这段是为了防止下一个人照着那句已经不存在的话，去构造一个
             根本造不出来的「Python-only 成功」夹具。
        */}
        {data ? (
          data.outcomes.length === 0 ? (
            <p className="rounded-lg border border-dashed border-hairline px-3.5 py-3 text-[11.5px] leading-relaxed text-ink-3">
              {intent.id === 'generic'
                ? '没有匹配到专门的分析类型，所以这一次不跑新查询——只读离线跑好的活跃度结果。'
                : intent.id === 'llm'
                  ? '模型这一次一次工具都没有调用，所以没有任何查询结果可显示。'
                  : '这一次没有需要执行的 SQL。'}
            </p>
          ) : (
            data.outcomes.map((o) => (
              <div key={o.spec.id} className="flex flex-col gap-2 rounded-lg border border-hairline p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold text-ink">{o.spec.label}</p>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-2">
                      {o.spec.purpose}
                    </p>
                  </div>
                  <span className="shrink-0 text-[10.5px] text-ink-3 tabular">
                    {o.status === 'done'
                      ? `${o.rowCount} 行 · ${formatMs(o.ms)} ms`
                      : o.status === 'error'
                        ? '执行失败'
                        : '未执行'}
                  </span>
                </div>

                {/* ★ language 从 spec 里读，不写死 'sql'。
                    Python 那一步走的是另一套高亮；写死的话它会被按 SQL 上色，
                    不报错，只是颜色不对。 */}
                <CodeBlock code={o.spec.sql} language={o.spec.language ?? 'sql'} collapsedLines={7} />

                {o.status === 'done' && o.rowCount > 0 && (
                  <DataTable columns={o.spec.columns} rows={toTableRows(o)} maxHeight={300} />
                )}
                {o.status === 'done' && o.rowCount === 0 && (
                  <p className="rounded-lg border border-dashed border-hairline px-3 py-3 text-center text-[11.5px] text-ink-3">
                    这条查询没返回结果。
                  </p>
                )}
                {o.status === 'error' && (
                  <p className="rounded-lg border border-down/30 bg-down/5 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-ink-2">
                    {o.error}
                  </p>
                )}

                {o.status === 'done' && o.spec.explain && o.rowCount > 0 && (
                  <p className="text-[11.5px] leading-relaxed text-ink-2">
                    <span className="font-semibold text-ink-3">这条查出了什么 · </span>
                    {o.spec.explain(o.rows)}
                  </p>
                )}
              </div>
            ))
          )
        ) : plan.queries.length === 0 ? (
          <p className="rounded-lg border border-dashed border-hairline px-3.5 py-3 text-[11.5px] leading-relaxed text-ink-3">
            {intent.id === 'generic'
              ? '没有匹配到专门的分析类型，所以这一次不跑新查询——只读离线跑好的活跃度结果。'
              : '这一次没有需要执行的 SQL。'}
          </p>
        ) : (
          /* 还没跑完（首屏、或者正在建库）。这里不能空着——
             卡片空着会让人以为「执行分析」这一步什么都没做。 */
          <p className="rounded-lg border border-dashed border-hairline px-3.5 py-3 text-[11.5px] leading-relaxed text-ink-3">
            准备好了 {plan.queries.length} 条 SQL，正在建数据库并依次执行…
          </p>
        )}

        {/* 交叉验证：两个独立实现算同一个数 */}
        {data && data.crossChecks.length > 0 && (
          <div className="rounded-lg border border-hairline bg-plane/40 px-3.5 py-3">
            <p className="text-[11px] font-semibold text-ink-3">
              交叉验证：SQL 与 Python 算同一个数，看对不对得上
            </p>
            {data.crossChecks.map((c) => {
              const same = c.sqlValue === c.pyValue
              return (
                <div key={c.label} className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[12px] text-ink-2">{c.label}</span>
                  <span className="text-[12px] text-ink tabular">
                    SQL {formatCount(c.sqlValue)} {c.unit}
                  </span>
                  <span className="text-[11px] text-ink-3">vs</span>
                  <span className="text-[12px] text-ink tabular">
                    Pandas {formatCount(c.pyValue)} {c.unit}
                  </span>
                  <span
                    className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
                    style={
                      same
                        ? { background: 'rgba(12,163,12,0.09)', color: '#0a7d0a' }
                        : { background: 'rgba(208,59,59,0.10)', color: '#b02a2a' }
                    }
                  >
                    {same ? '完全一致' : '不一致'}
                  </span>
                </div>
              )
            })}
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
              上面每一条都是「两套完全独立的实现算同一个数」：一边是浏览器里的 SQL（本次真执行），
              一边是在本机离线跑过的 Pandas。口径写在两份不同的代码里，最容易悄悄跑偏，
              所以每次都对一遍 —— 不相等会当场标红，而不是悄悄过去。
            </p>
          </div>
        )}
      </StepCard>

      {/* ================= 本次用到的代码（同一批，可切换查看） ================= */}
      {codeTabs.length > 0 ? (
        <div className="rounded-xl border border-hairline bg-card px-4 py-3.5">
          <p className="text-[12.5px] font-semibold text-ink">
            本次用到的代码（这就是上面结果的全部来源）
          </p>
          <p className="mt-0.5 mb-2.5 text-[11.5px] leading-relaxed text-ink-2">
            SQL 那几段是在这个页面里真的跑过一次的。
            {/* ★ 那半句「Python 由 analyze.py 离线跑过」只在【真有离线 Python 标签】时才说。
                大模型路径的 plan.pyCaseIds 恒为空，无条件写着这句话就是在描述一个
                不存在的标签页 —— 而它读起来完全正常，不会报错。 */}
            {offlinePyTabCount > 0
              ? `Python 那几段由 analyze.py 在本机离线跑过，页面读的是那次的结果（共 ${offlinePyTabCount} 段）。两边都标了出来。`
              : '本次没有离线跑过的 Python 代码段，所以只有 SQL。'}
          </p>
          <SqlPythonTabs tabs={codeTabs} />
        </div>
      ) : null}
      </Disclosure>

      {/* ================= 第 5 步：得到分析结果 =================
          这一步【必须留在折叠区外面】：图用 ResponsiveContainer 自适应宽度，
          而 display:none 的容器量到的宽度是 0，收起来时会画成一片空白。 */}
      <StepCard
        no={5}
        title="得到分析结果"
        status={steps[4].status}
        summary={steps[4].summary}
      >
        {/* 卡片的标题 / 副标题 / 单位 / 提示一律从 chartMeta.ts 查表。
            原来这里是 `id === 'dauTrend' ? … : …` 的二选一三目——
            加到四张图之后它会变成嵌套三目，而且【漏一个分支不报错】，
            只会让新图顶着旧图的标题显示。查表版本漏了就编译不过。 */}
        {/*
          ★ 大模型路径这一次【挑不出可画的图】时，必须把原因说出来。
            规则路径不会走到这里：它的每张图都是事前为那类问题准备好的，
            charts 为空只意味着「这一次不画图」，没什么可解释的。
            而大模型路径的 charts 是【运行时挑出来的】—— 挑不出来是一个结果，
            原因（模型一次没调 / 全失败 / 没有一张表长得像「分类列 + 数值列」）
            写在 data.llmChart.note 里，那句文案由 verify.ts 的 noChartNote 生成，
            这里不另写一份。
        */}
        {data?.llmChart?.kind === 'none' && (
          <p className="rounded-lg border border-dashed border-hairline bg-plane/40 px-3.5 py-3 text-[11.5px] leading-relaxed text-ink-2">
            {data.llmChart.note}
          </p>
        )}

        {plan.charts.map((id) => {
          const meta = CHART_META[id](plan)
          return (
            <ChartCard
              key={id}
              title={meta.title}
              subtitle={meta.subtitle}
              meta={meta.meta}
              note={meta.note}
            >
              {/* ★ 拿不到数据的两条路分开走，而且都【不空着】：
                  还没跑完 → 说明在等什么、要等多久；
                  跑完了但这一次没有 → 由 ChartBoard 逐张说明缺的是哪一条查询。
                  以前这里是一个 `: null`，读者看到的是一张正文空白的卡片。 */}
              {data ? (
                <ChartBoard id={id} data={data} days={plan.days} emptyHint={meta.emptyHint} />
              ) : (
                <ChartLoading progress={progress} />
              )}
            </ChartCard>
          )
        })}

        {data && (
          <EvidencePanel verdict={intent.verdict(data)} items={intent.evidence(data)} />
        )}
      </StepCard>

      {/* ================= 第 6 步：输出业务洞察 ================= */}
      <StepCard
        no={6}
        title="输出业务洞察"
        status={steps[5].status}
        summary={steps[5].summary}
      >
        {/* ★ 加载时这里以前是整块消失的，读者会以为这一页只有七步…
            洞察确实要等数字齐了才写得出来 —— 那就把这句话说出来。

            ★ 中止那一条单独分出来：这时候 data 是有的（轨迹照常产出了一份），
              但模型根本没写出结论。不分的话会掉进 llmInsight 里那个
              「没有调用任何工具就给出了结论」的分支 —— 而它【没给出结论】。
              同一页顶部横幅正在说「跑到一半停了」，这里却暗示它答完了。 */}
        {data ? (
          trace.aborted ? (
            <p className="rounded-lg border border-dashed border-hairline px-3.5 py-3 text-[11.5px] leading-relaxed text-ink-2">
              {LLM_ABORTED_NO_INSIGHT}
            </p>
          ) : (
            <InsightList insights={intent.insight(data)} />
          )
        ) : (
          <p className="rounded-lg border border-dashed border-hairline px-3.5 py-3 text-[11.5px] leading-relaxed text-ink-3">
            业务洞察要等第 4 步跑完、数字齐了才写得出来。跑完会自动出现在这里，不需要再点一次。
          </p>
        )}
      </StepCard>

      {/* ================= 有警告就如实说出来 ================= */}
      {trace.warnings.length > 0 && (
        <div className="rounded-xl border border-down/30 bg-down/5 px-4 py-3.5">
          <p className="text-[12px] font-semibold text-[#b02a2a]">
            这次分析有 {trace.warnings.length} 条需要说明的情况
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {trace.warnings.map((w) => (
              <li key={w} className="text-[11.5px] leading-relaxed text-ink-2">
                · {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ================= 第 7 步：标注分析可信度 =================
          放在最后，是因为它就是整页的页脚：读者读完全部结论之后，
          最后看到的是「这些数字是怎么来的、哪些是真的、哪些不是」。
          反过来把可信度写在开头，读者还没看到结论，也就不会去看它。 */}
      <StepCard
        no={7}
        title="标注分析可信度"
        status={steps[6].status}
        summary={steps[6].summary}
      >
        {/* 大模型路径多一层：把「数字核对」摊开。
            规则路径没有这一块 —— 它的每个数字都是模板从真实结果里取的，
            不存在「编一个数字」这条路，所以没什么可核对的。 */}
        {trace.llm && (
          <>
            <NumberAudit detail={trace.llm} />
            <p className="text-[11px] leading-relaxed text-ink-3">
              ★ 上面这一段是【本地程序】算的，不是模型自评的：它拿结论原文去工具返回的结果里
              逐个数字找出处。找不到的不代表模型在编，但页面必须把它列出来，
              因为这是唯一能替你发现「它编了一个数」的东西。
            </p>
          </>
        )}

        <TrustFooter trace={trace} busy={busy} />
      </StepCard>
    </div>
  )
}

/* --------------------------------------------------------------------------
   把本次用到的 SQL 和 Python 收集成可切换的 Tab
   -------------------------------------------------------------------------- */

function buildTabs(trace: AgentTrace): CodeTab[] {
  const tabs: CodeTab[] = []

  trace.plan.queries.forEach((q, i) => {
    tabs.push({
      key: q.id,
      label: `SQL ${i + 1}`,
      language: 'sql',
      code: q.sql,
      provenance: 'live',
      note: `${q.label} —— ${q.purpose}`,
    })
  })

  trace.plan.pyCaseIds.forEach((id) => {
    const code = PY_RESULTS.snippets[id]
    if (!code) return
    tabs.push({
      key: `py:${id}`,
      label: `Python · ${id}`,
      language: 'python',
      code,
      provenance: 'offline',
      note: '这段代码由 scripts/analyze.py 在本机离线跑过，页面读的是那次运行的输出，不是当场执行。',
    })
  })

  return tabs
}
