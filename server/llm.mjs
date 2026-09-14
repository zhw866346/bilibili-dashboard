/* ==========================================================================
   调用大模型：转发 + 规范化 + 错误分类
   --------------------------------------------------------------------------
   ★ 这个文件只做一件事：把前端的请求转给大模型，把响应压成前端唯一认的形状。
     它【不懂】数据库、【不懂】业务口径、不存任何会话状态。

   ★ 为什么错误分类要做得这么细：
     用户看到的每一句话都不一样 —— 「没配 key」「key 被拒了」「网络不通」
     「服务限流了」是四个完全不同的故障，对应四种不同的处理办法。
     笼统地说一句「AI 服务暂时不可用」，等于把排查成本全推给用户。
   ========================================================================== */

import { getProvider, LlmError } from './providers.mjs'

/** 把 fetch 的异常翻成人话。网络层的失败和 HTTP 层的失败要分开说。 */
function classifyFetchError(e, timeoutMs) {
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
    return new LlmError('UPSTREAM_TIMEOUT', `大模型服务在 ${Math.round(timeoutMs / 1000)} 秒内没有响应。`)
  }
  return new LlmError(
    'UPSTREAM_UNREACHABLE',
    '连不上大模型服务（网络不通、或者被网络环境挡住了）。',
    String(e?.message ?? e),
  )
}

/** HTTP 状态码 → 错误码。每种都有不同的处理办法，所以不能合并。 */
function classifyStatus(status, body) {
  if (status === 401 || status === 403) {
    return new LlmError(
      'AUTH',
      'API Key 被大模型服务拒绝了。可能是 key 写错了、或者账号余额用完了。',
      body,
    )
  }
  if (status === 429) {
    return new LlmError('RATE_LIMIT', '请求太频繁，大模型服务限流了。等十几秒再试。', body)
  }
  if (status === 400) {
    // ★ 400 的响应体必须原样带出去。调提示词和工具定义的时候全靠它 ——
    //   实测就是靠这一条发现「传 tool_choice:'required' 会报 Thinking mode
    //   does not support this tool_choice」的。光看「400」猜不出来。
    return new LlmError(
      'BAD_REQUEST',
      // ★ 这句话原来只说了「这通常是提示词或工具定义的问题」——**不完整，而且会把人指错方向**。
      //   2026-09-12 的真故障正是第二种原因：我们自己拼消息时把一条带 tool_calls 的
      //   assistant 消息后面的 tool 回复漏掉了几条，与我们写的提示词毫无关系。
      //   照着原来那句话去翻提示词，会白翻半天。
      '大模型服务认为这次请求的格式不对（400）。可能是提示词或工具定义的问题，' +
        '也可能是本机这边拼消息时出的问题（比如一条带 tool_calls 的消息没配上对应的工具结果）。' +
        '下面是大模型服务的原话，以它为准。',
      body,
    )
  }
  return new LlmError('UPSTREAM_ERROR', `大模型服务返回了错误（HTTP ${status}）。`, body)
}

/**
 * 调一次大模型。
 *
 * @param {{ messages: unknown[], tools?: unknown[], jsonMode?: boolean }} req
 * @param {{ provider: string, model: string, apiKey: string, timeoutMs?: number }} cfg
 */
export async function callLlm(req, cfg) {
  if (!cfg.apiKey) {
    throw new LlmError(
      'NO_KEY',
      '后端没有读到 API Key。请检查 server/.env 里的 DEEPSEEK_API_KEY 那一行有没有填。',
    )
  }

  const p = getProvider(cfg.provider)
  const timeoutMs = cfg.timeoutMs ?? 60000
  const t0 = Date.now()

  let res
  try {
    res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'content-type': 'application/json', ...p.auth(cfg.apiKey) },
      body: JSON.stringify(
        p.buildBody({
          model: cfg.model,
          messages: req.messages,
          tools: req.tools,
          jsonMode: req.jsonMode,
        }),
      ),
    })
  } catch (e) {
    throw classifyFetchError(e, timeoutMs)
  }

  if (!res.ok) {
    // ★ 截断：上游错误页可能是整页 HTML，原样塞给前端会让页面很难看，
    //   而且会撑爆响应体。500 字足够看出问题。
    const body = (await res.text()).slice(0, 500)
    throw classifyStatus(res.status, body)
  }

  const json = await res.json()
  const picked = p.pick(json)
  const u = json.usage ?? {}

  return {
    ...picked,
    provider: p.id,
    providerLabel: p.label,
    model: cfg.model,
    ms: Date.now() - t0,
    usage: {
      promptTokens: u.prompt_tokens ?? 0,
      completionTokens: u.completion_tokens ?? 0,
      totalTokens: u.total_tokens ?? 0,
      /** 思考模式下才有的：推理占掉的 token（计入 completion）。 */
      reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
    },
  }
}

/**
 * 列出该账号真实可用的模型。
 *
 * ★ 存在的理由是「不猜模型名」：实测发现账号里根本没有 `deepseek-v4-flash`
 *   这个名字（只有 deepseek-flash / deepseek-v4-pro），照文档猜会直接失败。
 *   后端启动时调一次，把真实可用的模型打进日志。
 */
/**
 * 列一次这个账号真实可用的模型。
 *
 * ★ 2026-09-12 改：返回 `{ ok, ids, error }`，不再只返回一个数组。
 *   原来调用方（启动日志）拿不到「为什么没有」，只能闭嘴 —— 于是出现了一种
 *   最难查的故障：后端起来了、窗口看着一切正常、一条模型都没打，
 *   用户以为没事，第一次提问才失败。
 *   **窗口不说话 ≠ 一切正常**；这个项目里，窗口不说话恰恰是最难查的一种故障。
 *
 * ★ error 复用【已有的】两个分类器（classifyFetchError / classifyStatus），
 *   不另写一套说法：同一件事在 /api/llm 里和启动日志里必须说同一句话。
 * ★ 只有一个调用方（server/index.mjs 的启动日志），所以改形状是安全的。
 */
export async function listModels(cfg) {
  const p = getProvider(cfg.provider)
  let res
  try {
    res = await fetch(`${p.baseUrl}/models`, {
      signal: AbortSignal.timeout(15000),
      headers: { ...p.auth(cfg.apiKey) },
    })
  } catch (e) {
    return { ok: false, ids: [], error: classifyFetchError(e, 15000) }
  }
  if (!res.ok) {
    let body = ''
    try {
      body = await res.text()
    } catch {
      /* 读不出来也不影响分类 —— classifyStatus 只用到状态码，body 是附带线索。 */
    }
    return { ok: false, ids: [], error: classifyStatus(res.status, body) }
  }
  let json
  try {
    json = await res.json()
  } catch {
    return { ok: false, ids: [], error: new LlmError('BAD_JSON', '模型列表不是合法 JSON。') }
  }
  return { ok: true, ids: (json.data ?? []).map((m) => m.id).filter(Boolean), error: null }
}

/**
 * ★ 「接口通了，但一个模型都没有」这句话。
 *   它和上面那些【不是一回事】：那些是「问不到」，这一种是「问到了、答案是空」。
 *   要做的事也不同（前者查网络/key，后者查额度），所以不并进 classify*。
 */
export const NO_MODELS_NOTE =
  '大模型接口通了，但这个账号下一个可用模型都没有 —— 多半是这把 key 没有额度、或者账号欠费。'
