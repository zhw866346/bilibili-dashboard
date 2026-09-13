/* ==========================================================================
   SQL 引擎 —— 把项目里的模拟明细，装进一个真正的 SQLite 数据库
   --------------------------------------------------------------------------
   这个文件干的事：把 dataset.ts 造出来的四张表（users / creators / videos /
   video_views），一行一行插进一个跑在浏览器里的 SQLite（sql.js）。

   插入完成之后，页面上展示的每一条 SQL 都是**真的在这个数据库上执行**的，
   不是把结果写好放在那里。执行耗时也是真的量出来的。

   ★ 为什么这件事要放在 Worker（后台线程）里做？
     实测过：插入 56.6 万行要 ~2.1 秒，建索引 ~1.3 秒，八条查询合计 ~3.6 秒。
     如果放在主线程，整个页面会卡死七秒——鼠标点不动、滚动不了。
     放进 Worker 之后，主线程完全不受影响，结果一条一条回填到卡片上。
     （万一浏览器不允许开 Worker，client.ts 里有兜底：退回主线程执行。）

   ★ 为什么用「多行 VALUES 批量插入」而不是一行一条 INSERT？
     一行一条要调 56 万次 SQL 解析器。改成每 500 行拼成一条
     INSERT ... VALUES (...),(...),(...) 之后，解析次数降到 1132 次，
     插入时间从几十秒降到 2 秒左右。这是导入数据时最常见的一个优化。
   ========================================================================== */

import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

import { buildDataset } from '../dataset'

/* sql.js 的类型是 `export = 函数` 的形式，解构不出 Database / SqlJsStatic 这两个名字，
   所以这里从函数签名上把它们「推」出来。效果等价，还省得引 @types。 */
type SqlJsStatic = Awaited<ReturnType<typeof initSqlJs>>
type SqlDatabase = InstanceType<SqlJsStatic['Database']>

/** 建库过程中回调出去的进度，用来画进度条 */
export interface BuildProgress {
  /** 当前阶段 */
  phase: 'wasm' | 'schema' | 'insert' | 'index' | 'done'
  /** 说人话的阶段说明 */
  label: string
  /** 已完成 / 总数（insert 阶段才有意义） */
  done: number
  total: number
}

/** 建库完成后的统计，页面顶部会展示，证明「真的装进去了」 */
export interface DbStats {
  buildMs: number
  users: number
  creators: number
  videos: number
  videoViews: number
  /** 装了几天数据 */
  days: number
  /** 数据库里四张表的建表语句，页面上「数据表结构」那块直接读它 */
  schema: string[]
}

/** 一条查询的执行结果 */
export interface QueryResult {
  columns: string[]
  rows: (string | number | null)[][]
  /** 这条 SQL 在 SQLite 里实际跑了多少毫秒 */
  ms: number
}

export interface SqlEngine {
  stats: DbStats
  run: (sql: string) => QueryResult
}

/* 建表语句放在 schema.ts 里。那边不依赖 sql.js，
   页面可以单独读它来展示表结构，不会把数据库引擎一起加载进来。 */
import { SCHEMA_SQL } from './schema'

export { SCHEMA_SQL }

/* 索引。没有索引的话，每条带 WHERE date >= ... 的查询都要全表扫 56 万行。 */
const INDEX_SQL = [
  'CREATE INDEX idx_views_date       ON video_views(date)',
  'CREATE INDEX idx_views_date_video ON video_views(date, video_id)',
  'CREATE INDEX idx_views_date_user  ON video_views(date, user_id)',
  'CREATE INDEX idx_videos_category  ON videos(category)',
]

/** 每条 INSERT 塞多少行。500 行 × 8 列 = 4000 个字面量，SQLite 完全吃得下。 */
const INSERT_CHUNK = 500

/** 把 JS 值转成 SQL 字面量。数据是本地造的，但引号该转义还是要转义。 */
function lit(v: string | number | boolean): string {
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? '1' : '0'
  return `'${v.replace(/'/g, "''")}'`
}

/** 每满多少行往上报一次进度。太小会拖慢插入，太大进度条不动。 */
const PROGRESS_EVERY = 20

/**
 * 建库。
 *
 * onProgress 可以返回 Promise —— 主线程兜底那条路靠它把控制权还给浏览器，
 * 免得插入过程把界面卡死；在 Worker 里则不需要，直接返回 undefined 就行。
 */
export async function createEngine(
  onProgress?: (p: BuildProgress) => void | Promise<void>,
): Promise<SqlEngine> {
  const t0 = performance.now()

  await onProgress?.({ phase: 'wasm', label: '正在加载 SQLite 引擎', done: 0, total: 0 })
  const SQL = await initSqlJs({ locateFile: () => wasmUrl })

  await onProgress?.({ phase: 'schema', label: '正在建表', done: 0, total: 0 })
  const db = new SQL.Database()
  db.run('PRAGMA temp_store = MEMORY')
  db.run('PRAGMA cache_size = -64000')
  for (const sql of SCHEMA_SQL) db.run(sql)

  // 造明细。注意这里调的是 buildDataset() 而不是 getDataset()：
  // getDataset() 会把结果缓存在模块作用域里，插完就释放不掉；
  // 用 buildDataset() 拿到的是局部变量，函数返回后就可以被回收。
  const dataset = buildDataset()

  const viewRows = dataset.views.length
  const totalRows = viewRows + dataset.users.length + dataset.videos.length + dataset.creators.length
  let doneRows = 0

  const insertMany = async (table: string, cols: string[], rows: string[][]) => {
    const colList = cols.join(', ')
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const values = rows
        .slice(i, i + INSERT_CHUNK)
        .map((r) => `(${r.join(',')})`)
        .join(',')
      db.run(`INSERT INTO ${table} (${colList}) VALUES ${values}`)
      doneRows += Math.min(INSERT_CHUNK, rows.length - i)

      // 每插入一小批就汇报一次进度，顺手把控制权还给浏览器
      if ((i / INSERT_CHUNK) % PROGRESS_EVERY === 0) {
        await onProgress?.({
          phase: 'insert',
          label: `正在写入数据表 ${table}`,
          done: doneRows,
          total: totalRows,
        })
      }
    }
  }

  await insertMany(
    'users',
    ['user_id', 'age', 'gender', 'city', 'register_date', 'user_level'],
    dataset.users.map((u) => [lit(u.user_id), lit(u.age), lit(u.gender), lit(u.city), lit(u.register_date), lit(u.user_level)]),
  )

  await insertMany(
    'creators',
    ['up_id', 'creator_type', 'followers'],
    dataset.creators.map((c) => [lit(c.up_id), lit(c.creator_type), lit(c.followers)]),
  )

  await insertMany(
    'videos',
    ['video_id', 'up_id', 'category', 'publish_date', 'duration'],
    dataset.videos.map((v) => [lit(v.video_id), lit(v.up_id), lit(v.category), lit(v.publish_date), lit(v.duration)]),
  )

  await insertMany(
    'video_views',
    ['user_id', 'video_id', 'date', 'watch_seconds', 'is_like', 'is_favorite', 'is_comment', 'is_share'],
    dataset.views.map((v) => [
      lit(v.user_id),
      lit(v.video_id),
      lit(v.date),
      lit(v.watch_seconds),
      lit(v.is_like),
      lit(v.is_favorite),
      lit(v.is_comment),
      lit(v.is_share),
    ]),
  )

  await onProgress?.({ phase: 'index', label: '正在建索引', done: totalRows, total: totalRows })
  for (const sql of INDEX_SQL) db.run(sql)

  const buildMs = performance.now() - t0
  await onProgress?.({ phase: 'done', label: '数据库就绪', done: totalRows, total: totalRows })

  const stats: DbStats = {
    buildMs,
    users: dataset.users.length,
    creators: dataset.creators.length,
    videos: dataset.videos.length,
    videoViews: viewRows,
    days: dataset.dates.length,
    schema: SCHEMA_SQL,
  }

  /* 主线程兜底那条路上，这份 dataset 还留在闭包里。
     显式把它清空，让 56 万个对象能尽快被回收。 */
  dataset.users.length = 0
  dataset.videos.length = 0
  dataset.creators.length = 0
  dataset.views.length = 0
  dataset.dates.length = 0

  return {
    stats,
    run: (sql: string) => runQuery(db, sql),
  }
}

/** 执行一条查询，把 sql.js 的返回转成好用的形状，并量出耗时。 */
function runQuery(db: SqlDatabase, sql: string): QueryResult {
  const t = performance.now()
  const res = db.exec(sql)
  const ms = performance.now() - t

  // 查询没有结果集（例如只有注释）时 exec 返回空数组
  const first = res[0]
  if (!first) return { columns: [], rows: [], ms }

  return {
    columns: first.columns,
    rows: first.values as (string | number | null)[][],
    ms,
  }
}

/* 年龄段在 SQL 里怎么写（CASE WHEN 那一段），现在由 cases.ts 统一负责，
   因为它属于「案例定义」而不是「数据库引擎」。放一起能保证八条 SQL 里
   出现 CASE WHEN 的地方写法完全一致。 */
