/* ==========================================================================
   诚实性组件：顶部说明条 + 底部「分析可信度」
   --------------------------------------------------------------------------
   ★ 这两个组件存在的唯一理由，是让页面上关于「这到底是什么」的说法
     由构造保证正确，而不是靠写文案时记得住。

     具体做法：凡是能在代码里问到的事实，就不手写死在文案里——
       · 问题理解器叫什么  → 从 ruleBasedResolver.name 读
       · Python 是哪个版本跑的 / 哪一天跑的 → 从 PY_RESULTS.manifest 读
       · 全量数据有多少行   → 从 PY_RESULTS.manifest.rowCounts 读
       · 发给模型的行数上限 → 从 FOR_MODEL_ROWS 读
       · 后端探到的是什么   → 从 probe 读
     手写的部分迟早会和代码对不上，而对不上之后，页面就在说假话。

   ★ 这个项目是拿去找工作的。把「模拟数据 + 本地规则」包装成
     「真实数据 + 大模型」被面试官问穿，比不做这个页面还糟。

   ★ 这两块之所以【分家】，理由见下面各自的注释：
       横幅说的是「这一页能不能连」（探测结果，一次会话里基本不变）；
       页脚说的是「这一次跑的是哪条路」（每次分析都可能不同）。
     混在一块的话，「探到 ready、但用户点了改用规则」这种合法组合会被显示成矛盾。
   ========================================================================== */

import { ruleBasedResolver } from '../../data/ai/matcher'
import { reasonSaysBackendDown } from '../../data/ai/llm/client'
import { PY_RESULTS } from '../../data/python/results.generated'
import { DATASET_META } from '../../data/dataset'
import { FOR_MODEL_ROWS } from '../../data/ai/llm/tools'
import type { AgentTrace } from '../../data/ai/types'
import type { BackendProbe, RunMode } from '../../data/ai/llm/types'
import { withThousands } from '../../utils/format'

/* --------------------------------------------------------------------------
   一、顶部说明条 —— 五态
   --------------------------------------------------------------------------
   ★ 五态而不是四态：探测【还没回来】是一个真实存在、而且必须如实说的状态。
     它替用户选一种模式说出来就是撒谎 —— 那半秒里页面还不知道答案。
   ★ 第五态 'deployed'（2026-09-14 作品集上线时加的）：这一页跑在静态托管上，
     背后没有后端。★ 它和 'static' 不能合成一句 —— file:// 的人是「打开方式不对」，
     线上的人是「这本来就是演示版」，两者要做的事完全不同（见 client.ts 的注释）。
   ★ 写成 Record<BannerMode, …>：加第六态不补文案是【编译错误】。
   -------------------------------------------------------------------------- */

export type BannerMode = 'probing' | 'ready' | 'rule' | 'static' | 'deployed'

export const BANNER_MODES: BannerMode[] = ['probing', 'ready', 'rule', 'static', 'deployed']

/** 探测结果 → 该显示哪一段。probe 为 null = 还没回来。 */
export function bannerMode(probe: BackendProbe | null): BannerMode {
  return probe === null ? 'probing' : probe.kind
}

interface BannerCtx {
  probe: BackendProbe | null
  /** 全量观看记录行数。从离线结果的行数指纹里读，不手抄 */
  viewRows: number
  /** 每次工具调用最多回传多少行给模型供应商 */
  modelRows: number
}

interface BannerCopy {
  headline: string
  paragraphs: string[]
}

/**
 * ready 那一段里关于「能问什么」的一句。
 *
 * ★ 加这一句的理由（2026-09-12 用户问「只能使用示例里面的」）：
 *   规则路径确实只认那 5 个示例，自己打字会匹配不上、退回一份通用概览。
 *   但大模型路径【没有任何白名单】—— 问题原样发给模型，由它决定查什么。
 *   而在这句话之前，全页一个字都没说过「上面那 5 条只是示例」，
 *   于是用户合理地以为它们就是能问的全部。
 *
 * ★ 只加在 ready 那一态：规则路径没有这个能力，跟着说就是假话。
 */
export const FREE_INPUT_NOTE =
  '★ 输入框里可以问任何问题 —— 上面那 5 条只是示例，不是能问的全部。' +
  '你自己写的问题会被原样交给模型，由它决定查什么、查几次，没有关键词白名单。'

/**
 * 句号只补一次。
 *
 * ★ 原因那句话自己就带句号（三个生产点全都带：`file://` / fetch 抛异常 /
 *   转发层替后端回话），模板再补一个就成了「。。」——
 *   2026-09-12 用户的截图里就是「…不是预期的 200。。」，而且 rule 和 static
 *   两屏都带着这个 bug（static 的 reason 也以句号结尾）。
 *
 * ★ 修在【模板】这一侧、不修在原因那一侧：原因有三处生产点，
 *   修模板一处就全好了；修原因的话，下一个写原因的人还会再踩一遍。
 *   这是项目里 `weightCompare.ts` / `halfWindow.ts` 那一族用过的老办法。
 */
export function withPeriod(s: string): string {
  return /[。！？]$/.test(s) ? s : `${s}。`
}

/**
 * 「后端没在跑」这一态，还要告诉【刚刚起过后端】的人下一步做什么。
 *
 * ★ 原来那一段只说「把后端跑起来，再刷新这一页」——
 *   而找上门的用户恰恰是【刚刚跑过它】才看到这一屏的：照做一遍，结果一模一样。
 *   那不是「没说清楚」，是【指错了方向】。
 *   所以这段话说的是「启动失败长什么样、上哪儿看那行报错」。
 *
 * ★ 2026-09-15 作品集收尾：那段话原来整段是围着本机那个启动 `.bat` 写的
 *   （「标题叫『大模型后端』的黑色窗口」是它 `title` 出来的）。而从 GitHub 上
 *   clone 下来的人手里没有那个文件 —— 让访客去双击一个他不可能有的东西，
 *   是这一屏最容易被误读成「部署坏了」的地方。所以改成【只说 `npm run server` 一条路】。
 *   ★ 那个文件名现在在这个文件里【一处都不留】：`llmcheck` ⑪-2 反过来钉着
 *     「rule 屏不许出现任何 `.bat` 文件名」。本机怎么跑写在 README 里，不写在给访客看的这一屏上。
 *
 * ★ 只在 reason 说的是「后端没在跑」时出现。后端在跑但没读到 key、或者来源被拒
 *   那两种情形下叫人去重启后端，是又一句假话（各自该说的话已经写在 reason 里）。
 */
export const BANNER_RESTART_HINT =
  '★ 如果你刚刚跑过 npm run server：' +
  '那说明后端那个进程【没起来】或者【起来又退了】。去看它的输出 —— ' +
  '① 已经没了（窗口一闪就没、或者终端已经回到提示符）：那是启动失败，' +
  '原因就在它消失前打印的最后几行里；' +
  '② 还在：看它最后几行写的是什么（会有红字或英文报错）。' +
  '两种情况都请先把它停掉、再重新跑一次。' +
  '然后按 F5 刷新这一页：' +
  '这一页只在打开的那一瞬间探一次，不刷新它就一直记着刚才那次的结果。' +
  '（那个窗口里【不会】有你的 API Key，可以放心整段截图。）'

/**
 * 四段文案。
 *
 * ★ probing 那一段【两种可能都要说，但不替用户选】：
 *   探测还没回来时替它选一种说出来，就是一句没有依据的话。
 */
export const BANNER_TEXT: Record<BannerMode, (c: BannerCtx) => BannerCopy> = {
  probing: () => ({
    headline: '正在确认这一页能不能连上本机后端。',
    paragraphs: [
      '在它回话之前，这一页不替你说走的是哪一种 —— 这个结论由探测结果决定，' +
        '不是写死在页面里的。',
      '连得上，接下来这一轮分析就真的把问题发出去算（会联网、会产生用量）；' +
        '连不上，就退回本地的那套关键词规则，并把连不上的原因原样写出来。' +
        '两条路都已经就绪，页面上会如实标出这一次到底是哪一条。',
    ],
  }),

  ready: (c) => {
    const p = c.probe as Extract<BackendProbe, { kind: 'ready' }>
    return {
      headline: '本页已接入真实大模型。',
      paragraphs: [
        `问题理解、写查询、决定要不要再查一次、写结论 —— 这几件事这一页都可以交给 ` +
          `${p.providerLabel}（${p.model}）做。` +
          '具体这一轮有没有真的这么做，以上面「本次走的路」那一行为准，而不是看这一段。',
        FREE_INPUT_NOTE,
        `★ 有一件事必须说清楚：每次工具调用，最多 ${c.modelRows} 行结果` +
          `（列名 + 前 ${c.modelRows} 行 + 总行数）会回传给模型供应商 —— ` +
          '这是工具调用的固有含义，模型不看结果就没法决定下一步。' +
          '但全量数据不出这台电脑：SQL 跑在你浏览器里的真 SQLite 上，' +
          `${withThousands(c.viewRows)} 条观看记录一条都没有上传，` +
          '发出去的只有模型自己那几次查询的结果。',
        p.pythonOk
          ? '本机 Python 可用：模型可以让本机真起一个 Python 进程算，' +
            '指令里也已经告诉它有这个工具。'
          : `本机 Python 不可用（${p.pythonDetail}）：` +
            '指令里已经告诉模型这一次没有 Python 工具，它只能用 SQL 完成分析。',
        '数据仍然是模拟的：全部由固定种子的模拟数据集算出来，与哔哩哔哩的经营数据无关。' +
          '模型写出来的话、它自己总结的规律，都不能当作真实业务结论。',
      ],
    }
  },

  rule: (c) => {
    /* ★ 把 reason 提出来：它现在要参与两个判断 —— 句号只补一次、要不要给重启提示。 */
    const reason = (c.probe as { reason: string }).reason
    return {
      headline: '本页没有接入大模型。',
      paragraphs: [
        `系统没有调用任何 LLM，也没有联网。原因：${withPeriod(reason)}`,
        '你看到的问题理解、分析计划、结论文字，全部来自本地的一套关键词规则 + 模板：' +
          '规则负责判断问题属于哪一类，模板负责把真实数字填进固定句式。' +
          '这是一个演示原型，不是通用的问答系统。',
        '但数据是真的算出来的：页面上每一条 SQL 都在你的浏览器里真的跑了一次，耗时是实测的；' +
          'Pandas 那部分由脚本在本机离线真跑过，页面读的是那次运行的结果。' +
          '哪一步是真执行、哪一步是读结果，下面每一步都标了出来。',
        '想看真的调大模型那一版：照 README 那三步跑起来 —— 把 server/.env.example 复制成 server/.env、' +
          '在 DEEPSEEK_API_KEY= 后面填上自己的 key、另开一个终端跑 npm run server —— 再刷新这一页。',
        /* ★ 最后一段是给「已经照上面做过、但没用」的人看的，所以放在最后。
           条件成立与否由 reason 本身决定 —— 见 BANNER_RESTART_HINT 的注释。 */
        ...(reasonSaysBackendDown(reason) ? [BANNER_RESTART_HINT] : []),
      ],
    }
  },

  static: (c) => ({
    headline: '本页没有接入大模型。',
    paragraphs: [
      `这一页是从本地文件直接打开的（file://），浏览器不允许它访问本机后端 —— ` +
        `换一台机器也一样，这是浏览器的限制，不是配置错了。原因：` +
        `${withPeriod((c.probe as { reason: string }).reason)}`,
      '功能和规则路径完全一样：真跑 SQL、真读离线 Pandas 结果，' +
        '只是问题理解和写结论那两步在本地完成。',
      '想看真的调大模型那一版：另开一个终端跑 npm run server 起后端，' +
        '再用 npm run dev 从 http://localhost:5173 访问这一页 —— 不要直接双击 dist/index.html，' +
        'file:// 下浏览器不允许它连本机后端。',
    ],
  }),

  /* ★★ 第五态：线上演示版（2026-09-14 作品集上线时加的）。
     ★ 为什么不能复用 static 那一段：「为什么连不上」的答案完全不同 ——
       file:// 是「换个方式打开就好了」，线上是「本来就没有，设计如此」。
       合并就是把一句准确的话换成一句含糊的话。
     ★ 为什么这一段【不许出现「双击」和那个 .bat 文件名】：
       看这一页的人是从链接点进来的 HR / 面试官，他手里【根本没有那个文件】。
       让一个正常工作、只是没接大模型的东西去指路一个他不可能有的图标，
       是这一页最容易被误读成「部署坏了」的地方。
       本地怎么跑写在仓库 README 里，这一屏只负责把「这是什么」说清楚。
     ★ 标题与另外几态【互不为子串】（rule 和 static 共用「本页没有接入大模型。」，
       所以这里必须用第三人称的另一句），否则那些「另一种说法不许出现」的
       反向断言会退化成永远绿的废检查。 */
  deployed: (c) => ({
    headline: '本页是线上演示版：背后没有后端服务。',
    paragraphs: [
      '大模型那一路需要一个跑在【你本机】的服务来保管 API Key —— ' +
        '那个服务不能、也不应该放到公网上：放上去等于把账号额度挂在任何人都能随手用到的地方。' +
        '所以这一份线上版只带本地规则这一路。原因：' +
        `${withPeriod((c.probe as { reason: string }).reason)}`,
      '功能上打了折吗？没有。每条 SQL 都在你的浏览器里真跑一次、耗时是实测的；' +
        'Pandas 那部分由脚本在本机离线真跑过，页面读的是那次运行的结果。' +
        '只有「理解问题」和「写结论」这两步换成了本地的关键词规则 + 模板。',
      '想自己跑一遍真的调大模型那一版：仓库的 README 里有完整说明，' +
        '需要你准备一个自己的 API Key。',
    ],
  }),
}

/* --------------------------------------------------------------------------
   一·五、两处共用：「这一轮走的是哪条路」
   --------------------------------------------------------------------------
   ★ 横幅和页脚都要说这句话（一个在首屏、一个在最底下），而它们的判据
     必须是【同一份实现】—— 写两份的话今天一致、将来改一处就悄悄分叉，
     而且分叉时不报错。项目里 weightCompare.ts / halfWindow.ts 都是这个理由，
     这是第四次用同一招。
   -------------------------------------------------------------------------- */

/** 页脚那一行的标签。★ 横幅用【同一个标签】，用户才能一眼对上两处说的是同一件事。 */
export const MODE_LINE_LABEL = '本次走的路'

/** 这一轮到底跑没跑过 —— 「跑过」才谈得上「走了哪条路」。 */
export function runHasStarted(trace: AgentTrace): boolean {
  return trace.data !== null || trace.aborted !== undefined || trace.crashed !== undefined
}

/**
 * 这一轮走的是哪条路。
 * ★ crashed 排在最前面：崩溃时可能连底子都还没摆上
 *   （trace.data 是 null、trace.aborted 也没有），那时 mode 还是初始占位值。
 */
export function runModeLine(trace: AgentTrace): string {
  if (trace.crashed) return MODE_LINE_CRASHED
  return runHasStarted(trace) ? MODE_LINE[trace.mode] : MODE_LINE_PENDING
}

/**
 * 后端接得上（探测 ready），但这一轮的 mode 不是 llm。
 *
 * ★ 这种情况下【只可能是】用户自己点了「改用规则再跑一遍」——
 *   别的入口要么走大模型、要么探测压根不 ready。
 *   两处用它：横幅补一句「为什么没走」；按钮把字换成「用大模型重新跑一遍」。
 */
export function canSwitchToLlm(probe: BackendProbe | null, trace: AgentTrace): boolean {
  return probe?.kind === 'ready' && trace.mode !== 'llm'
}

/** 上面那个判断成立时，补一句「为什么没走」，并指路。 */
export const RUN_MODE_FORCED_SUFFIX =
  '★ 这一轮之所以没走大模型：是你自己点了「改用规则再跑一遍」——' +
  '那个按钮的意思就是「这一轮不要用大模型」。想走大模型，再点一次' +
  '「用大模型重新跑一遍」即可。'

/**
 * 顶部横幅。
 *
 * ★★★ 为什么要收一个 `trace`（2026-09-12 用户截图抓到的矛盾）★★★
 *
 *   在这之前它只收 `probe` ——「这一页能不能连上后端」。而它上面那段文案写的是
 *   「问题理解、写查询、写结论全部由 DeepSeek 完成」，读起来就是在说【这一轮】。
 *   于是 `probe = ready` + `trace.mode = 'rule'`（用户点了「改用规则再跑一遍」，
 *   这是个完全合法的组合）时，屏幕上出现：
 *
 *       上面：「全部由 DeepSeek（deepseek-flash）完成」
 *       下面第 1 步：「本地关键词规则 · 非大模型」
 *
 *   两句话隔十厘米互相打脸。真正该说的是「这一页接得上」+「这一轮走的是哪条」，
 *   两件事分开讲 —— 所以这里补一行走的路，措辞也一并改成「可以交给…做」。
 *
 *   ★ 这一行【只在 ready 那一态】出现：rule / static 那两段的整段文案本来就是
 *     在说「这一轮没走大模型」，再加一行是纯重复；而矛盾只会出现在 ready。
 *     本机有一条检查把「只在 ready 出现」也钉住了（它一次渲染三件东西：
 *     横幅 + 提问区 + 工作流，验的正是「同一屏上两句话不许打架」）。
 */
export function HonestyBanner({ probe, trace }: { probe: BackendProbe | null; trace: AgentTrace }) {
  const mode = bannerMode(probe)
  const copy = BANNER_TEXT[mode]({
    probe,
    viewRows: PY_RESULTS.manifest.rowCounts.video_views,
    modelRows: FOR_MODEL_ROWS,
  })

  /* ★ 后端接得上、这一轮却走的规则路径 —— 那只可能是用户自己点的「改用规则」。
     crashed 那一格排除掉：崩溃时 mode 可能还是初始占位值，那时候说「是你点的」是猜的。 */
  const forced = canSwitchToLlm(probe, trace) && runHasStarted(trace) && !trace.crashed

  return (
    <section className="rounded-xl border border-hairline bg-card px-5 py-4">
      <p className="text-[12.5px] leading-relaxed text-ink-2">
        <strong className="font-semibold text-ink">{copy.headline}</strong>
      </p>

      {mode === 'ready' && (
        <p className="mt-2 rounded-md bg-plane/60 px-3 py-2 text-[12.5px] leading-relaxed text-ink-2">
          <strong className="font-semibold text-ink">{MODE_LINE_LABEL}：</strong>
          {runModeLine(trace)}
          {forced ? ` ${RUN_MODE_FORCED_SUFFIX}` : ''}
        </p>
      )}

      {copy.paragraphs.map((t, i) => (
        <p key={i} className="mt-2 text-[12.5px] leading-relaxed text-ink-2">
          {t}
        </p>
      ))}
    </section>
  )
}

/* --------------------------------------------------------------------------
   二、底部「分析可信度」—— 这一次跑的是哪条路
   -------------------------------------------------------------------------- */

/**
 * 三种运行模式各一句。
 *
 * ★ 三句【互不为子串】—— 否则「另一种说法没有出现」这类反向断言会永远是绿的。
 *   （这个项目在那里栽过一次：两句共用了一句标题，于是那些反向断言全变成了废检查。）
 * ★ 加第四态不补这句是【编译错误】。
 */
export const MODE_LINE: Record<RunMode, string> = {
  llm: '这一次真的调用了外部大模型 —— 问题理解、写查询、写结论都是它做的，工具调用记录见第 4 步。',
  rule: '这一次没有联网：问题理解和结论文字来自本地关键词规则 + 模板，只有 SQL 是在浏览器里执行的。',
  static: '这一次是在本地文件（file://）下打开的，浏览器不允许它访问后端，因此界面走的是规则路径。',
}

/** 还没跑完（或者还没跑）时页脚要说的话。三态之外的第 4 种情形。 */
export const MODE_LINE_PENDING =
  '这一次分析还没有跑完，所以现在还说不准走的是哪一条路 —— 跑完会自动写在这里。'

/**
 * ★ 页面自己抛异常时（`trace.crashed`）页脚要说的话 —— 第 5 种情形。
 *
 * ★ 为什么不能沿用上面那句，也不能沿用 `MODE_LINE[trace.mode]`：
 *   · 沿用 PENDING 的话，它那句「跑完会自动写在这里」是句空话 ——
 *     这一轮已经断了，不会有「跑完」那一刻；
 *   · 沿用 MODE_LINE[mode] 则更糟：崩溃可能发生在【摆底子之前】
 *     （探测那一句就炸了），那时 mode 是初始占位值，
 *     照它说「这一次真的调用了外部大模型」或「这一次没有联网」都是猜的。
 *   崩溃这一格能确定的事只有一件：**没跑完**。所以只说这一件。
 */
export const MODE_LINE_CRASHED =
  '这一次没有跑完 —— 页面自己出错了（断在哪一步、原始报错是什么，' +
  '写在页面顶部那条横幅里）。所以这一行不写走的是哪条路。'

/**
 * ★ 崩溃时，下面两行也不许落进为正常轨迹写的分支里 —— 那些分支全都在
 *   断言一件当时【还不知道】的事：
 *
 *   · Python 那一行会走 `pyCalls.length === 0` → 说「模型这一次只用了 SQL」。
 *     而崩溃时 `trace.llm` 根本是空的（轨迹没拼完），
 *     「没用过 Python」和「还不知道用没用过」是两件事，前者是句假话。
 *   · 「理解问题的方式」那一行会说「调用记录在这一步下面」——
 *     而下面是空的，一条记录都没有。
 */
export const CRASHED_PY_TEXT = '本次没能跑完，所以 Python 到底用没用过、成没成，都无从判断。'
export const CRASHED_RESOLVER_TEXT = '本次没能跑完，所以这一行不写结论 —— 原始报错见顶部横幅。'

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
      <dt className="w-28 shrink-0 text-[11.5px] text-ink-3">{label}</dt>
      <dd className="text-[11.5px] leading-relaxed text-ink-2">{children}</dd>
    </div>
  )
}

/**
 * ★ 这个 `busy` 是刻意【不用 probe】代替它，才单独传进来的。
 *
 *   「这一次跑的是哪条路」只有在真跑过之后才说得准。可用的判据只有两个：
 *     · trace.data !== null / trace.aborted  → 跑完了（成功或有中止记录）
 *     · busy === true                        → 正在跑
 *   两者都不成立时（首屏那一帧、或者自动跑被闸门拦住），才说「还没跑完」。
 *
 *   ⚠️ 为什么不用「probe 探到了没有」当判据：探到 ready、但用户点了
 *   「改用规则再跑一遍」是一个完全合法的组合，用 probe 判断会把这一次
 *   真的走的规则路径说成大模型路径。**页脚说的是「这一次」，横幅说的是
 *   「这一页能不能连」—— 两件事，两个判据。**
 */
export function TrustFooter({ trace, busy }: { trace: AgentTrace; busy: boolean }) {
  const py = PY_RESULTS.manifest
  const engineText =
    trace.engineMode === 'worker'
      ? '后台线程（Web Worker）'
      : trace.engineMode === 'main'
        ? '主线程（这个浏览器不允许开后台线程时走这条，功能一样，只是查询时会短暂卡顿）'
        : '本次没有启动数据库'

  /* ★ 这一行由 runModeLine() 统一算 —— 顶部横幅说的就是同一句话，
     两处共用一份实现，不可能不一致。判断的细节（谁是第一判据）写在那个函数上。 */
  const modeText = runModeLine(trace)

  /* Python 那一行必须按【这一次实际发生了什么】写。
     LLM 模式下 Python 是本机真起的进程，不是离线跑好的结果 ——
     照抄规则路径那句话就是把这一页最想证明的事说反了。 */
  const pyCalls = (trace.llm?.toolCalls ?? []).filter((c) => c.name === 'python_analysis')
  const pyOk = pyCalls.filter((c) => c.ok).length
  const pyText = trace.crashed
    ? CRASHED_PY_TEXT
    : trace.mode !== 'llm'
      ? `离线真跑（Python ${py.pythonVersion} / pandas ${py.pandasVersion}），` +
        '不是在这个页面里执行的。'
      : pyCalls.length === 0
        ? '本次没有用到 Python 工具 —— 模型这一次只用了 SQL。'
        : pyOk === 0
          ? `模型要求用过 ${pyCalls.length} 次 Python，但本机那几次都没跑起来（原因在第 4 步）。`
          : `本机真起 Python 进程算过 ${pyOk} 次（这是这台机器上真的跑起来的一个进程，` +
            '不是读离线结果）。'

  /* ★ 「理解问题的方式」这一行以前是【无条件】显示 ruleBasedResolver.name 的，
     而那个名字里写着「未接入大模型」。大模型模式下照旧显示就是一句假话 ——
     而且是一句把整页可信度都带歪的假话，因为它就在「可信度」那一步里。 */
  const resolverText = trace.crashed
    ? CRASHED_RESOLVER_TEXT
    : trace.mode === 'llm'
      ? trace.llm
        ? `外部大模型（${trace.llm.providerLabel} / ${trace.llm.model}）自己理解问题、` +
          '自己决定查什么 —— 本页的本地关键词规则这一次没有参与。'
        : '外部大模型（本次的调用记录在这一步下面）。'
      : `${ruleBasedResolver.name}。规则匹配不上时会退回通用概览，并明确说明没有匹配上。`

  /* ★ 这里刻意不再套一层边框卡片：它是被放进「第 7 步」那张卡里的，
     再套一层就成了卡中卡。内容自己负责，外框交给调用方。 */
  return (
    <div className="rounded-lg border border-hairline bg-plane/40 px-4 py-3.5">
      <dl className="flex flex-col gap-2">
        <Line label={MODE_LINE_LABEL}>{modeText}</Line>

        <Line label="数据来源">
          模拟业务数据，与哔哩哔哩的经营数据无关。由固定随机种子
          （SEED = {DATASET_META.seed}）程序生成，共 {DATASET_META.days} 天，
          截止 {DATASET_META.endDate}。
        </Line>

        <Line label="分析工具">
          SQL —— 浏览器里的真 SQLite（sql.js / WebAssembly），本次执行环境：{engineText}。
          <br />
          Python / Pandas —— {pyText}
        </Line>

        <Line label="理解问题的方式">{resolverText}</Line>

        <Line label="分析时间范围">
          本次窗口「近 {trace.plan.days} 天」＝ {trace.plan.startDate} ~ {trace.plan.endDate}，
          与首页、SQL 分析页用的是同一个函数算出来的同一个口径。
        </Line>

        <Line label="这次问了什么">
          「{trace.plan.question}」
        </Line>
      </dl>

      <p className="mt-3 border-t border-hairline pt-2.5 text-[11.5px] leading-relaxed text-ink-3">
        AI 结论基于当前数据，仅用于分析演示。
      </p>
    </div>
  )
}
