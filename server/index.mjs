/* ==========================================================================
   本机后端
   --------------------------------------------------------------------------
   这是这个项目里【唯一】一个服务端进程。它做两件事，别的什么也不做：
     1. 把前端的请求转给大模型（API Key 只活在这里）
     2. 把数据交给本机的真 Python / pandas 算（见 pyRunner.mjs）

   ★ 它【不认识】SQLite、【不碰】数据文件、不写任何东西到磁盘。
     所有 SQL 都在浏览器里真跑（sql.js / WebAssembly），56 万行数据不出用户的电脑。

   ★ 为什么它这么薄：前端在 src/ 下有 TypeScript 类型检查和一千多条断言两层保护；
     这个目录是 .mjs，绕开了 tsconfig，【没有类型保护】。
     所以规矩是：能放到前端去的逻辑，一律放到前端去。

   启动：npm run server   （等价于 node server/index.mjs）
   ========================================================================== */

import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { callLlm, listModels, NO_MODELS_NOTE } from './llm.mjs'
import { DEFAULT_PROVIDER, PROVIDERS, LlmError } from './providers.mjs'
import { probePython, runPy } from './pyRunner.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const STARTED_AT = Date.now()

/* --------------------------------------------------------------------------
   一、配置
   -------------------------------------------------------------------------- */

/** 极小的 .env 解析。不引依赖 —— 这个项目整体上就没有服务端依赖。 */
function loadEnvFile(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (key) out[key] = val
  }
  return out
}

const fileEnv = loadEnvFile(join(HERE, '.env'))

/**
 * API Key 的读取顺序（前面优先）：
 *   1. server/.env 里的 DEEPSEEK_API_KEY  —— 推荐，项目专用，不进 git
 *   2. 环境变量 DEEPSEEK_API_KEY
 *   3. 环境变量 ANTHROPIC_AUTH_TOKEN —— 仅当 ANTHROPIC_BASE_URL 指向 deepseek 时
 *      （Claude Code 用的就是这一对，是同一家同一把 key，复用它省一次申请）
 */
function resolveApiKey() {
  const fromFile = fileEnv.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY
  if (fromFile) return { key: fromFile, from: 'server/.env' }

  const base = process.env.ANTHROPIC_BASE_URL ?? ''
  const token = process.env.ANTHROPIC_AUTH_TOKEN ?? ''
  if (token && base.includes('deepseek')) {
    return { key: token, from: '环境变量 ANTHROPIC_AUTH_TOKEN' }
  }
  return { key: '', from: '（没有找到）' }
}

const resolved = resolveApiKey()
const providerId = process.env.LLM_PROVIDER || fileEnv.LLM_PROVIDER || DEFAULT_PROVIDER
const provider = PROVIDERS[providerId] ?? PROVIDERS[DEFAULT_PROVIDER]

const cfg = {
  provider: provider.id,
  model: process.env.LLM_MODEL || fileEnv.LLM_MODEL || provider.defaultModel,
  apiKey: resolved.key,
  keyFrom: resolved.from,
}
const PORT = Number(process.env.PORT || fileEnv.PORT || 8787)

/* --------------------------------------------------------------------------
   二、安全约束
   -------------------------------------------------------------------------- */

/**
 * ★ 只允许【本机】的来源打这个接口，端口是一段而不是一个。
 *
 * 不加这一条的话：本机 8787 端口上【任何网页】都能调你的后端，
 * 而你的后端拿的是你的 API Key —— 等于把你的账号额度挂在公网上给别人用。
 * 这是「本机服务」最容易被忽略的一个洞。
 *
 * ★ 为什么端口必须是一段，不能只写 5173（2026-09-12 真踩到，用户报上来的）：
 *   Vite 的 `port: 5173` 不是硬性的 —— 5173 被占用时它会【静默】换到 5174、5175…
 *   （vite.config.ts 里没有 strictPort）。而这一页的请求带的是
 *   【浏览器地址栏上那个来源】，于是「只认 5173」必然把 5174 整个拒之门外。
 *
 * ★ 更阴的一点，也是这条注释非写不可的原因：
 *   **探测（GET /api/health）永远发现不了这件事。**
 *   浏览器的 GET/HEAD 请求【不附加 Origin 头】，只有非 GET/HEAD 才附加
 *   （Fetch 规范）。所以页面的探测一路畅通、理直气壮地显示「已接入真实大模型」，
 *   然后第一次 POST 提问就被这里拒掉 ——
 *   用户看到的是「明明说连上了，一提问就跑到一半停了」。
 *   实测：不带 Origin → 200；Origin: localhost:5173 → 200；Origin: localhost:5174 → 403。
 *
 * ★ 放开的是【端口】，不是【来源】：仍然只认回环地址、仍然精确字符串匹配。
 *   上面那条安全论据（同一个 WiFi 下别人不能白用你的额度）一个字都没变。
 *   端口多认几个的代价：这台机器上【别的本地网页】（5173–5180 / 4173–4175 上跑的）
 *   也能调这个后端。这是为了「同一个项目开两个窗口」这件日常操作让的路，
 *   写在这里，免得以后有人以为这里是随手写的。
 *
 * ★ 没有 Origin 头的请求是放行的：那只可能是 curl / 脚本这类非浏览器客户端，
 *   它们不是「被诱导的浏览器」，本来就不受 CSRF 影响。
 *   浏览器发的跨域请求【一定】带 Origin，所以这个放行不构成绕过。
 *   ★ 注意这和上面那条不对称是【同一枚硬币的两面】：
 *     正因为浏览器对 GET 不带 Origin，探测才永远验不出来源 ——
 *     所以这里的放行必须继续留着，否则命令行那条路会被误伤（本机有一条检查钉着它）。
 */
const ALLOWED_PORTS = [
  5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180, // vite dev 的端口漂移区间
  4173, 4174, 4175, // vite preview 的默认端口往后几个
]

const ALLOWED_ORIGINS = new Set(
  ALLOWED_PORTS.flatMap((port) => [`http://localhost:${port}`, `http://127.0.0.1:${port}`]),
)

function originAllowed(origin) {
  return origin === undefined || origin === null || ALLOWED_ORIGINS.has(origin)
}

/**
 * 请求体上限。
 *
 * ★ 这个数【是量过的，不是估的】：本机有一条检查拿「500 行 × 最宽的
 *   12 列」（widen 之后的 video_views ⋈ videos）真的序列化了一遍 ——
 *   108,382 字节，用掉上限的 41.3%，并且真的 POST 了一次确认能收下。
 *   原来这里写的是「正常远小于此」，那是一句猜的话，没人量过。
 *   为什么留这么多余量：上限的用途是兜住「有人拿这个端口灌东西」，
 *   不是卡住正常调用。正常调用要留出宽裕的余量，不然今天能用明天就报错。
 */
const MAX_BODY_BYTES = 256 * 1024

/**
 * 限流：每分钟 30 次。
 * 兜住两种情况：模型陷入循环调用；以及用户手抖连点。
 * 它不是防攻击用的（本机服务没有攻击面），是防「一不小心烧掉一晚上额度」。
 */
const RATE_LIMIT_PER_MIN = 30
const hits = []
function rateLimited() {
  const now = Date.now()
  while (hits.length && now - hits[0] > 60_000) hits.shift()
  if (hits.length >= RATE_LIMIT_PER_MIN) return true
  hits.push(now)
  return false
}

/* --------------------------------------------------------------------------
   三、小工具
   -------------------------------------------------------------------------- */

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * 每次请求一行日志。
 * ★ 绝不打印 key，也绝不打印请求体（里面有用户的完整对话和查询结果）。
 *   日志里带 key 是这个项目最不能出的丑闻。
 */
function log(method, path, status, extra = '') {
  const t = new Date().toTimeString().slice(0, 8)
  console.log(`[${t}] ${method} ${path} → ${status}${extra ? ' | ' + extra : ''}`)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY_BYTES) {
        reject(new LlmError('BODY_TOO_LARGE', '请求体太大了（超过 256KB）。'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new LlmError('BAD_JSON', '请求体不是合法的 JSON。'))
      }
    })
    req.on('error', reject)
  })
}

/* --------------------------------------------------------------------------
   四、路由
   -------------------------------------------------------------------------- */

/** 大模型配好了没。health 和每个响应都用它，避免两种说法。 */
function llmStatus() {
  return {
    configured: Boolean(cfg.apiKey),
    provider: cfg.provider,
    providerLabel: provider.label,
    model: cfg.model,
    baseUrlHost: new URL(provider.baseUrl).host,
    keyFrom: cfg.keyFrom,
  }
}

async function handle(req, res, path) {
  /* ---- GET /api/health：前端靠它决定走大模型路径还是规则路径 ---- */
  if (path === '/api/health' && req.method === 'GET') {
    const py = await probePython()
    return sendJson(res, 200, {
      ok: true,
      llm: llmStatus(),
      python: py,
      limits: { maxToolCalls: 4, maxRows: 500, llmTimeoutMs: 60000, pyTimeoutMs: 20000 },
      uptimeMs: Date.now() - STARTED_AT,
    })
  }

  /* ---- GET /api/version ---- */
  if (path === '/api/version' && req.method === 'GET') {
    return sendJson(res, 200, { version: 'stage8', startedAt: new Date(STARTED_AT).toISOString() })
  }

  /* ---- POST /api/llm：转发给大模型 ---- */
  if (path === '/api/llm' && req.method === 'POST') {
    if (!cfg.apiKey) {
      throw new LlmError(
        'NO_KEY',
        '后端没有读到 API Key。请把 server/.env.example 复制成 server/.env，' +
          '在 DEEPSEEK_API_KEY= 后面填上自己的 key，然后重启这个后端。',
      )
    }
    const body = await readBody(req)
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      throw new LlmError('BAD_REQUEST', '请求里没有 messages。')
    }

    // ★ 只转发这两个字段。model / baseUrl / provider 一律【不接受前端传入】——
    //   否则任何网页都能让这个后端把你的 key 转发到它自己的服务器上去。
    const out = await callLlm(
      { messages: body.messages, tools: body.tools, jsonMode: body.jsonMode === true },
      cfg,
    )
    log(req.method, path, 200,
      `${cfg.provider}/${cfg.model} | ${out.ms}ms | in ${out.usage.promptTokens} out ${out.usage.completionTokens} tok | ${out.toolCalls.length} tool_calls`)
    return sendJson(res, 200, out)
  }

  /* ---- POST /api/py：交给本机真 Python / pandas 算 ---- */
  if (path === '/api/py' && req.method === 'POST') {
    const body = await readBody(req)
    const out = await runPy(body)
    log(req.method, path, out.ok ? 200 : 500, `${out.ms}ms | task=${body.task ?? '?'}`)
    return sendJson(res, out.ok ? 200 : 500, out)
  }

  return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: `没有这个接口：${path}` } })
}

/* --------------------------------------------------------------------------
   五、服务器
   -------------------------------------------------------------------------- */

const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0]
  const origin = req.headers.origin

  /* 预检。走 vite proxy 时不会触发，但直连 8787 时会。 */
  if (req.method === 'OPTIONS') {
    if (!originAllowed(origin)) return sendJson(res, 403, {})
    res.writeHead(204, {
      'access-control-allow-origin': origin ?? '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '600',
    })
    return res.end()
  }

  if (!originAllowed(origin)) {
    log(req.method, path, 403, `Origin 不在白名单：${origin}`)
    return sendJson(res, 403, {
      error: {
        code: 'ORIGIN_DENIED',
        message: `来源「${origin}」不在允许列表里。这是本机服务，只接受本项目的页面调用。`,
      },
    })
  }

  if (origin) res.setHeader('access-control-allow-origin', origin)

  if (rateLimited()) {
    log(req.method, path, 429)
    return sendJson(res, 429, {
      error: { code: 'RATE_LIMIT', message: '请求太频繁（每分钟最多 30 次）。等一会儿再试。' },
    })
  }

  try {
    await handle(req, res, path)
  } catch (e) {
    const code = e instanceof LlmError ? e.code : 'INTERNAL'
    const message =
      e instanceof LlmError ? e.message : '后端内部出错了，原因见下方的技术细节。'
    const detail = e instanceof LlmError ? e.detail : String(e?.stack ?? e).slice(0, 600)
    log(req.method, path, code === 'NO_KEY' ? 503 : 500, `${code}`)
    if (!res.headersSent) sendJson(res, code === 'NO_KEY' ? 503 : 500, { error: { code, message, detail } })
  }
})

/* --------------------------------------------------------------------------
   六、启动
   -------------------------------------------------------------------------- */

/**
 * ★ 只绑 127.0.0.1，不绑 0.0.0.0。
 *   绑 0.0.0.0 等于把「带 key 的转发器」挂到局域网上：
 *   同一个 WiFi 下任何人只要知道你的 IP 就能白用你的额度。
 */
server.listen(PORT, '127.0.0.1', () => {
  console.log('')
  console.log('  ==========================================')
  console.log('   大模型后端已启动')
  console.log('  ==========================================')
  console.log(`   监听地址   http://127.0.0.1:${PORT}  （只有本机能访问）`)
  console.log(`   供应商     ${provider.label}（${provider.id}）`)
  console.log(`   模型       ${cfg.model}`)
  console.log(`   API Key    从 ${cfg.keyFrom} 读到 ${cfg.apiKey ? '✓' : '✗ 没找到'}`)
  console.log('')
  if (!cfg.apiKey) {
    console.log('   ★ 没有读到 API Key，页面会自动退回关键词规则路径（功能完整，只是不接大模型）。')
    console.log('     要启用大模型：用记事本打开 server\\.env，把 DEEPSEEK_API_KEY 填上。')
    console.log('')
  }
  console.log('   关闭方式：关掉这个窗口，或按 Ctrl + C')
  console.log('')

  // ★ 启动时列一次真实可用的模型，并且【把结果说出来】。
  //   实测教训：账号里根本没有「deepseek-v4-flash」这个名字，猜模型名会直接失败。
  //   ★ 2026-09-12 改：下面这三种情况原来全是 `return` 或 `.catch(() => {})` ——
  //     一律不说话。于是「后端起来了、但网络到不了 DeepSeek」和「一切正常」
  //     在窗口里长得一模一样，用户以为没事，第一次提问才失败。
  //     全程只打印状态码和分类器给的中文说明，【绝不打印 key】（key 只在请求头里）。
  if (cfg.apiKey) {
    listModels(cfg)
      .then((r) => {
        if (!r.ok) {
          console.log(`   ★ 列模型没成功：${r.error.message}`)
          console.log('     这一条【不影响后端本身】—— 页面照样能打开、功能完整。')
          console.log('     但如果原因是「连不上」，真正提问时会以同样的方式失败。')
          console.log('     查网络：本机访问境外站点需要开代理（把系统代理打开再试）。')
          console.log('')
          return
        }
        if (!r.ids.length) {
          console.log(`   ★ ${NO_MODELS_NOTE}`)
          console.log('     一个可用模型都没有时，提问同样会失败。')
          console.log('')
          return
        }
        console.log(`   该账号真实可用的模型：${r.ids.join(' / ')}`)
        if (!r.ids.includes(cfg.model)) {
          console.log(`   ★ 注意：当前配置的模型「${cfg.model}」不在上面这个列表里，调用会失败。`)
          console.log(`     改 server\\.env 里的 LLM_MODEL，换成上面任意一个即可。`)
        }
        console.log('')
      })
      // ★ 这个 catch 现在会说话。以前是 `.catch(() => {})`：
      //   连「列模型这一步炸了」都看不见，而它偏偏是排查提问失败的第一现场。
      .catch((e) => {
        console.log(`   ★ 列模型时出错了：${String(e?.message ?? e)}`)
        console.log('')
      })
  }
})

process.on('SIGINT', () => {
  console.log('\n   后端已停止。')
  process.exit(0)
})

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log('')
    console.log(`   ★ 端口 ${PORT} 已经被占用了 —— 很可能后端已经在另一个窗口里跑着。`)
    console.log('     要么直接用那个窗口，要么先把它关掉再启动这一个。')
    console.log('')
    console.log('   ★ 这个窗口现在【什么都没在做】。')
    console.log('     （它不会自己关掉，所以看起来像在跑 —— 其实已经停在这里了。）')
    console.log('     如果你不确定 8787 上那个是不是【当前这份代码】，')
    console.log('     把它那个窗口关掉，再重新跑一次 npm run server。')
    console.log('     ★ 这一条真踩过：2026-09-12 端口上挂着的是加白名单之前起的旧进程，')
    console.log('       页面于是照着旧代码回 403，看起来像白名单没修好。')
    console.log('')
  } else {
    console.log('   后端启动失败：', e.message)
  }
  process.exit(1)
})
