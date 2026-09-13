/* ==========================================================================
   SQL 引擎的「主线程接口」
   --------------------------------------------------------------------------
   页面上只跟这个文件打交道，不需要知道数据库跑在哪儿。

   两条路，自动选：
     ① Worker（正常情况）—— 建库和查询都在后台线程，界面完全不卡
     ② 主线程（兜底）    —— 万一浏览器不让开 Worker
        （典型场景：把 dist/index.html 直接双击打开，file:// 下会被拦），
        就退回主线程执行。慢一些、查询时会短暂卡顿，但功能完整、结果一样。

   为什么结果一样？因为两条路调的是同一个 engine.ts。
   这个文件只负责「选在哪跑」和「收发消息」。
   ========================================================================== */

import type { BuildProgress, DbStats, QueryResult } from './engine'
import type { WorkerRequest, WorkerResponse } from './worker'

export interface SqlEngineClient {
  stats: DbStats
  exec: (sql: string) => Promise<QueryResult>
  /** 引擎实际跑在哪儿。页面上会如实标出来，不含糊。 */
  mode: 'worker' | 'main'
}

export interface StartOptions {
  onProgress?: (p: BuildProgress) => void
}

/**
 * 把控制权还给浏览器一帧。
 * 主线程兜底那条路要靠它让进度条动起来、让页面能响应点击。
 */
const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export async function startSqlEngine(options: StartOptions = {}): Promise<SqlEngineClient> {
  const { onProgress } = options

  /* ---------- 先试 Worker ---------- */
  let worker: Worker | null = null
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  } catch {
    worker = null // file:// 等场景会在这里直接抛出来
  }

  if (worker) {
    const ready = await attachWorker(worker, onProgress)
    if (ready) return ready
    // 建库失败（比如 wasm 没加载起来）：把 Worker 关掉，走主线程兜底
    worker.terminate()
  }

  /* ---------- 兜底：主线程 ---------- */
  const { createEngine } = await import('./engine')
  const engine = await createEngine(async (p) => {
    onProgress?.(p)
    await yieldToBrowser()
  })

  return {
    stats: engine.stats,
    mode: 'main',
    exec: async (sql: string) => {
      // 先让浏览器画一帧「查询中…」，再去执行这条会卡住的查询
      await yieldToBrowser()
      return engine.run(sql)
    },
  }
}

/** 挂上 Worker，等它建好库。建库失败返回 null，交给调用方兜底。 */
function attachWorker(
  worker: Worker,
  onProgress?: (p: BuildProgress) => void,
): Promise<SqlEngineClient | null> {
  return new Promise((resolve) => {
    let stats: DbStats | null = null
    let settled = false
    let nextId = 0
    const pending = new Map<
      number,
      { ok: (r: QueryResult) => void; fail: (e: Error) => void }
    >()

    const failAll = (message: string) => {
      for (const p of pending.values()) p.fail(new Error(message))
      pending.clear()
    }

    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data

      switch (msg.type) {
        case 'progress':
          onProgress?.({
            phase: 'insert',
            label: msg.label,
            done: msg.done,
            total: msg.total,
          })
          break

        case 'ready':
          stats = msg.stats
          settled = true
          resolve({
            stats,
            mode: 'worker',
            exec: (sql: string) =>
              new Promise<QueryResult>((ok, fail) => {
                const id = ++nextId
                pending.set(id, { ok, fail })
                const req: WorkerRequest = { type: 'exec', id, sql }
                worker.postMessage(req)
              }),
          })
          break

        case 'init-error':
          settled = true
          failAll(msg.message)
          resolve(null)
          break

        case 'result': {
          const p = pending.get(msg.id)
          if (p) {
            pending.delete(msg.id)
            p.ok(msg.result)
          }
          break
        }

        case 'exec-error': {
          const p = pending.get(msg.id)
          if (p) {
            pending.delete(msg.id)
            p.fail(new Error(msg.message))
          }
          break
        }
      }
    })

    worker.addEventListener('error', () => {
      if (!settled) {
        settled = true
        resolve(null) // 脚本没加载起来，交给主线程兜底
      }
      failAll('后台线程出错了')
    })

    const req: WorkerRequest = { type: 'start' }
    worker.postMessage(req)
  })
}
