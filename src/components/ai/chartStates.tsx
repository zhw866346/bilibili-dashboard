/* ==========================================================================
   图表正文的两种「非正常」状态：还在等数据、以及拿不到数据
   --------------------------------------------------------------------------
   ★ 为什么这件事必须做，而且必须说清楚：
     第 5 步的图表卡片以前在这两种情况下是【一片空白】—— 只剩标题和底部的
     「解读」文字，正文什么都没有，也一句话都不解释。
     读者看到的是一个坏掉的卡片，而不是「这张图这次没画出来」。

     这个页面在别处反复强调「哪一步是真的执行了」，偏偏在最容易出问题的
     这两处沉默，这是自相矛盾的。空白是最含糊的一种表达方式。

   ★ 为什么加载态和空态是两个组件、而不是一个「加载失败」：
     两者的含义完全不同。加载态 = 再等几秒图就出来了；
     空态 = 这次真的没有数据，而且原因分好几种（没跑这条查询 / 跑了但报错 /
     跑了但一行没返回）。合成一句话就是在含糊，而含糊正是这一页最该避免的。
   ========================================================================== */

import type { BuildProgress } from '../../data/sql/engine'
import type { SqlOutcome } from '../../data/ai/types'

/**
 * 加载态那句话的开头。
 *
 * ★ 单独导出成常量，是为了让命令行脚本能拿它去数「每张图是不是都有占位」——
 *   漏一张不报错，只会让那一格空着，所以必须能数。
 */
export const CHART_LOADING_MARK = '这张图正在等数据'

/* --------------------------------------------------------------------------
   一、还在等数据
   -------------------------------------------------------------------------- */

/**
 * 第 4 步还在建库 / 执行 SQL 时，图的位置显示这个。
 *
 * ★ 文案里的阶段名来自【真实的建库进度】，不编。
 *   进度为空时必须有兜底 —— 否则 `undefined` 会直接渲染到页面上。
 */
export function ChartLoading({ progress }: { progress: BuildProgress | null }) {
  const label = progress
    ? `${progress.label}${progress.total > 0 ? ` —— ${progress.done} / ${progress.total}` : ''}`
    : '正在准备数据库'

  return (
    <div className="flex min-h-[132px] flex-col items-center justify-center rounded-lg border border-dashed border-hairline bg-plane/30 px-4 py-6 text-center">
      <p className="text-[12px] leading-relaxed text-ink-2">
        {CHART_LOADING_MARK} —— 第 4 步要先在你的浏览器里真跑一次 SQL。
      </p>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-3">
        {label}。建库要几秒钟，跑完这张图会自己出现，不需要再点一次。
      </p>
    </div>
  )
}

/* --------------------------------------------------------------------------
   二、这次拿不到数据
   -------------------------------------------------------------------------- */

/**
 * 把「没有结果」翻译成人话。
 *
 * ★ 三种「没结果」的含义完全不同，必须分开说：
 *   没跑过这条查询 / 跑了但报错 / 跑了但一行没返回。
 *   写成一句「加载失败」就等于把三种情况混成一种，读者没法判断该不该信后面的结论。
 */
export function outcomeReason(o: SqlOutcome | undefined): string {
  if (!o) return '这一次分析没有跑这条查询。'
  if (o.status === 'error') return `这条查询没有执行成功：${o.error ?? '未记录原因'}。`
  if (o.status !== 'done') return '这条查询这一次没有执行完。'
  return '这条查询执行了，但返回 0 行 —— 这一档人在这段时间里没有可用的数据。'
}

/**
 * 第四种情况：数据取到了、查询也没报错，但画这张图要用的那几行是空的。
 *
 * ★ 和上面三种分开是有意义的：「查询没跑成」要去查第 4 步，
 *   「查询跑成了但这一档人没有数据」则是数据本身的事实，两者该做的事不一样。
 */
export const EMPTY_SERIES_REASON = '数据取到了，但画这张图要用的那几行是空的。'

/** 拿不到结果时卡片正文里显示的那块。 */
export function ChartEmpty({ hint, reason }: { hint: string; reason: string }) {
  return (
    <div className="rounded-lg border border-dashed border-hairline bg-plane/40 px-4 py-6 text-center">
      <p className="text-[12px] leading-relaxed text-ink-2">{hint}</p>
      <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-ink-3">{reason}</p>
      <p className="mt-2.5 text-[11px] leading-relaxed text-ink-3">
        上面第 4 步的执行记录里有详细说明。结论、数据依据和业务洞察仍然照常给出 ——
        缺的是这一张图，不是把整次分析作废。
      </p>
    </div>
  )
}
