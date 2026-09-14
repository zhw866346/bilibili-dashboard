/* ==========================================================================
   AI 页专用的数据库引擎单例
   --------------------------------------------------------------------------
   ★ 为什么要单独包一层，而不是直接调 startSqlEngine？

     1. 建库要 3–5 秒（56 万行）。页面上重新问一次问题、或者切一次时间窗口，
        都不应该重建一次数据库。startSqlEngine() 本身没有缓存，
        每调一次就建一次库——所以这里必须自己缓存住那个 Promise。

     2. 失败要能优雅降级。引擎起不来的时候，页面不能白屏，
        得退成「不跑 SQL，只展示 SQL 文本和步骤」并如实说明原因。
        所以这里把异常统一吞成 null，错误信息单独记着。

   ★ 为什么不做成全局单例、让 SQL 分析页也共用？
     那要改 Stage 5 的页面，属于「改动已有功能」。本页自己缓存一份就够了，
     代价只是两个页面同时打开时会有两个数据库——而这是不可能的（路由是单页的）。
   ========================================================================== */

import { startSqlEngine, type SqlEngineClient } from '../sql/client'
import type { BuildProgress } from '../sql/engine'

type ProgressListener = (p: BuildProgress) => void

/** 所有正在等建库的订阅者。建库过程只跑一次，进度广播给所有人。 */
const listeners = new Set<ProgressListener>()

/** 建库那个 Promise 只创建一次，之后所有调用共享它 */
let enginePromise: Promise<SqlEngineClient | null> | null = null

/** 引擎起不来的原因。页面上要如实显示，不能只说一句「出错了」。 */
let engineError: string | null = null

/**
 * 建库的「第几代」。
 *
 * ★ 为什么需要它：resetSharedSqlEngine() 可以在建库途中被调用。那一代人
 *   （已经没人要了的那次）的 .catch 会在重置之后才跑完，然后把它的失败原因
 *   写回模块级的 engineError —— 于是新一次建库会带着一条陈旧的、张冠李戴的原因。
 *   带上代号，旧那次的回写就会被丢掉。
 */
let generation = 0

/**
 * 拿到那个共享的数据库。第一次调用会触发建库（3–5 秒），之后立即返回。
 *
 * @param onProgress 建库进度回调。只在建库真正进行时才会收到消息；
 *                   如果调用时库已经建好了，不会收到任何回调（页面应直接当作就绪）。
 * @returns 引擎客户端；起不来时返回 null（调用方必须处理这种情况）
 */
export function getSharedSqlEngine(
  onProgress?: (p: BuildProgress) => void,
): Promise<SqlEngineClient | null> {
  if (onProgress) listeners.add(onProgress)

  if (!enginePromise) {
    const g = generation

    enginePromise = startSqlEngine({
      onProgress: (p) => {
        for (const l of listeners) l(p)
      },
    })
      .then((client) => {
        listeners.clear()
        return client
      })
      .catch((e: unknown) => {
        listeners.clear()
        /* 旧那一代的失败不许回写 —— 它记的是上一个数据库的事 */
        if (g === generation) {
          engineError = e instanceof Error ? e.message : String(e)
        }
        return null
      })
  }

  return enginePromise
}

/** 引擎起不来的原因；没出错就是 null。 */
export function getEngineError(): string | null {
  return engineError
}

/**
 * 把缓存的数据库结果扔掉，下次 getSharedSqlEngine() 会重新建库。
 *
 * ★ 这是「重试」按钮能不能真正管用的关键。enginePromise 里存的是那个
 *   **已经 resolve 成 null** 的失败结果 —— 不先清掉它，再调一次 getSharedSqlEngine()
 *   会立刻拿到同一个 null，界面看起来毫无反应，按钮就成了摆设。
 *   （那种「点了没反应」的故障最难查，因为它不报错。）
 *
 * ★ 只在页面的「重试一次」按钮里调它。不要每次分析都调 ——
 *   那会让每一次提问都重新建库 3–5 秒。
 */
export function resetSharedSqlEngine(): void {
  generation += 1
  enginePromise = null
  engineError = null
}

/**
 * 数据库起不来时，第 4 步卡片上要写的那段说明。
 *
 * ★ 单独抽成纯函数（而不是写死在 runner 里），是为了让页面文案
 *   能被命令行脚本逐字断言 —— 引擎原话有没有真的带到页面上，
 *   是这一页诚实性的一个具体落点。
 */
export function engineFailureNote(reason: string | null): string {
  const why = reason
    ? `失败原因是：${reason}。`
    : '这次没有记到具体原因，通常是浏览器不支持 WebAssembly，或者内存不足。'
  return `下面是准备好的 SQL 原文，但结果列会是空的。${why}`
}

/** 把查询结果从「列名 + 二维数组」转成一行一个对象，方便表格和模板取用。 */
export function toRows(result: {
  columns: string[]
  rows: (string | number | null)[][]
}): Record<string, string | number | null>[] {
  return result.rows.map((row) => {
    const obj: Record<string, string | number | null> = {}
    result.columns.forEach((col, i) => {
      obj[col] = row[i] ?? null
    })
    return obj
  })
}
