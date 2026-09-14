/* ==========================================================================
   大模型供应商适配表
   --------------------------------------------------------------------------
   ★ 换大模型只改这一个文件。前端只认一种规范的响应形状（就是 OpenAI 那个），
     所以换供应商对前端、对 UI、对提示词都是零影响。

   ★ 为什么要有这张表，而不是把参数直接写在调用处：
     三家的差异虽然小，但【会变】—— 端点、参数名、哪些参数会报错，
     都随模型版本变。散在代码里就是「改一处漏一处，而且不报错」。

   ★ 这里只放【适配】，不放任何业务逻辑。
     口径、提示词、工具定义全在前端 src/data/ai/llm/ 里 —— 那边有 tsc 和
     本机那批检查两层保护，这个文件没有（.mjs 绕开了 tsconfig）。所以它必须薄。
   ========================================================================== */

/** 后端抛给前端的错误。code 是给程序判断的，message 是可以直接显示给人看的中文。 */
export class LlmError extends Error {
  constructor(code, message, detail = '') {
    super(message)
    this.name = 'LlmError'
    this.code = code
    /** 上游原话（截断过）。调提示词的时候全靠它 —— 光看 code 猜不出哪里写错了。 */
    this.detail = detail
  }
}

/* --------------------------------------------------------------------------
   一、DeepSeek（默认）
   --------------------------------------------------------------------------
   ★ 下面这几条是【2026-09-12 实测】的结果，不是抄文档的。改动前请重新实测：

     1. 账号真实可用的模型是 `deepseek-flash` 和 `deepseek-v4-pro`。
        没有叫 `deepseek-v4-flash` 的东西 —— 猜模型名会直接 404。
        新增模型时先跑 GET /v1/models 列一遍，别猜。

     2. tool_choice 传 'required' 会 HTTP 400：
        {"error":{"message":"Thinking mode does not support this tool_choice"}}
        所以【本文件永远不传 tool_choice】。'auto' 本来就是默认值。

     3. 模型是思考模式：每次响应都带 reasoning_content（推理原文）。
        实测「哪个年龄段DAU最高」这一问，模型第一步会自己
        `SELECT * FROM video_views LIMIT 5` 去探表结构 ——
        这是正常且值得展示的行为（第 1 步的「模型怎么理解问题」就是它）。

     4. tool_calls[].function.arguments 是 JSON 字符串（标准 OpenAI 形状），
        不是对象。且模型偶尔会吐出不合法的 JSON —— 那不是异常，是正常分支，
        处理它的地方在 src/data/ai/llm/tools.ts。
   -------------------------------------------------------------------------- */
const deepseek = {
  id: 'deepseek',
  label: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com/v1',
  defaultModel: 'deepseek-flash',
  /** 把 config 里的 key 变成请求头。每个供应商的写法可能不同，所以做成函数。 */
  auth: (key) => ({ authorization: `Bearer ${key}` }),

  buildBody: ({ model, messages, tools, jsonMode }) => ({
    model,
    messages,
    stream: false,
    // ★ 永远不传 tool_choice —— 见上面实测记录第 2 条。
    //   「强制模型给结构化输出」这件事不靠 tool_choice 做，
    //   靠【作答阶段干脆不给它任何工具】做（见 src/data/ai/llm/loop.ts）。
    ...(tools && tools.length ? { tools } : {}),
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
  }),

  /** 把供应商的响应压成前端唯一认的那种形状。 */
  pick: (json) => {
    const choice = json.choices?.[0] ?? {}
    const m = choice.message ?? {}
    return {
      content: m.content ?? '',
      toolCalls: (m.tool_calls ?? []).map((c, i) => ({
        id: c.id ?? `call_${i + 1}`,
        name: c.function?.name ?? '',
        argsRaw: c.function?.arguments ?? '{}',
      })),
      reasoning: m.reasoning_content ?? null,
      finishReason: choice.finish_reason ?? null,
    }
  },
}

/* --------------------------------------------------------------------------
   二、智谱 GLM / Moonshot Kimi
   --------------------------------------------------------------------------
   ★ 这两个【尚未实测】—— 只是照 OpenAI 兼容形状写出来的骨架，
     用来证明「换供应商确实只改这一个文件」这件事成立。
     真要用的时候，先按 DeepSeek 那三条的方式实测一遍再改注释。
   -------------------------------------------------------------------------- */
const zhipu = {
  ...deepseek,
  id: 'zhipu',
  label: '智谱 GLM',
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  defaultModel: 'glm-4-flash',
}

const moonshot = {
  ...deepseek,
  id: 'moonshot',
  label: 'Moonshot Kimi',
  baseUrl: 'https://api.moonshot.cn/v1',
  defaultModel: 'moonshot-v1-8k',
}

export const PROVIDERS = { deepseek, zhipu, moonshot }

export const DEFAULT_PROVIDER = 'deepseek'

/** 取一个供应商；名字不认识就抛错，不静默退回默认值（静默退回会让人以为配生效了）。 */
export function getProvider(id) {
  const p = PROVIDERS[id]
  if (!p) {
    throw new LlmError(
      'BAD_PROVIDER',
      `不认识的供应商「${id}」。可选：${Object.keys(PROVIDERS).join(' / ')}`,
    )
  }
  return p
}
