/* ==========================================================================
   本机后端的客户端
   --------------------------------------------------------------------------
   只有三个函数：探一次、调大模型、调 Python。

   ★ 页面里的地址一律是相对路径 `/api/...`，不写 `http://127.0.0.1:8787`。
     因为开发服务器会把 `/api` 转发给后端（vite.config.ts 里的 proxy）。
     写死绝对地址有两个坏处：一是开发和生产要用两个地址，
     二是打包出来的页面会带着一个「本机端口号」的字样到处跑。

     ⚠️ 但代理【只在 `npm run dev` / `npm run preview` 时存在】。
        双击 `dist/index.html` 打开时（file://）根本没有服务器，
        相对路径会指向本地文件，浏览器也不允许那种页面访问本机端口 ——
        探测于是返回 'static'，页面如实说「从本地文件打开，连不上」。
        这不是故障，是这个项目从一开始就刻意保住的一种用法（`base: './'`，
        为了让打包产物也能直接双击打开）。**别为了让它也能连后端去写绝对地址**，
        那等于用一个更糟的假象换掉一句真话。

   ★ 为什么每个错误都要分类得这么细：
     用户看到的每一句话都不一样 ——「后端没启动」「后端起来了但没配 key」
     「key 被拒了」「余额用完了」「网络被挡了」是五种完全不同的故障，
     对应五种完全不同的处理办法。笼统说一句「AI 服务不可用」，
     等于把排查成本全推给用户。
   ========================================================================== */

import { BackendError, type BackendProbe } from './types'

/** 开发服务器转发过来的后端地址。相对路径，不写死端口。 */
const API_BASE = '/api'

/**
 * 探测本机后端的超时。
 * ★ 4 秒是刻意的短：本地回环地址如果 4 秒还没有回应，那就是没启动，
 *   而不是「慢」。等 30 秒只会让人以为页面卡死了。
 */
const PROBE_TIMEOUT_MS = 4000

/**
 * 调大模型的超时。
 * ★ 必须【比后端自己的超时（60 秒）长】，让后端先超时。
 *   后端超时会给出格式统一的错误对象和中文说明；如果前端先超时，
 *   用户只会看到一句「连接中断」，不知道是模型慢还是网络断。
 */
const LLM_TIMEOUT_MS = 75_000

/** 调 Python 的超时，同样比后端（20 秒）长一点。 */
const PY_TIMEOUT_MS = 30_000

/* ---------------------------------------------------------------------------
   一、探测
   --------------------------------------------------------------------------- */

/**
 * 探测拿到非 200 时，尽量把【后端自己说的原因】带出来。
 *
 * ★ 为什么不能只说「HTTP 403」（2026-09-12 改）：403 至少有两种意思完全不同的成因，
 *   给的指引也完全相反。尤其是 `ORIGIN_DENIED` —— 它的意思是
 *   「这一页的地址后端不认识」，而那个原因是用户可以自己动手解决的
 *   （多半是 5173 被上一个没关掉的窗口占着、浏览器开到了 5174）。
 *   只说一句状态码，等于把已经拿到手的原因扔掉，用户看完还是不知道该干什么。
 *
 * ★ 顺带记一条这件事暴露出来的不对称，免得以后有人以为探测「漏了」什么：
 *   **探测走的是 GET，浏览器对 GET 不附加 Origin 头，对 POST 才附加。**
 *   所以探测【天生】发现不了来源被拒 —— 它一路畅通，页面于是显示「已接入真实大模型」，
 *   然后第一次 POST 提问才被拒。这也是为什么 server/index.mjs 的白名单
 *   必须容忍端口漂移，而不是靠探测兜住。
 */
/* ---------------------------------------------------------------------------
   一·零、「这句应答不是我们后端发的」—— 全项目只有这一处说这句话
   ---------------------------------------------------------------------------
   ★ 通则（下面所有判断的依据，改之前先读懂它）：

     **本机后端的应答永远是 JSON —— 成功和报错都是。**
     `server/index.mjs` 里写响应体只有 `sendJson()` 一个函数，全文件没有第二处
     写 body。所以「拿到的不是 JSON」=「这不是它发的」。

   ★ 为什么必须按【通则】判，不能按状态码判（2026-09-12 用户实测踩到）：
     开发服务器在 `/api` 转发不到 8787 时，自己回一个
     **502 + 空 body + text/plain**
     （`node_modules/vite/dist/node/chunks/node.js:19216` 的 `proxy.on('error')`）。
     而本机后端**从来不回 502** —— 它只有 200 / 204 / 403 / 404 / 429 / 500 / 503。
     原来的代码看到 `!res.ok` 就写「本机后端**回应了** HTTP 502」，
     把「后端不在」说成了「后端答了个错」，用户于是去反复启动一个
     根本没在跑的东西，而每次那个窗口看起来都「正常」。

   ★ 502 只是最常见的一种形状：超时、连接被重置走的都是同一个 handler，
     所以判据只能盯「body 是不是我们那种 JSON」；盯数字一定会漏。
   --------------------------------------------------------------------------- */

/**
 * 「本机后端连不上」这一句【全项目只写这一处】。
 * ★ 三个入口共用：fetch 自己抛异常、转发层替它回话、body 不是我们的 JSON。
 *   写两份的话今天一致、将来改一处就悄悄分叉，而分叉时不报错。
 */
export const BACKEND_DOWN_REASON = '本机后端连不上 —— 多半是它还没有启动。'

/** 收到一份【不是本机后端发的】应答时，补一句「那是谁发的、那个数字是什么意思」。 */
export function notFromBackendNote(status: number): string {
  return (
    `★ 这一条不是本机后端发出来的：答复是 HTTP ${status}，而且内容不是后端那种 JSON。` +
    '本机后端【所有】回应都带着它自己那种 JSON（成功和报错都一样），' +
    '所以非 JSON 的答复只可能来自中间那一层（开发服务器的转发）：' +
    '那个数字是转发层在说「我没能把请求交给后端」，不是后端在报错。'
  )
}

/**
 * 这一条 reason 说的是不是「后端根本没在跑」。
 * ★ 判据就用那句话本身，不另设一个布尔标志位 ——
 *   另设一个的话，句子和标志可以各自被改而互不报警，那就是两个真相来源。
 */
export function reasonSaysBackendDown(reason: string): boolean {
  return reason.includes(BACKEND_DOWN_REASON)
}

/**
 * 后端自己回的错，翻成人话。
 * ★ 走这条路的【一定是我们的后端】（判据见上面那段通则），所以「回应了 HTTP xxx」
 *   这句话在这里是准确的；`ORIGIN_DENIED` 那一支的解释也只在这才是对的。
 */
function describeOurError(status: number, code: string, message: string): string {
  const head = `本机后端回应了 HTTP ${status}，不是预期的 200。`
  const tail = message ? `后端原话：${message}` : ''
  if (code === 'ORIGIN_DENIED') {
    return (
      `${head}${tail}` +
      '★ 这一条的意思是：这一页的地址，后端不认识。' +
      '最常见的原因是 5173 端口被上一个没关掉的窗口占着，浏览器就开到了别的端口 —— ' +
      '把多余的窗口关掉，重新跑一次 npm run server 再试。'
    )
  }
  return `${head}${tail ? ` ${tail}` : ''}${code ? `（错误码：${code}）` : ''}`
}

async function probeFailureReason(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } }
    /* ★ 通则：我们的后端出错时【永远】带 error 字段，所以「解析出来了但没有 error」
       同样是一个「不是它发的」。 */
    if (body && typeof body === 'object' && body.error) {
      return describeOurError(res.status, body.error.code ?? '', body.error.message ?? '')
    }
  } catch {
    /* 不是 JSON —— 落到下面那一条。今天实际遇到的就是这条：502 + 空 body。 */
  }

  /* ★ 走到这里 = 这层应答不是我们后端发出来的 = 它多半没在跑。
     说的必须是【那一句共用的真话】，而不是「后端回应了 HTTP xxx」。 */
  return `${BACKEND_DOWN_REASON} ${notFromBackendNote(res.status)}`
}

/**
 * 探测本机后端。返回四态之一，每一态都带着「为什么」。
 *
 * ★ 头两件事按【固定顺序】判，判完才轮到 fetch。两个顺序都不是随手排的：
 *
 *   ① `file://` 【必须排在最前面】。
 *      双击 dist/index.html 打开时，浏览器物理上不允许本地页面访问
 *      http://127.0.0.1 —— 这不是「后端坏了」，也不是「降级」，
 *      是打开方式决定的。（不先判这个的话，fetch 会失败并报一句含糊的
 *      网络错误，用户会去反复启动后端 —— 而那是没用的。）
 *
 *      ★★ 而它【必须排在下面那条 hostname 判断之前】，这一条是硬要求：
 *         `file://` 下的 `location.hostname` 是【空字符串】，也就是「不是本机地址」。
 *         两条顺序一颠倒，file:// 就会被判成 'deployed'，
 *         于是 'static' 那一态【永远走不到】—— 而它守的是这个项目
 *         从一开始刻意保住的那种用法（双击打开，见 vite.config.ts 的 `base: './'`）。
 *         静默变坏、页面照样能开，只是说法变成一句错的。
 *         有一条【预检】专门守着这个顺序 —— 它的特殊性在于当场打印、打完就停，
 *         而不是像别的断言那样「先记账、最后一起汇总」。
 *         ★ 它原先写在脚本很靠后的一节里，实测发现放那儿等于没有：顺序真写反了
 *           不抛不崩，可「守卫被删」那种改法会让脚本当场崩在更靠前的一节，
 *           后面那一节根本执行不到。
 *           守这类东西的断言，必须放在【可能崩的地方之前】。
 *
 *   ② `deployed`：地址栏里不是回环地址 = 这一页是从静态托管上下载下来的，
 *      背后【一定】没有后端。所以【连 fetch 都不用试】——
 *      这一点很重要，不是省一步：线上试一次只会等满 4 秒超时，
 *      然后把「连不上」当成降级原因报出来，而真相是「设计如此、根本没有」。
 *
 * ★ 为什么整段包在 `typeof location !== 'undefined'` 里（不是多此一举）：
 *   这个函数在【Node 里】会被真调很多次（本地那些检查脚本就是这么跑的），
 *   而 Node 没有 `location`（实测 `typeof location === 'undefined'`），
 *   并且那些调用没有一处桩过它。少了这层守卫，它们会当场抛 TypeError ——
 *   不是「一条红的」，是整个脚本崩掉，连「哪几条红了」都打不出来。
 *   上面那个 `file://` 判断本来就带同样的守卫，这里跟它保持一致。
 *
 * ★ 一处如实记下的边界（刻意不修）：从局域网访问（http://192.168.x.x:5173）
 *   也会被判成 'deployed'。这是取舍不是漏 —— 后端只绑 127.0.0.1
 *   （server/index.mjs 的 listen），从别的机器本来就够不着，Origin 白名单也会拒。
 *   为它加一段私有网段判断 = 一段没有任何测试能真正走到的死代码。
 */
export async function probeBackend(): Promise<BackendProbe> {
  if (typeof location !== 'undefined' && location.protocol === 'file:') {
    return {
      kind: 'static',
      reason:
        '你是直接双击打开网页文件的（地址栏以 file:// 开头）。' +
        '这种打开方式下，浏览器不允许网页访问本机的后端服务。',
    }
  }

  /* ---- ② 线上演示版：不是本机地址，背后没有后端 ---- */
  if (typeof location !== 'undefined') {
    const host = location.hostname
    /* ★ `[::1]` 和 `::1` 两个都列：浏览器把 IPv6 回环写成带方括号的 `[::1]`，
       但别的 runtimes 可能给不带括号的。少认一个，那台机器上就会被误判成线上。 */
    const isLocal =
      host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
    if (!isLocal) {
      return {
        kind: 'deployed',
        reason:
          '这一页是从网上（静态托管）打开的这一份，不是本机跑的那一份 —— ' +
          '它背后没有后端服务。这是演示版的设计，不是故障。',
      }
    }
  }

  let res: Response
  try {
    res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
  } catch (e) {
    return { kind: 'rule', reason: describeFetchFailure(e) }
  }

  if (!res.ok) {
    return { kind: 'rule', reason: await probeFailureReason(res) }
  }

  let json: {
    llm?: Record<string, unknown>
    python?: Record<string, unknown>
  }
  try {
    json = await res.json()
  } catch {
    /* ★ 200 但内容不是我们的 JSON —— 同一条通则：这不是后端发的。
       （常见于 5173 上挂着的 dev server 是改配置之前启动的旧进程，
         它不会重读 vite.config.ts，`/api` 于是压根没转发。） */
    return { kind: 'rule', reason: `${BACKEND_DOWN_REASON} ${notFromBackendNote(res.status)}` }
  }

  /* ★ 这段守卫不是多余的：`res.json()` 能吐回 `null` / 数字 / 字符串
     （body 是 `null`、`1`、`"ok"` 都合法解析），而上面那个类型标注对运行时【没有约束】。
     少了它，`json.llm` 在 json 为 null 时抛 TypeError ——
     而这个函数是在【第一句 await】上抛的，没有任何地方会 catch 它，
     于是整页会停在一份什么都没跑过的轨迹上。
     更坏的是：AiAnalyst 用模块级变量缓存了探测的 Promise，
     所以这一次失败会被缓存【一整个标签页】，之后每次提问都立刻以同一个异常结束。 */
  if (!json || typeof json !== 'object') {
    return { kind: 'rule', reason: '本机后端的响应不是预期的形状（它不是一个 JSON 对象）。' }
  }

  const llm = json.llm ?? {}
  if (!llm.configured) {
    return {
      kind: 'rule',
      reason:
        '本机后端已经启动了，但它没有读到 API Key。' +
        `（它找的位置是：${String(llm.keyFrom ?? '未知')}）`,
    }
  }

  const py = json.python ?? {}
  return {
    kind: 'ready',
    provider: String(llm.provider ?? ''),
    providerLabel: String(llm.providerLabel ?? ''),
    model: String(llm.model ?? ''),
    pythonOk: Boolean(py.ok),
    pythonDetail: String(py.detail ?? ''),
  }
}

/**
 * 把 fetch 抛出来的异常翻成人话。
 * ★ 超时和连不上要分开说 —— 一个要等，一个要去启动后端。
 * ★ 「连不上」那一句从这里返回的是【同一个常量】，不走这个函数另写一遍。
 * ★ 原来有个 `who` 参数，删了：唯一调用点传的就是「本机后端」，
 *   而一个能拼出别的名字的参数，只会在将来某次复用里静默地说出一句假话。
 */
function describeFetchFailure(e: unknown): string {
  const name = (e as { name?: string } | null)?.name
  if (name === 'TimeoutError' || name === 'AbortError') {
    return `本机后端没有在 ${PROBE_TIMEOUT_MS / 1000} 秒内回应。`
  }
  return BACKEND_DOWN_REASON
}

/* ---------------------------------------------------------------------------
   二、调大模型
   --------------------------------------------------------------------------- */

/** 后端规范化之后的一次模型响应。形状由 server/providers.mjs 的 pick() 决定。 */
export interface LlmResponse {
  content: string
  toolCalls: { id: string; name: string; argsRaw: string }[]
  reasoning: string | null
  finishReason: string | null
  provider: string
  providerLabel: string
  model: string
  ms: number
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    reasoningTokens: number
  }
}

/**
 * 把一段对话（可能带工具定义）发给大模型。
 *
 * ★ 请求体里【没有】model、没有 baseUrl、没有 provider —— 这三样一律由后端决定。
 *   不这么约束的话，任何网页都能诱导这个后端把你的 key 转发到它自己的服务器上去。
 *   所以这里连传都不传，后端那边也压根不读。
 */
export async function postLlm(req: {
  messages: unknown[]
  tools?: unknown[]
  jsonMode?: boolean
}): Promise<LlmResponse> {
  return postJson<LlmResponse>('/llm', req, LLM_TIMEOUT_MS, '大模型服务')
}

/* ---------------------------------------------------------------------------
   三、调 Python
   --------------------------------------------------------------------------- */

export interface PyResponse {
  ok: boolean
  ms: number
  result?: { task: string; columns: string[]; rows: Record<string, unknown>[]; rowCount: number }
  python?: { version?: string; pandas?: string; numpy?: string }
  error?: { code: string; message: string; detail?: string }
}

/**
 * 把数据 + 任务名交给本机真 Python 算。
 *
 * ★★★ 这个函数【绝不抛异常】，这是它和 postLlm 最要紧的区别。★★★
 *
 *   后端在 Python 算失败时回的是 `{ ok:false, error:{code,message,detail} }`，
 *   而 postJson 只要看到 body 里有 `error` 字段就【抛异常】。于是：
 *
 *     列名写错  →  抛 BackendError('NO_SUCH_COLUMN')  →  被 tools.ts 的 catch 接住
 *              →  变成 PY_UNREACHABLE「本机的 Python 工具连不上，请只用 SQL」
 *
 *   Python 精心准备的「现有列是：……」（它存在的唯一目的就是让模型自己改对）
 *   被夹在一句「连不上 + 别用 Python 了」里 —— 模型多半直接放弃。
 *   而「没装 Python」「列名写错」「算超时」这三件事，模型和用户要做的事完全不同。
 *
 *   所以这里自己兜住，把抛出来的异常【还原成后端本来那个响应形状】。
 *   这样 PyResponse 里声明了却从没被用到的 `error` 字段才真的有用，
 *   而且 tools.ts 里那条「Python 主动报错」的分支才不是死代码 ——
 *   否则任何「验一下这条错误路径」的断言都是永远不会红的假绿。
 *
 * ★ ms 记 0：失败时后端自己的耗时拿不到了（postJson 只抛出 code/message/detail）。
 *   工具记录上的耗时是 tools.ts 自己掐的表，不读这个字段，所以这里不是丢信息。
 *   要看真实耗时的话，做一次成功调用即可（成功那条走的是后端返回的 ms）。
 */
export async function postPy(req: {
  task: string
  rows: Record<string, unknown>[]
  params: Record<string, unknown>
}): Promise<PyResponse> {
  try {
    return await postJson<PyResponse>('/py', req, PY_TIMEOUT_MS, 'Python 分析工具')
  } catch (e) {
    if (e instanceof BackendError) {
      return { ok: false, ms: 0, error: { code: e.code, message: e.message, detail: e.detail } }
    }
    // postJson 只会抛 BackendError；真出了别的（代码写错），要让它冒出去，
    // 不能在这里吞掉 —— 吞掉的话一个编程错误会伪装成「Python 算不出来」。
    throw e
  }
}

/* ---------------------------------------------------------------------------
   四、统一的 POST
   --------------------------------------------------------------------------- */

/**
 * ★ 不管 HTTP 状态码是多少，都先读 body、认里面的 `error` 字段。
 *   后端的错误一律长成 `{ error: { code, message, detail } }`，
 *   `code` 才是要用来分支的东西 —— 光看状态码分不清
 *   「key 被拒」和「模型写的 SQL 有问题」。
 *   只看 res.ok 就抛一句「请求失败」，等于把已经拿到手的具体原因扔掉。
 */
async function postJson<T>(
  path: string,
  body: unknown,
  timeoutMs: number,
  who: string,
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    const name = (e as { name?: string } | null)?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new BackendError(
        'NETWORK_TIMEOUT',
        `${who}在 ${Math.round(timeoutMs / 1000)} 秒内没有回应。`,
      )
    }
    throw new BackendError('NETWORK_FAILED', `${who}连不上 —— 多半是后端已经关掉了。`)
  }

  const text = await res.text()
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new BackendError(
      'BAD_JSON',
      `${who}返回的不是合法 JSON（HTTP ${res.status}）。`,
      text.slice(0, 400),
    )
  }

  const err = (json as { error?: { code?: string; message?: string; detail?: string } }).error
  if (err) {
    throw new BackendError(
      err.code ?? 'UNKNOWN',
      err.message ?? `${who}返回了一个没有说明的错误。`,
      err.detail ?? '',
    )
  }

  if (!res.ok) {
    throw new BackendError(
      `HTTP_${res.status}`,
      `${who}返回了 HTTP ${res.status}，而且响应里没有错误说明。`,
    )
  }

  return json as T
}
