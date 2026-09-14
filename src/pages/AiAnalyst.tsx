/* ==========================================================================
   AI 数据分析助手
   --------------------------------------------------------------------------
   这一页只做三件事：收问题、驱动 Agent 跑一遍、把轨迹交给组件渲染。
   分析逻辑一行都不在这里——它在 src/data/ai/ 里，
   这样它才能被命令行脚本单独调用和断言（本机有一批检查就是这么跑的）。

   ★ 页面状态只有五个，不多不少：
       trace     —— 这一次分析的完整轨迹（计划 + 步骤 + 数据 + 警告）
       busy      —— 正在跑
       progress  —— 建库进度（只有第 4 步在做时才显示）
       probe     —— 本机后端探测结果（决定走大模型还是规则路径）
       question / days —— 输入框与时间窗口

   ★ 这一页【真的会去调大模型】—— 但只在探到后端时。
     探不到就如实降级到那条规则路径，并把原因显示出来。
     两条路产出的都是同一个 AgentTrace，下面的组件不关心是哪条路。

   ★ 为什么首次打开就自动跑一遍 Demo 1？
     因为这个页面的重点是「一条分析链长什么样」，而不是「一个输入框」。
     打开就看到整条链路，比让人先点一次更有说服力。
     建库要几秒，刚好把进度条也演示了。
     ★ 但大模型那条路上，自动跑一次 = 真发一轮请求、真产生用量。
       所以它多一道「这个标签页跑过没有」的闸门，见下面 AUTORUN。
       规则路径【不加这道闸门】—— 它不花钱，而且手动起过后端的人看到的行为
       必须和从前一模一样。

   ★ StrictMode 下 useEffect 会跑两次（React 开发模式的行为）。
     getSharedSqlEngine 有 Promise 缓存，不会建两次库；
     但 runAgentPlan 会被调两次、查询跑两遍。所以这里用一个 ref 挡住第二次。
   ========================================================================== */

import { useCallback, useEffect, useRef, useState } from 'react'

import type { BuildProgress } from '../data/sql/engine'
import type { AgentTrace } from '../data/ai/types'
import type { BackendProbe, ConversationState } from '../data/ai/llm/types'
import { FIRST_DEMO, RANGES } from '../data/ai/demos'
import { resetSharedSqlEngine } from '../data/ai/engine'
import { crashedTrace, describeThrown, planAgent, runAgentPlan } from '../data/ai/runner'
import { probeBackend } from '../data/ai/llm/client'
import { appendTurn, digestFromTrace, emptyConversation } from '../data/ai/llm/history'
import { llmSkeletonTrace, runLlmAnalysis } from '../data/ai/llm/loop'
import AgentWorkflow from '../components/ai/AgentWorkflow'
import { HonestyBanner, canSwitchToLlm } from '../components/ai/TrustFooter'
import QuestionInput, { submitLabel } from '../components/ai/QuestionInput'

/** 默认窗口。写在一处，初始计划、初始输入框、初始状态都用它，免得三处对不上。 */
const DEFAULT_DAYS = RANGES[2].days

/* --------------------------------------------------------------------------
   后端探测：整个标签页只探一次
   --------------------------------------------------------------------------
   ★ 为什么是【模块级变量】，不是 useRef、不是 useState：
     StrictMode 下组件会被挂载两次，ref 跟着重建 —— 只靠 ref 挡的话
     /api/health 会发两次。模块级变量活过重挂载，真正只发一次。
     （React 官方文档里那个「用模块级 Promise 做一次性初始化」的写法就是这个。）
   -------------------------------------------------------------------------- */

let probePromise: Promise<BackendProbe> | null = null

/** 探一次，之后所有调用者共用同一个 Promise（包括探测失败的结果）。 */
export function probeOnce(): Promise<BackendProbe> {
  probePromise ??= probeBackend()
  return probePromise
}

/* --------------------------------------------------------------------------
   自动跑一次的闸门（只对【大模型路径】生效）
   --------------------------------------------------------------------------
   ★ 存在 sessionStorage 里，不是 localStorage：
     用户要的是「这个标签页里只自动跑一次」。用 localStorage 的话，
     关掉标签页明天再打开也不会自动跑，而那时他多半已经忘了为什么。
   ★ 包 try/catch：无痕模式下 sessionStorage 的读写都可能直接抛异常，
     包起来最坏只是退化成「每次都自动跑」（和没有闸门时一样），
     不包则整页白屏 —— 那是最糟的一种降级。
   -------------------------------------------------------------------------- */

const AUTORUN_KEY = 'ai-analyst:llm-autorun-done'

export const AUTORUN_SKIPPED_NOTE =
  '★ 这个标签页里已经自动跑过一次了，所以这次刷新【不会】再自动跑 —— ' +
  '大模型那条路每跑一次都是一次真实的请求和用量。想再跑，点下面的按钮，' +
  '或者换一个问题。'

function autorunAlreadyDone(): boolean {
  try {
    return sessionStorage.getItem(AUTORUN_KEY) === '1'
  } catch {
    return false
  }
}

function markAutorunDone(): void {
  try {
    sessionStorage.setItem(AUTORUN_KEY, '1')
  } catch {
    /* 写不进去就算了：下一次刷新再自动跑一次，代价是多一次请求，不是错。 */
  }
}

/* --------------------------------------------------------------------------
   会话（多轮对话）
   --------------------------------------------------------------------------
   ★ 会话状态放在【一个 ref】上，不是 useState。两个理由，都不是风格问题：

     1. `run` 是 `useCallback([])`（见下面那段注释：它不许把 probe 写进依赖，
        否则会拿到陈旧闭包）。会话同理 —— 写进依赖里会让 run 每次 rerender
        都换一个新身份，`useEffect([run])` 那个自动跑的闸门就失效了。
     2. 它是【输入】不是【渲染依据】：这一轮要不要带上下文，读的是调用那一刻
        最新的值。而页面要显示的那份上下文，已经随 trace 一起出来了
        （trace.llm.contextIn / contextOut），不需要第二个真相来源。

   ★ 刷新页面即清空 —— 这是【有意】的，不是没做持久化：
     这个项目的定位是「当场把一次分析做完」，不是长期记忆。
   -------------------------------------------------------------------------- */

/** 点「新建分析」之后那一行说明。抽成常量，脚本逐字断言。 */
export const NEW_SESSION_NOTE =
  '已新建一次分析：下一次提问【不会】带上任何前文（上面这张卡说的是刚才那一轮，不受影响）。'

/* --------------------------------------------------------------------------
   「窗口切了、但下面这份结果还是旧窗口的」——这条提示有【两种】措辞
   --------------------------------------------------------------------------
   ★ 为什么必须分开写，不能合用一句：
     窗口可能是【用户自己】拨的（点那三个按钮），
     也可能是【模型申报之后我们替他拨的】（用户问了「最近 7 天呢」）。

     原来只有一句、开头是「你把时间窗口切成了…」。第二种情况下这句话是【假话】——
     用户根本没碰过那个按钮，是模型理解成了 7 天、我们替他拨的。
     这个页面最不能出的就是这种「读起来顺、但说的是假的」的句子。

   ★ 两句话的共同点，每一句都是真的、都要保留：
     · 窗口【确实】已经切过去了（按钮真的跳了）；
     · 下面这份结果【确实】还是旧窗口的（没有自动重跑）；
     · 不自动重跑的理由（要重新查一遍库）；
     · 下一步该点哪个按钮（按钮上的字会变，所以从 submitLabel 取，不写死）。
   -------------------------------------------------------------------------- */

/** 用户自己拨了窗口按钮时的提示。 */
export function staleWindowNote(days: number, ranDays: number, submit: string): string {
  return (
    `你把时间窗口切成了「近 ${days} 天」，但下面这份结果还是「近 ${ranDays} 天」的` +
    `—— 换窗口要重新查一遍数据库，所以不自动重跑。点一下「${submit}」即可。`
  )
}

/**
 * 屏幕上那条「窗口被切了」的横幅，到底该说是【谁】切的？
 *
 * ★ 为什么值得单独一个函数：这三个条件原来是一个内联表达式，
 *   而它【一条断言都没有】—— 反证时把后两个条件删掉，八把脚本照样全绿。
 *   可那样一来，用户自己拨了窗口、模型从没申报过时，屏幕上会写着
 *   「模型把时间窗口理解成了…」—— 一句彻底的假话，而且它看着完全合理。
 *   （做「把源码改回没有保护的样子、确认断言会红」的反证时逮到的。）
 *
 * ★ 三个条件缺一不可：
 *   · 模型确实申报过；
 *   · 现在的窗口就是它要的那个（说明按钮是朝它要的方向拨的）；
 *   · 而它跑的那一轮用的【不是】这个窗口 —— 第三条最容易漏：
 *     模型申报 7 天、而跑的本来就是 7 天时，根本没发生切换，这句提示压根不该出现。
 */
export function isWindowSwitchedByModel(
  requestedDays: number | null,
  days: number,
  ranDays: number,
): boolean {
  return requestedDays !== null && days === requestedDays && ranDays !== requestedDays
}

/** 模型申报了换窗口、我们替他拨了按钮时的提示。 */
export function modelSwitchedWindowNote(days: number, ranDays: number, submit: string): string {
  return (
    `模型把时间窗口理解成了「近 ${days} 天」，按钮已经替你拨过去了` +
    `—— 但下面这份结果还是「近 ${ranDays} 天」的，它并不会因为按钮动了就变成新窗口的数据。` +
    `换窗口要重新查一遍数据库，所以不自动重跑。点一下「${submit}」即可。`
  )
}

export default function AiAnalyst() {
  const [question, setQuestion] = useState(FIRST_DEMO)

  /* 显式写 <number>：RANGES 是 as const，不写的话这里会被推断成字面量 30，
     后面就传不进 (d: number) => void 的回调里 */
  const [days, setDays] = useState<number>(DEFAULT_DAYS)

  /*
    ★ 初始状态就把 Demo 1 的【规则计划】算好，而不是先给个 null。
      因为 planAgent 本来就是同步的、毫秒级的——首屏直接显示
      「识别成了什么 / 打算怎么分析 / 用哪些工具」，只是第 4 步还在等数据库。

      这样做的两个好处：
        1. 页面永远不会先空一下再出现内容；
        2. 「渲染一遍看有没有炸」那类检查能真正检查到这七步，
           而不是只看到一个「正在准备…」。否则那个检查等于没检查。

    ★ mode 写 'rule' 是【首屏的占位】。探测回来之前谁也不许替用户选一条路，
      所以这个占位值只用来让类型完整、让首屏能渲染七步骨架；
      页脚的「本次走的路」在跑完之前显示的是「还没跑完」，不看这个字段。
      真正的值在 run() 里由探测结果决定。
  */
  const [trace, setTrace] = useState<AgentTrace>(() => {
    const plan = planAgent(FIRST_DEMO, { days: DEFAULT_DAYS })
    return {
      mode: 'rule',
      plan,
      steps: plan.steps,
      data: null,
      engineMode: 'none',
      warnings: plan.warnings,
    }
  })
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<BuildProgress | null>(null)
  const [probe, setProbe] = useState<BackendProbe | null>(null)
  const [autorunSkipped, setAutorunSkipped] = useState(false)
  /** 点过「新建分析」之后要显示那一行说明；下一次提问时清掉。 */
  const [newSession, setNewSession] = useState(false)

  /* 挡住 StrictMode 的第二次执行 */
  const started = useRef(false)
  /* 挡住「正在跑的时候又点了一次」。按钮虽然已经禁用了，
     但在输入框里按回车同样会触发提交。两次一起跑会让结果互相覆盖。 */
  const running = useRef(false)
  /* ★ 本次会话至今的历史与上下文。理由见上面「会话」那一段。 */
  const conversation = useRef<ConversationState>(emptyConversation())

  /**
   * 跑一次分析。走哪条路由【探测结果】决定。
   *
   * ★ 它【不读 probe 这个 state】—— 这正是它可以是 useCallback([]) 的原因：
   *   写在依赖里会拿到陈旧闭包（第一帧永远是 null），不写又会过时报警。
   *   办法是干脆不用那个 state：自己 await probeOnce()，拿到的永远是同一份结果。
   *   ⚠️ 以后不要往这里加 `probe?.kind === 'ready' &&`。
   *
   * ★ forceRule 不是粘性状态：它只影响【这一次】。下一次点按钮照旧先探测、
   *   照旧可以走大模型 —— 否则用户会被永久困在规则路径上，而且不会察觉。
   */
  const run = useCallback(
    async (text: string, windowDays: number, opts?: { forceRule?: boolean }) => {
      const q = text.trim()
      if (!q || running.current) return
      running.current = true

      setBusy(true)
      setProgress(null)
      /* 新的一轮开始了，「刚新建过分析」那行说明就该收起来 ——
         留着的话，它会顶着一份【已经带上历史】的新结果说「下次不带前文」。 */
      setNewSession(false)

      try {
        const p = await probeOnce()
        setProbe(p)

        if (p.kind === 'ready' && !opts?.forceRule) {
          /* ---- 大模型路径 ----
             ★ 首屏先摆七步骨架：这条路【没有】同步算得出来的计划
               （规则路径的 planAgent 是同步的，这条路不是），
               所以在模型回第一个字之前，能显示的只有骨架本身。
               编一份假计划出来会更糟：模型真正回答之后它会被替换掉，
               用户看不出自己刚才看的是假的。 */
          setTrace(llmSkeletonTrace(q, windowDays))

          const result = await runLlmAnalysis(q, {
            backend: p,
            days: windowDays,
            /* ★ 把会话交给它 —— 「他们」是谁、上一轮问过什么，模型就是从这里知道的。
               第一次提问时它是一份空会话，那条路和单轮提问逐字节一样。 */
            conversation: conversation.current,
            onProgress: setProgress,
            onStep: (steps) => setTrace((prev) => (prev ? { ...prev, steps } : prev)),
          })
          setTrace(result)

          /* ---- 模型申报了「用户想换成几天」→ 把窗口按钮拨过去，然后就不管了 ----
             ★ 拨完之后屏幕上会自动出现那条「窗口切了、但结果还是旧窗口的」提示，
               用户点一下就能拿到真数据。**这里【绝不】自动重跑**：
               重跑要重新查一遍库，还要多花一轮模型调用的钱，
               而且屏幕上会先闪出一份旧窗口的答案、再被新窗口的盖掉 ——
               两份结论长得几乎一样，用户会以为程序抽风。
             ★ 只在【真的不一样】的时候才拨：本来就在 7 天、模型也说 7 天时，
               setDays 不产生任何变化，白让 React 重渲染一次。 */
          const wantDays = result.llm?.requestedDays ?? null
          if (wantDays !== null && wantDays !== windowDays) setDays(wantDays)

          /* ---- 把这一轮记进会话，下一轮就能接上 ----
             ★ 中止的那一轮【不记】：它没有结论可继承（digest.conclusion 是空串），
               记进去只会在历史里多出一条空轮次，把真正有用的那几轮挤出预算。
               用户真要接着问，问的还是同一个问题，重跑一遍就有了。
             ★ 记的时候用的是 trace 上已经算好的那一份（digestFromTrace），
               不在这里另拼一份 —— 两处各拼一次，迟早在某次改动后不一致，
               而不一致时【不会报错】。 */
          if (!result.aborted) {
            const digest = digestFromTrace(result)
            if (digest) conversation.current = appendTurn(conversation.current, digest)
          }
          return
        }

        /* ---- 规则路径（降级方案，一行逻辑未改） ----
           ★ mode 传 'static' 还是 'rule' 只影响【显示】：file:// 下跑的确实是
             规则路径，但用户该做的事是「换个方式打开」，不是「去启动后端」。 */
        const plan = planAgent(q, { days: windowDays })
        const mode = p.kind === 'static' ? 'static' : 'rule'

        /* planAgent 是同步的、毫秒级的——前三步立刻就能画出来，不加任何假等待 */
        setTrace({
          mode,
          plan,
          steps: plan.steps,
          data: null,
          engineMode: 'none',
          warnings: plan.warnings,
        })

        /* try/finally 在这里是保险而不是必需：runAgentPlan 承诺不抛异常
           （失败会被记成步骤状态和 warnings）。但万一将来有人改坏了这个承诺，
           没有 finally 的话 running.current 会永远停在 true，页面从此点不动——
           那种「看起来没反应」的故障最难查。 */
        const result = await runAgentPlan(plan, {
          mode,
          onProgress: setProgress,
          onStep: (steps) => setTrace((prev) => (prev ? { ...prev, steps } : prev)),
        })
        setTrace(result)
      } catch (e) {
        /* ==================================================================
           ★★ 这个 catch 修的是一个【用户真的会看到】的故障，别删。★★

           在这之前这里是 `try { … } finally { … }`，【没有 catch】。
           于是上面任何一句 await 只要拒绝一次，后面那句 `setTrace(result)`
           就永远不会执行 —— 轨迹【一直停在】调用之前设下的那份骨架上。
           而大模型路径的骨架，第 1 步写的是「正在把问题交给大模型…」。

           用户看到的是：**页面永远显示「正在把问题交给大模型」，没有报错、
           没有提示、控制台也是干净的**（busy 被 finally 复位了，按钮还能点）。
           他唯一能想到的解释是「网慢，再等等」—— 而它永远不会变。

           ★ 为什么这个 catch 是【必需】而不是「保险」：
             `runLlmAnalysis` 的 try/catch 只包住了阶段 A（工具循环）和阶段 B
             （作答），而它【后半段】—— 数字核对、拼计划、挑图、buildAnalysisData ——
             整段是【没有保护】的（loop.ts:371 往后）。那一段里任何一处抛异常，
             都会原样冒到这里来。

           ★ 这里【不判是哪条路】：crashed 这一种失败两条路都会发生，
             说法也一样（「页面自己的代码出错了」）。
             唯一要分路的那一处是「改用规则」那个按钮 ——
             规则路径上它是句假话（本来就是规则路径，再跑一遍结果一模一样），
             所以那个开关由 LlmFailureNotice 的 switchToRuleOnlyOnLlm 负责，
             这里不重复判一遍（判两遍迟早出现两处不一致，而不一致不报错）。
           ================================================================== */
        const reason = describeThrown(e)

        setTrace((prev) => {
          /* ★ 底子怎么选，只有两条，判据是「屏幕上那份到底是不是这一轮的」。

             `data === null` = 这一轮【还没有跑出结果】，那它必定就是这一轮
             刚摆上去的那一份（两条路都在起跑前先 setTrace 摆好底子）。
             拿它当底子，已经跑完的步骤、已经显示的进度都留着 ——
             整个丢掉重来会让人以为「刚才那些都不算数」。

             `data !== null` = 屏幕上那份是【上一轮】的结果。绝不能拿它当底子：
             那上面的图、结论、工具调用记录都是上一句问题的，而横幅说的是这一句，
             两者对不上号，而且【不会报错】。这种情况只有「探测自己就炸了」能走到
             （那时这一轮的底子还没摆上），所以重建一份空的。 */
          const base =
            prev.data === null
              ? prev
              : prev.mode === 'llm'
                ? llmSkeletonTrace(q, windowDays)
                : (() => {
                    const plan = planAgent(q, { days: windowDays })
                    const mode = prev.mode === 'static' ? ('static' as const) : ('rule' as const)
                    return {
                      mode,
                      plan,
                      steps: plan.steps,
                      data: null,
                      engineMode: 'none' as const,
                      warnings: plan.warnings,
                    }
                  })()

          return crashedTrace(base, reason)
        })

        /* 这一句是给控制台留的。页面上的横幅和 warnings 已经写清楚了，
           但开发时（F12）能直接看到栈，查起来快得多。 */
        console.error('[AiAnalyst] 本次分析在页面这一侧抛了异常：', e)
      } finally {
        setProgress(null)
        setBusy(false)
        running.current = false
      }
    },
    [],
  )

  useEffect(() => {
    if (started.current) return
    started.current = true

    void (async () => {
      const p = await probeOnce()
      setProbe(p)

      /* 闸门只管大模型那条路：探不到后端时，自动跑一次是本地计算，
         不花钱也不联网 —— 这时候拦住它，只会让手动起过后端的人
         觉得页面「打开是空的」。 */
      if (p.kind === 'ready') {
        if (autorunAlreadyDone()) {
          setAutorunSkipped(true)
          return
        }
        markAutorunDone()
      }

      await run(FIRST_DEMO, DEFAULT_DAYS)
    })()
  }, [run])

  /**
   * 「重试一次」。
   *
   * ★ 规则路径的第一句必须是 resetSharedSqlEngine()，不然这个按钮就是个摆设：
   *   数据库引擎把【失败结果本身】也缓存住了（enginePromise 里存着一个已经
   *   resolve 成 null 的 Promise），不先把它扔掉，再调一次 run() 会立刻
   *   拿到同一个 null，界面看起来毫无反应 —— 而这种「点了没反应」不报错，最难查。
   *
   * ★ 大模型路径【不能】跟着 reset：那条路失败的原因在模型/网络那一侧
   *   （超时、断线、限流），把已经建好的库扔掉只会让重试白等几秒重建，
   *   而它不是病因。库里已经有数据的话，重试还能少等一次建库。
   *
   * ★ 重跑的是【这份结果当初问的那句问题】，不是输入框里现在写的内容。
   *   用输入框的值的话，「重试」会悄悄换一个问题跑，而用户以为只是重试。
   *   横幅里已经把「会重跑哪一句、哪个窗口」写出来了，两边对得上。
   */
  const retry = useCallback(() => {
    if (trace.mode !== 'llm') resetSharedSqlEngine()
    void run(trace.plan.question, trace.plan.days)
  }, [run, trace.mode, trace.plan.question, trace.plan.days])

  /**
   * 「改用规则再跑一遍（结果会不一样）」。
   *
   * ★ 它【必须】先 reset 引擎，理由和上面那条相反：
   *   LLM 路径失败时数据库很可能压根没建（模型可能一次 SQL 都没跑成），
   *   而引擎缓存里存的正是那份失败结果。不扔掉的话，切过去跑规则路径
   *   会立刻拿到同一个 null，页面上看起来「换了条路还是一样没数据」。
   */
  const retryAsRule = useCallback(() => {
    resetSharedSqlEngine()
    setAutorunSkipped(false)
    void run(trace.plan.question, trace.plan.days, { forceRule: true })
  }, [run, trace.plan.question, trace.plan.days])

  /**
   * 「新建分析」：把会话清空，下一问从头开始。
   *
   * ★ 它【不动屏幕上这份结果】，两件事分开：
   *     · 会话        = 下一问要带什么前情（这是被清掉的那个）
   *     · 屏幕上的结果 = 刚才那一轮做过什么（这是留下的那个）
   *   如果顺手把结果也清掉，用户会以为自己刚才那些分析白做了；
   *   而如果连提示都不给一句，用户又会以为点了没反应 —— 所以下面那行说明
   *   是必需的，不是装饰。
   * ★ 注意别把它做成「清空屏幕」：那会让人不敢点。
   */
  const resetConversation = useCallback(() => {
    conversation.current = emptyConversation()
    setNewSession(true)
  }, [])

  /* 换时间窗口不自动重跑：重跑要重新查一遍库，
     默默地跑会让用户以为只是切了个显示。等他自己点按钮。 */
  const staleWindow = trace.plan.days !== days

  /* 这次窗口变动是不是【模型申报之后我们替他拨的】（判据在 isWindowSwitchedByModel 里）。
     ★ 从 trace 上【推】出来，而不是另存一个 state：
       另存的话，用户随后自己又点了一下按钮，那个 state 就是陈旧的 ——
       提示会继续说是「模型拨的」，而他明明是手动拨的。推出来的值不可能过时。 */
  const modelRequestedDays = trace.llm?.requestedDays ?? null
  const switchedByModel = isWindowSwitchedByModel(modelRequestedDays, days, trace.plan.days)

  /* 跑过一轮就有结果 —— 失败也有（那是一份带着如实说明的轨迹）。
     所以失败之后按钮显示「重新分析」是对的：那条路本来就是再跑一次。 */
  const hasResult = trace.data !== null

  return (
    <div className="flex flex-col gap-4">
      <HonestyBanner probe={probe} trace={trace} />

      <QuestionInput
        value={question}
        onChange={setQuestion}
        onSubmit={() => {
          setAutorunSkipped(false)
          void run(question, days)
        }}
        days={days}
        onDays={setDays}
        busy={busy}
        hasResult={hasResult}
        canUpgrade={canSwitchToLlm(probe, trace)}
      />

      {/* ★「新建分析」只在【大模型路径】上出现：
          规则路径是「一问一答、每问从零开始」的，它压根没有会话可清 ——
          在那个上面摆一个「清空上下文」的按钮，是在描述一个不存在的东西。 */}
      {trace.mode === 'llm' && trace.data !== null && (
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={resetConversation}
            disabled={busy}
            className="rounded-lg border border-hairline px-3 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            新建分析
          </button>
          <span className="text-[11px] leading-relaxed text-ink-3">
            {newSession
              ? NEW_SESSION_NOTE
              : '把上下文清空、从头开始问。不会动下面这份结果。'}
          </span>
        </div>
      )}

      {autorunSkipped && !busy && (
        <p className="rounded-lg border border-hairline bg-card px-4 py-2.5 text-[11.5px] leading-relaxed text-ink-2">
          {AUTORUN_SKIPPED_NOTE}
        </p>
      )}

      {staleWindow && !busy && (
        <p className="rounded-lg border border-hairline bg-card px-4 py-2.5 text-[11.5px] leading-relaxed text-ink-2">
          {switchedByModel
            ? modelSwitchedWindowNote(
                days,
                trace.plan.days,
                submitLabel(busy, hasResult, canSwitchToLlm(probe, trace)),
              )
            : staleWindowNote(
                days,
                trace.plan.days,
                submitLabel(busy, hasResult, canSwitchToLlm(probe, trace)),
              )}
        </p>
      )}

      <AgentWorkflow
        trace={trace}
        progress={progress}
        busy={busy}
        onRetry={retry}
        onSwitchToRule={retryAsRule}
      />
    </div>
  )
}
