/* ==========================================================================
   两个工具的本机执行
   --------------------------------------------------------------------------
   ★ 这个文件是「模型说要干什么」和「本机真去干」之间的那道闸门。
     模型给过来的一切都是【不可信输入】—— 它可能写出删表的 SQL、
     引用一个不存在的结果、给出不合法的 JSON。这里逐条守住。

   ★ 三条不可动摇的边界：
     1. SQL 必须过 guardSql 才能碰数据库（见 sqlGuard.ts 里那段为什么）。
     2. Python 侧【绝不执行模型写的代码】—— 模型只能在 5 个闭集任务里选一个
        再指定列名。这是本机进程，允许模型写代码 = 把整台机器交出去。
     3. 工具执行出错【不抛异常】。错误被包成一条 ok=false 的记录回给模型，
        它据此自我修正 —— 这是设计的一部分，不是异常路径。

   ★ 为什么要压缩发给模型的结果（不是优化，是正确性问题）：
     一条 500 行的查询塞进上下文会让每次请求涨到几十 KB，
     而模型真正需要的是「列名 + 前几行长什么样 + 一共多少行」。
     所以发给模型的是前 50 行，完整结果显示在页面上，并且卡片上明写这一句。
   ========================================================================== */

import type { Column } from '../../../components/DataTable'
/* ★ 只是类型：编译后不存在这条 import，不会把整个组件拖进数据层。 */
import type { CodeLanguage } from '../../../components/CodeBlock'
import type { SqlExecutor, SqlQuerySpec } from '../types'
import { toRows } from '../engine'
import { formatMs } from '../../../utils/format'
import type { PyResponse } from './client'
import {
  FORBIDDEN_KEYWORD_REJECTED_NOTE,
  guardSql,
  ROW_CAP,
  wrapWithRowCap,
} from './sqlGuard'
/* 五个闭集任务的清单只有一份（在 prompt.ts 里，因为工具的 JSON Schema 要用它渲染 enum）。
   在这里再写一遍就等于有了两个真相来源：加了第六个任务而忘了改这里，
   表现是「模型调得动、校验拦得住」，谁也不知道为什么。 */
import { PY_TASKS, type PyTask } from './prompt'
import type { ToolCallRecord, ToolName, ToolResult } from './types'

/** 发给模型的行数上限。完整结果（最多 500 行）照常显示在页面上。 */
export const FOR_MODEL_ROWS = 50

/**
 * SQL 的超时。
 * ★ 说清楚一件事：sql.js 没法中断一条正在跑的查询。
 *   超时之后我们只是【不再等它】，那个查询还在数据库线程里跑着。
 *   所以文案必须写「已放弃等待」，不能写「已取消」。
 */
export const SQL_TIMEOUT_MS = 20_000

/** 调本机 Python 的方式。做成可注入的，脚本才能不联网、不起进程地跑整套循环。 */
export type PyCaller = (req: {
  task: string
  rows: Record<string, unknown>[]
  params: Record<string, unknown>
}) => Promise<PyResponse>

export interface ToolContext {
  /** 数据库。null = 没起来（降级），SQL 工具会如实报错。 */
  exec: SqlExecutor | null
  py: PyCaller
  /** 之前已经跑过的工具调用。Python 工具靠它找到要分析的那份数据。 */
  previous: ToolCallRecord[]
}

/* ---------------------------------------------------------------------------
   一、参数解析
   --------------------------------------------------------------------------- */

/**
 * 模型给的参数是 JSON 字符串。
 * ★ 它偶尔会吐出不合法的 JSON —— 那不是异常，是正常分支，要如实回一条
 *   「你的参数不是合法 JSON」，让它再来一次。
 */
export function parseArgs(argsRaw: string): Record<string, unknown> | null {
  if (typeof argsRaw !== 'string') return null
  try {
    const v = JSON.parse(argsRaw)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/* ---------------------------------------------------------------------------
   二、执行一次工具调用
   --------------------------------------------------------------------------- */

export async function executeToolCall(
  index: number,
  name: string,
  argsRaw: string,
  ctx: ToolContext,
): Promise<ToolCallRecord> {
  const t0 = Date.now()
  const base: ToolCallRecord = {
    index,
    name: (name as ToolName) ?? 'sql_query',
    argsRaw,
    args: null,
    ok: false,
    forModel: null,
    full: null,
    ms: 0,
  }

  const fail = (code: string, message: string, detail?: string): ToolCallRecord => ({
    ...base,
    error: { code, message, detail },
    ms: Date.now() - t0,
  })

  if (name !== 'sql_query' && name !== 'python_analysis') {
    return fail(
      'UNKNOWN_TOOL',
      `没有「${name}」这个工具。你只能用 sql_query（取数）和 python_analysis（算数）。`,
    )
  }

  const args = parseArgs(argsRaw)
  if (!args) {
    return fail(
      'BAD_ARGS',
      '你给的参数不是合法的 JSON 对象。请重新调用一次，参数必须是这样的 JSON：' +
        (name === 'sql_query'
          ? '{"sql": "SELECT ..."}'
          : '{"task": "pct_change", "source": 1, "params": {...}}'),
    )
  }
  base.args = args

  return name === 'sql_query'
    ? runSqlTool(base, args, ctx, t0)
    : runPythonTool(base, args, ctx, t0)
}

/* ---------------------------------------------------------------------------
   三、SQL 工具
   --------------------------------------------------------------------------- */

async function runSqlTool(
  base: ToolCallRecord,
  args: Record<string, unknown>,
  ctx: ToolContext,
  t0: number,
): Promise<ToolCallRecord> {
  const raw = args.sql

  /* ---- 第一道闸：安全校验 ---- */
  const guarded = guardSql(raw)
  if (!guarded.ok) {
    return {
      ...base,
      error: {
        code: guarded.code,
        // ★ 这句理由要原样回给模型，它据此改写。所以必须说清「哪里不对、该怎么改」，
        //   不能只说一句「被拒绝了」。
        message: `${guarded.message}\n\n${FORBIDDEN_KEYWORD_REJECTED_NOTE}`,
        detail: guarded.detail,
      },
      ms: Date.now() - t0,
    }
  }

  if (!ctx.exec) {
    return {
      ...base,
      error: {
        code: 'NO_ENGINE',
        message:
          '本机的数据库没有启动起来，这条路走不通。请改用别的方式回答，' +
          '并在结论里如实说明「本次没有真的执行 SQL」。',
      },
      ms: Date.now() - t0,
    }
  }

  /* ---- 第二道闸：套行数上限，然后真跑 ---- */
  let result: { columns: string[]; rows: (string | number | null)[][]; ms: number }
  try {
    result = await withTimeout(ctx.exec.exec(wrapWithRowCap(guarded.sql)), SQL_TIMEOUT_MS)
  } catch (e) {
    const timedOut = e instanceof ToolTimeout
    return {
      ...base,
      error: {
        code: timedOut ? 'SQL_TIMEOUT' : 'SQL_FAILED',
        message: timedOut
          ? `这条查询超过 ${SQL_TIMEOUT_MS / 1000} 秒还没跑完，本机已经放弃等待（注意：sql.js 没法中断正在跑的查询，它还在后台跑着）。请写一条更快、更聚合的查询。`
          : `数据库报错了：${e instanceof Error ? e.message : String(e)}。请检查列名和语法后重试。`,
      },
      ms: Date.now() - t0,
    }
  }

  const all = toRows(result)
  const truncated = all.length > ROW_CAP
  const rows = truncated ? all.slice(0, ROW_CAP) : all

  const full: ToolResult = { columns: result.columns, rows, rowCount: rows.length, truncated }
  const head = rows.slice(0, FOR_MODEL_ROWS)

  return {
    ...base,
    ok: true,
    full,
    forModel: {
      callIndex: base.index,
      columns: result.columns,
      rows: head,
      totalRows: rows.length,
      truncated,
      note:
        `这是第 ${base.index} 次工具调用（给 Python 工具引用时填 source: ${base.index}）。` +
        (truncated
          ? `结果超过 ${ROW_CAP} 行，只取前 ${ROW_CAP} 行。`
          : '') +
        (rows.length > FOR_MODEL_ROWS
          ? `发给你的只有前 ${FOR_MODEL_ROWS} 行（一共 ${rows.length} 行），完整的表显示在页面上。`
          : ''),
    },
    ms: Date.now() - t0,
  }
}

class ToolTimeout extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ToolTimeout('timeout')), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/* ---------------------------------------------------------------------------
   四、Python 工具
   --------------------------------------------------------------------------- */

/**
 * ★ 把 Python 侧的失败分成两类，因为模型要做的事完全相反。
 *
 *   改这条之前请先读 client.ts 里 postPy 那段注释：
 *   修好之前，下面这张表里的每一个码都会被塌缩成同一个 PY_UNREACHABLE
 *   「本机的 Python 工具连不上，请只用 SQL」——
 *   连「列名写错了」都被说成「连不上」。分类的前提是 postPy 不再抛异常。
 *
 *   环境类（env）：本机这边的问题。模型改参数【一点用都没有】，
 *                  正确的动作是放弃 Python、改用 SQL，并如实说出来。
 *   参数类（arg）：模型自己写得不对。Python 已经把「现有列是：……」给它了，
 *                  正确的动作是照着改一次再试。
 *
 *   ★ 两个码集都写成常量并导出：本机的检查要逐个码验分类，
 *     而不是只验「某一条错误文案里含某句话」—— 后者漏掉一个码也不会红。
 */
export const PY_ENV_CODES = new Set([
  /* ---- pyRunner.mjs：进程本身起不来 / 跑不完 ---- */
  'PY_UNAVAILABLE', // 这台机器上没找到能用的 Python
  'SPAWN_FAILED', // 找到了但起不了进程
  'PY_TIMEOUT', // 20 秒没算完，已经被杀掉
  'PY_OUTPUT_TOO_LARGE', // 输出超过 256KB
  'PY_BAD_OUTPUT', // Python 崩在了解析结果之前，stdout 不是 JSON
  /* ---- index.mjs：还没进到 Python 就被挡了 ---- */
  'BODY_TOO_LARGE', // 这一批数据太大，超过 256KB 请求体上限
  'RATE_LIMIT', // 一分钟超过 30 次
  'INTERNAL', // 后端自己的 bug
  'BAD_INPUT', // 我们发过去的 JSON 不合法（我们的 bug）
  /* ---- client.ts 的网络层：后端根本没起来 ---- */
  'NETWORK_FAILED',
  'NETWORK_TIMEOUT',
  'BAD_JSON', // 响应不是合法 JSON
  /* ---- analysis_tool.py 的兜底：我们的 bug 或 pandas 的边界 ---- */
  'PY_FAILED',
])

export const PY_ARG_CODES = new Set([
  /* ---- analysis_tool.py：全是「模型写得不对」---- */
  'MISSING_PARAM', // 必填参数没给
  'NO_SUCH_COLUMN', // 列名不存在（句子里带着现有列名）
  'BAD_PARAM', // 参数值不合法（order / top_n / bins …）
  'NOT_ENOUGH_POINTS', // 有效数值不足 2 个，算不出趋势
  'NO_DATA', // 整列都不是数值
  'EMPTY_INPUT', // 上游查询返回 0 行
  'TASK_NOT_ALLOWED', // 任务名不在闭集里（tools.ts 已前置拦一道，这里是兜底）
])

/** 环境类的指引。抽成常量，页面照抄、脚本逐字断言。 */
export const PY_ENV_GUIDANCE =
  '★ 这是本机环境的问题，不是你参数写错了 —— 改参数没有用。' +
  '请改用 sql_query 完成这一步，并在结论里如实说明「这一次没能用 Python 算」。'

/** 参数类的指引。 */
export const PY_ARG_GUIDANCE =
  '★ 这是你给的参数不对，不是环境问题。上面那句话里已经列出了正确的列名，' +
  '请照着改一次再调用。'

/**
 * 这个错误码属于哪一类。
 * ★ 认不出来的码按【环境类】处理：宁可让模型早一点改用 SQL，
 *   也不要让它拿着一个我们没见过的错误反复重试、白花四次调用额度。
 */
export function classifyPyError(code: string): 'env' | 'arg' {
  if (PY_ARG_CODES.has(code)) return 'arg'
  return 'env'
}

async function runPythonTool(
  base: ToolCallRecord,
  args: Record<string, unknown>,
  ctx: ToolContext,
  t0: number,
): Promise<ToolCallRecord> {
  const task = String(args.task ?? '')
  if (!(PY_TASKS as readonly string[]).includes(task)) {
    return {
      ...base,
      error: {
        code: 'TASK_NOT_ALLOWED',
        message: `没有「${task}」这个任务。只能选这五个：${PY_TASKS.join('、')}。`,
      },
      ms: Date.now() - t0,
    }
  }

  /* ---- 只能引用已经跑过的查询结果，不许自己写数据进来 ---- */
  const source = Number(args.source)
  const ref = Number.isFinite(source) ? ctx.previous.find((r) => r.index === source) : undefined
  if (!ref) {
    const available = ctx.previous
      .filter((r) => r.ok && r.name === 'sql_query')
      .map((r) => r.index)
    return {
      ...base,
      error: {
        code: 'NO_SUCH_SOURCE',
        message: available.length
          ? `引用的第 ${args.source} 次调用不存在。目前能引用的 sql_query 结果是：${available.join('、')}。`
          : '你还没有成功跑过任何 sql_query，所以没有数据可以分析。请先用 sql_query 查一次。',
      },
      ms: Date.now() - t0,
    }
  }
  if (ref.name !== 'sql_query') {
    return {
      ...base,
      error: {
        code: 'WRONG_SOURCE',
        message: `第 ${ref.index} 次调用是 ${ref.name}，不是 sql_query，里面没有原始数据。请引用某一次 sql_query 的结果。`,
      },
      ms: Date.now() - t0,
    }
  }
  if (!ref.ok || !ref.full) {
    return {
      ...base,
      error: {
        code: 'SOURCE_FAILED',
        message: `第 ${ref.index} 次 sql_query 本身就没跑成功，所以没有数据可以分析。请先把它改对。`,
      },
      ms: Date.now() - t0,
    }
  }
  if (ref.full.rows.length === 0) {
    return {
      ...base,
      error: {
        code: 'EMPTY_INPUT',
        message: `第 ${ref.index} 次 sql_query 返回了 0 行，这一步算不了。请先确认上一步的查询条件。`,
      },
      ms: Date.now() - t0,
    }
  }

  const params =
    args.params && typeof args.params === 'object' && !Array.isArray(args.params)
      ? (args.params as Record<string, unknown>)
      : {}

  /* ---- 真起一个 Python 进程 ---- */
  let res: PyResponse
  try {
    res = await ctx.py({
      task: task as PyTask,
      rows: ref.full.rows as unknown as Record<string, unknown>[],
      params,
    })
  } catch (e) {
    /* ★ 这一条现在【几乎走不到】了：postPy 自己兜住了 BackendError，
         所有后端给的错误码都会从上面那个 if 分支走、并且被分类。
         留着它是为了一个真实的可能：注入进来的 callPy 自己抛了（脚本里的假调用方、
         或者将来换了别家实现）。此时「连不上」是唯一诚实能说的话。 */
    return {
      ...base,
      error: {
        code: 'PY_UNREACHABLE',
        message: `本机的 Python 工具连不上：${e instanceof Error ? e.message : String(e)}。请只用 SQL 完成分析，并在结论里如实说明这一步没做成。`,
      },
      ms: Date.now() - t0,
    }
  }

  if (!res.ok || !res.result) {
    const code = res.error?.code ?? 'PY_FAILED'
    const kind = classifyPyError(code)
    return {
      ...base,
      error: {
        code,
        /* ★ Python 侧的原话【原样】带出去，一个字都不改 ——
             它带着「现有列是：……」，而那是模型唯一能自己改对的线索。
             指引另起一段追加在后面，不覆盖它。 */
        message: `${res.error?.message ?? 'Python 算失败了。'}\n\n${
          kind === 'arg' ? PY_ARG_GUIDANCE : PY_ENV_GUIDANCE
        }`,
        detail: res.error?.detail,
      },
      ms: Date.now() - t0,
    }
  }

  const outRows = (res.result.rows ?? []) as Record<string, string | number | null>[]
  return {
    ...base,
    ok: true,
    full: { columns: res.result.columns, rows: outRows, rowCount: outRows.length },
    forModel: {
      callIndex: base.index,
      task,
      python: res.python ?? {},
      columns: res.result.columns,
      rows: outRows.slice(0, FOR_MODEL_ROWS),
      totalRows: outRows.length,
      note: `这是第 ${base.index} 次工具调用，由本机真 Python（${res.python?.version ?? '?'} / pandas ${res.python?.pandas ?? '?'}）算出。`,
    },
    ms: Date.now() - t0,
  }
}

/* ---------------------------------------------------------------------------
   五、把一次成功的调用变成页面能渲染的 SqlQuerySpec
   ---------------------------------------------------------------------------
   ★ 这一步是让第 4 步的卡片「一行不改」就能用的关键：
     那套组件认的是 SqlQuerySpec（id / label / purpose / sql / columns / note）。
     我们只是把一次真实调用翻译成那个形状，组件照旧渲染。
   --------------------------------------------------------------------------- */

/**
 * 一次调用的三种身份。
 * ★ 第三种是必须有的：模型完全可能调一个不存在的工具
 *   （executeToolCall 会如实回它 UNKNOWN_TOOL，那条记录照样进 records）。
 *   只分「SQL / 非 SQL」两种的话，这种记录会被当成 Python 记录，
 *   卡片上写着「大模型要本机 Python 算的第 3 步」、代码框里是一段
 *   `python_analysis(task=?, ...)` —— 而它压根没调过 Python。
 *   这是一句看起来很具体的假话，比不显示这张卡片糟得多。
 */
type CallKind = 'sql' | 'python' | 'unknown'

function callKind(name: string): CallKind {
  if (name === 'sql_query') return 'sql'
  if (name === 'python_analysis') return 'python'
  return 'unknown'
}

export function recordToSpec(record: ToolCallRecord): SqlQuerySpec | null {
  const kind = callKind(record.name)
  const code =
    kind === 'sql'
      ? typeof record.args?.sql === 'string'
        ? record.args.sql
        : record.argsRaw
      : kind === 'python'
        ? pseudoPython(record)
        : record.argsRaw

  /*
    ★ 三种记录都要出卡片，失败的也要 —— 一条都不能悄悄消失。

      Python 侧第一版是 `if (record.name !== 'sql_query') return null`：
      每一次 Python 调用都在第 4 步【彻底消失】。模型让它算了变化率、
      页面上一片空白 —— 用户完全看不出「Python 工具被用过」这件事，
      而「真的起了一个 Python 进程」恰恰是这一步最想证明的东西。
      （这和「被校验器拒掉的 SQL 从页面上消失」是同一种毛病，
       recordToSpec 里那段长注释讲的正好是这个教训，Python 记录却连门都没进。）

      SQL 侧第一版是 `if (!record.full) return null`：所有被拒的调用一条都看不见。
      最有说服力的一幕恰恰是被拒：模型写下 `SELECT 1; DROP TABLE ...`、
      被本机校验器当场拒绝、然后改写成只读查询重试。把这一幕显示出来
      （代码框里就是那条删表语句，下面一行红字是拒绝理由），
      比任何一句「我们有安全校验」都有力。

      第 4 步的组件本来就渲染 status='error' 的 outcome（显示代码 + 红字说明，
      不画表），所以失败的分支只需要把 columns 留空。
  */
  const label = {
    sql: `大模型写的第 ${record.index} 条查询`,
    python: `大模型要本机 Python 算的第 ${record.index} 步`,
    unknown: `大模型调用的第 ${record.index} 个工具（不存在）`,
  }[kind]

  const purpose = {
    sql: '这一条是模型自己决定要跑的 —— 事前没有人替它写好。',
    python:
      '这一步是模型自己决定要用 Python 算的 —— 它只能在 5 个写死的任务里选一个，不能写代码。',
    unknown: '模型调了一个本机根本没有的工具。它被当场回绝，下面是它原本发过来的参数。',
  }[kind]

  const language: CodeLanguage | undefined =
    kind === 'sql' ? 'sql' : kind === 'python' ? 'python' : undefined

  if (!record.full) {
    return {
      id: `llm-call-${record.index}`,
      label,
      purpose,
      sql: code,
      language,
      columns: [],
      note: `★ 这一条没有执行成功：${record.error?.message ?? '未知原因'}`,
    }
  }

  return {
    id: `llm-call-${record.index}`,
    label,
    purpose,
    sql: code,
    language,
    columns: autoColumns(record.full),
    note: kind === 'python' ? pyNoteFor(record) : noteFor(record),
  }
}

/* ---------------------------------------------------------------------------
   五·补、Python 那一步在代码框里显示什么
   ---------------------------------------------------------------------------
   ★ 这一段是【伪代码】，不是跑过的代码 —— 必须说清楚。

     真正的实现在 server/py/analysis_tool.py 里，那个文件不在前端，
     编译产物里也没有它（它是 .py，不进 bundle）。所以前端拿不到、
     也不该假装拿得到。

     那放什么？放【模型实际发过来的那次请求】—— 它是真实的，
     而且正好完整描述了这一步在算什么：哪个任务、引用第几次调用的数据、
     什么参数。把它按 Python 调用写出来，读者一眼能看懂，
     而且它和真正执行的东西一一对应。
   --------------------------------------------------------------------------- */

/** 按字母序列出键，保证同一份参数每次渲染出【一模一样】的字符串。 */
function stableDict(v: unknown): string {
  if (v === null || v === undefined) return 'None'
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `[${v.map(stableDict).join(', ')}]`
  const obj = v as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${k}=${stableDict(obj[k])}`).join(', ')}}`
}

/**
 * 把一次 Python 工具调用写成人能读的一段伪代码。
 * ★ 键按字母序：不然同一份参数两轮渲染出来顺序可能不同，
 *   页面上看着像变了，而其实什么都没变。
 */
export function pseudoPython(record: ToolCallRecord): string {
  const a = record.args ?? {}
  const task = typeof a.task === 'string' ? a.task : String(a.task ?? '?')
  const source = a.source === undefined ? '?' : stableDict(a.source)
  const params = stableDict(a.params ?? {})
  return [
    `# 第 ${record.index} 次工具调用 —— 模型选的任务与参数`,
    '# 真正的实现在 server/py/analysis_tool.py 里，前端拿不到它，',
    '# 下面这段是按模型实际发过来的请求写出来的【调用说明】，不是跑过的代码。',
    `python_analysis(task=${stableDict(task)}, source=${source}, params=${params})`,
  ].join('\n')
}

function pyNoteFor(record: ToolCallRecord): string {
  const r = record.full!
  const py = (record.forModel as { python?: { version?: string; pandas?: string } } | null)?.python
  const who = py?.version ? `本机 Python ${py.version} / pandas ${py.pandas ?? '?'}` : '本机真 Python'
  return (
    `真起了一个 ${who} 进程算的，耗时 ${formatMs(record.ms)} ms，返回 ${r.rowCount} 行。` +
    `发给模型的是前 ${Math.min(FOR_MODEL_ROWS, r.rowCount)} 行（完整结果在上面这张表里）。`
  )
}

/** 从结果集自动推断表头。数字列右对齐并格式化，文本列左对齐。 */
export function autoColumns(result: ToolResult): Column[] {
  return result.columns.map((key) => {
    const values = result.rows.map((r) => r[key]).filter((v) => v !== null && v !== undefined)
    const allNumeric = values.length > 0 && values.every((v) => typeof v === 'number')
    if (!allNumeric) return { key, label: key, align: 'left' as const }
    const allInt = values.every((v) => Number.isInteger(v))
    return {
      key,
      label: key,
      align: 'right' as const,
      format: (v: number | string) =>
        allInt
          ? Number(v).toLocaleString('zh-CN')
          : Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 4 }),
    }
  })
}

function noteFor(record: ToolCallRecord): string {
  const r = record.full!
  const parts = [`真跑了 ${formatMs(record.ms)} ms，返回 ${r.rowCount} 行。`]
  if (r.truncated) {
    parts.push(`★ 结果超过本页的行数上限（${ROW_CAP} 行），这里只显示了前 ${ROW_CAP} 行。`)
  }
  parts.push(
    `发给模型的是前 ${Math.min(FOR_MODEL_ROWS, r.rowCount)} 行（完整结果在上面这张表里）。`,
  )
  return parts.join('')
}

/* ---------------------------------------------------------------------------
   六、挑一份数据画图
   ---------------------------------------------------------------------------
   ★ 大模型路径事先不知道会查出什么，所以只有一张通用条形图。
     这段逻辑决定「把哪一次的结果画出来」，规则是死的、可预测的：

       优先挑带「变化率类」列的结果（名子里有 change / growth / pct / rate），
       否则挑最后一次「一列文字 + 至少一列数字」的结果。

     ★ 挑不出来就【不画图】。硬画一张没有意义的图，比不画更糟 ——
       页面会显得很满，但那张图在说一件没人验证过的事。
   --------------------------------------------------------------------------- */

export interface ChartPick {
  record: ToolCallRecord
  labelKey: string
  valueKey: string
}

const CHANGE_RE = /(change|growth|pct|percent|rate)/i

/**
 * 这一列是不是「变化率」那一类。
 *
 * ★ 导出它是为了让【画图那一侧】和【挑图那一侧】用同一条判断。
 *   页面要知道该不该按正负上色、数字该不该带正负号，而「什么算变化率」
 *   只有这一处定义（就是上面这条正则）。各写一份的话，
 *   挑中的那一列和画出来的格式会分叉，而分叉不报错。
 */
export function isChangeColumn(key: string): boolean {
  return CHANGE_RE.test(key)
}

/**
 * 序号列。★ 它们【不能拿来画柱子】。
 *
 *   Python 的 ranking 任务会在最前面插一列 `rank`（1、2、3…），
 *   它是「第几名」这个位置本身，不是任何被测量到的东西。
 *   把它画成柱子，得到的是一条严格递增的斜线 —— 图很好看，
 *   但它没有说明任何事，而页面上没有任何东西会提醒读者这一点。
 *
 *   （实测：ranking 的输出列是 ['rank','category','views']，
 *     label 挑到 category，numeric 挑到 ['rank','views']，
 *     没有变化率列时 valueKey 取 numeric[0] = 'rank'。）
 */
const INDEX_COL_RE = /^(rank|no|index|idx|序号|排名|名次)$/i

export function pickChartable(records: ToolCallRecord[]): ChartPick | null {
  const usable = records.filter(
    (r) => r.ok && r.full && r.full.rows.length >= 2 && r.full.columns.length >= 2,
  )
  if (usable.length === 0) return null

  const candidates: ChartPick[] = []
  for (const r of usable) {
    const cols = r.full!.columns
    const label = cols.find((c) => isTextColumn(r, c))
    if (!label) continue
    const numeric = cols.filter(
      (c) => c !== label && isNumberColumn(r, c) && !INDEX_COL_RE.test(c),
    )
    /* ★ 一列可画的数值都没有就跳过这一次 —— 而不是退回用 rank 顶上去。
       硬画一张没有意义的图比不画更糟：页面会显得很满，
       但那张图在说一件没人验证过的事。 */
    if (numeric.length === 0) continue
    const changed = numeric.find((c) => CHANGE_RE.test(c))
    candidates.push({ record: r, labelKey: label, valueKey: changed ?? numeric[0] })
  }
  if (candidates.length === 0) return null

  const withChange = candidates.filter((c) => CHANGE_RE.test(c.valueKey))
  const pool = withChange.length ? withChange : candidates
  return pool[pool.length - 1]
}

function isTextColumn(r: ToolCallRecord, key: string): boolean {
  const vals = r.full!.rows.map((row) => row[key]).filter((v) => v !== null && v !== undefined)
  return vals.length > 0 && vals.every((v) => typeof v === 'string')
}

function isNumberColumn(r: ToolCallRecord, key: string): boolean {
  const vals = r.full!.rows.map((row) => row[key]).filter((v) => v !== null && v !== undefined)
  return vals.length > 0 && vals.every((v) => typeof v === 'number')
}
