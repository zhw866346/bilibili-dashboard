/* ==========================================================================
   在本机真跑 Python / pandas
   --------------------------------------------------------------------------
   ★ 这个文件存在的唯一理由：让「Python 分析工具」这个名字名实相符。

     备选方案是在浏览器里用 JavaScript 实现同样的算法（变化率、排名、斜率），
     那样更快、更不容易出错。但那就不能叫「Python 工具」了 ——
     页面上必须如实写成「这是用 JavaScript 实现的同名算法」。
     这个项目建立起来的信任是「真 Pandas 真跑」，不在这里破例。

   ★ 安全边界：Python 侧【不执行模型写的任何代码】。
     模型只能从 5 个写死的任务里选一个，再指定列名。
     这是本机进程，允许模型写代码 = 把整台机器交出去。
   ========================================================================== */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TOOL = join(HERE, 'py', 'analysis_tool.py')

/** 找 Python 的顺序。第一个探通的就用它，结果缓存起来（探测要起进程，不快）。
 *  ★ 这里【不写死任何绝对路径】：写死了既把「开发那个人的盘符」印在公开源码里，
 *    换一台机器又必然失效。要用 PATH 之外的 Python，就用环境变量 PYTHON 指定 ——
 *    那是使用者自己的选择，不该是仓库替他决定的事。 */
const CANDIDATES = [
  process.env.PYTHON,
  'python',
  'py',
].filter(Boolean)

let pythonPromise = null

/** 起一个 Python 进程跑一段固定的命令行参数，收集 stdout / stderr。 */
function execPython(exe, args, { timeoutMs, stdinData = null, maxOut = 256 * 1024 }) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(exe, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    } catch (e) {
      return resolve({ ok: false, code: 'SPAWN_FAILED', detail: String(e.message) })
    }

    let stdout = ''
    let stderr = ''
    let killed = false
    let truncated = false

    const timer = setTimeout(() => {
      killed = true
      // ★ 说明白：Python 进程没法「暂停」，只能杀掉。
      //   超时之后它算的东西就丢了，页面上要如实说「已放弃」，不能说「已取消」。
      try { child.kill('SIGKILL') } catch { /* 已经退出了 */ }
    }, timeoutMs)

    child.stdout.on('data', (c) => {
      if (stdout.length > maxOut) { truncated = true; return }
      stdout += c.toString('utf8')
    })
    child.stderr.on('data', (c) => {
      if (stderr.length > 8000) return
      stderr += c.toString('utf8')
    })

    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, code: 'SPAWN_FAILED', detail: String(e.message) })
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (killed) {
        return resolve({
          ok: false,
          code: 'PY_TIMEOUT',
          detail: `Python 超过 ${Math.round(timeoutMs / 1000)} 秒还没算完，已经把它杀掉了。`,
        })
      }
      if (truncated) {
        return resolve({ ok: false, code: 'PY_OUTPUT_TOO_LARGE', detail: 'Python 的输出太大了。' })
      }
      resolve({ ok: true, code, stdout, stderr })
    })

    if (stdinData !== null) {
      child.stdin.end(stdinData, 'utf8')
    } else {
      child.stdin.end()
    }
  })
}

/**
 * 探测本机 Python。
 * ★ 返回值里带着「为什么不行」—— 页面上要显示原因，不能只说一句「Python 不可用」。
 */
export async function probePython() {
  if (pythonPromise) return pythonPromise
  pythonPromise = (async () => {
    if (!existsSync(TOOL)) {
      return { ok: false, detail: `找不到分析脚本：${TOOL}` }
    }
    for (const exe of CANDIDATES) {
      const r = await execPython(exe, [TOOL, '--probe'], { timeoutMs: 15000 })
      if (r.ok && r.code === 0) {
        try {
          const info = JSON.parse(r.stdout.trim().split('\n').pop())
          return { ok: true, exe, ...info }
        } catch {
          return { ok: false, detail: `${exe} 能跑，但 --probe 的输出不是合法 JSON。` }
        }
      }
      // 只在最后一个候选也失败时，把它的 stderr 当作原因报出去
      if (exe === CANDIDATES[CANDIDATES.length - 1]) {
        const why = (r.stderr || r.detail || '').trim().split('\n').slice(-3).join(' ')
        return { ok: false, detail: why || `试过 ${CANDIDATES.join(' / ')}，都没跑通。` }
      }
    }
    return { ok: false, detail: `试过 ${CANDIDATES.join(' / ')}，都没跑通。` }
  })()
  return pythonPromise
}

/**
 * 把「数据 + 任务名」交给 Python 算。
 *
 * @param {{ task: string, rows: object[], params?: object }} req
 */
export async function runPy(req, { timeoutMs = 20000 } = {}) {
  const t0 = Date.now()

  const py = await probePython()
  if (!py.ok) {
    return {
      ok: false,
      ms: Date.now() - t0,
      error: { code: 'PY_UNAVAILABLE', message: `本机 Python 跑不起来：${py.detail}` },
    }
  }

  const rows = Array.isArray(req?.rows) ? req.rows : []
  if (!rows.length) {
    return {
      ok: false,
      ms: Date.now() - t0,
      error: { code: 'EMPTY_INPUT', message: '上一步没有返回任何数据行，这一步算不了。' },
    }
  }
  // 后端自己也拦一道。前端已经限了 500 行，但不能只靠前端 ——
  // 这个端口别的程序也能调。
  const MAX_ROWS = 500
  const capped = rows.slice(0, MAX_ROWS)

  const payload = JSON.stringify({ task: req.task, rows: capped, params: req.params ?? {} })
  const r = await execPython(py.exe, [TOOL], { timeoutMs, stdinData: payload })

  if (!r.ok) {
    return {
      ok: false,
      ms: Date.now() - t0,
      error: { code: r.code, message: r.detail },
    }
  }

  let parsed
  try {
    parsed = JSON.parse(r.stdout.trim().split('\n').pop())
  } catch {
    const tail = (r.stderr || r.stdout || '').trim().split('\n').slice(-4).join(' ')
    return {
      ok: false,
      ms: Date.now() - t0,
      error: {
        code: 'PY_BAD_OUTPUT',
        message: `Python 的输出不是合法 JSON。它最后说的话是：${tail || '（什么都没有）'}`,
      },
    }
  }

  if (!parsed.ok) {
    return {
      ok: false,
      ms: Date.now() - t0,
      error: {
        code: parsed.error?.code ?? 'PY_FAILED',
        // ★ stderr 原样带出去 —— 这是 Python 侧唯一的可观测面。
        //   把它吞掉，用户就只剩「Python 出错了」这一句，无从下手。
        message: parsed.error?.message ?? 'Python 算失败了。',
        detail: parsed.error?.detail ?? '',
      },
    }
  }

  return { ok: true, ms: Date.now() - t0, result: parsed.result, python: parsed.python ?? {} }
}
