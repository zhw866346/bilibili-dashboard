/* ==========================================================================
   SQL Worker —— 让数据库在「后台线程」里跑
   --------------------------------------------------------------------------
   浏览器里，页面和它的脚本共用一个线程。SQLite 插入 56 万行、跑一条要扫
   30 万行的查询，都会把这个线程占满；占满期间页面点不动、滚不动。

   Worker 是浏览器给的另一个线程。把建库和查询都丢进去之后，
   主线程只管「把结果画出来」，所以：
     · 建库那几秒，页面照样能滚动、能点筛选
     · 查询的时候，别的卡片照样能显示内容

   这个文件本身很简单，只做一件事：收发消息。
   真正的活都在 engine.ts 里，主线程兜底时调的是同一个 engine.ts，
   所以两条路的计算结果一定一样。
   ========================================================================== */

import { createEngine } from './engine'
import type { DbStats, QueryResult } from './engine'

/** 主线程发过来的消息 */
export type WorkerRequest =
  | { type: 'start' }
  | { type: 'exec'; id: number; sql: string }

/** Worker 发回主线程的消息 */
export type WorkerResponse =
  | { type: 'progress'; done: number; total: number; label: string }
  | { type: 'ready'; stats: DbStats }
  | { type: 'init-error'; message: string }
  | { type: 'result'; id: number; result: QueryResult }
  | { type: 'exec-error'; id: number; message: string }

/* tsconfig 里配的 lib 是 DOM，self 被当成 window，postMessage 的签名对不上。
   这里把需要的那两个方法自己声明一遍，比引 webworker 整套 lib 干净
   （引了会和 DOM 打架）。 */
const ctx = self as unknown as {
  postMessage: (msg: WorkerResponse) => void
  addEventListener: (
    type: 'message',
    handler: (event: MessageEvent<WorkerRequest>) => void,
  ) => void
}

/** 建库的结果缓存在 Worker 这一侧，建一次就够 */
let engine: Awaited<ReturnType<typeof createEngine>> | null = null

const post = (msg: WorkerResponse) => ctx.postMessage(msg)

ctx.addEventListener('message', async (event) => {
  const msg = event.data

  if (msg.type === 'start') {
    if (engine) return
    try {
      engine = await createEngine((p) => {
        post({ type: 'progress', done: p.done, total: p.total, label: p.label })
      })
      post({ type: 'ready', stats: engine.stats })
    } catch (err) {
      post({ type: 'init-error', message: err instanceof Error ? err.message : String(err) })
    }
    return
  }

  if (msg.type === 'exec') {
    if (!engine) {
      post({ type: 'exec-error', id: msg.id, message: '数据库还没建好' })
      return
    }
    try {
      post({ type: 'result', id: msg.id, result: engine.run(msg.sql) })
    } catch (err) {
      post({ type: 'exec-error', id: msg.id, message: err instanceof Error ? err.message : String(err) })
    }
  }
})
