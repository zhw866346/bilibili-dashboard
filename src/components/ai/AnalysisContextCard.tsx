/* ==========================================================================
   「这一轮在分析什么」卡片
   --------------------------------------------------------------------------
   ★ 这张卡片存在的理由，一句话：
     「他们最喜欢什么内容」里的「他们」到底被理解成了谁 —— 必须看得见。

   多轮对话最危险的失败形状不是答错，而是**答得头头是道、但答的不是你问的那个**：
     你问「他们最喜欢什么内容」，模型把「他们」理解成了全站用户，
     然后一本正经地给出一份全站内容偏好分析。
   语法通顺、数字有出处、核对器全绿 —— **没有任何东西会报错**。
   唯一的防线就是：把「它认为你在说谁」摆出来，让人一眼看出来。

   ★ 三个字段的取值来源必须分开标注（模型申报 / 继承上一轮 / 来自窗口）：
     它们可信程度完全不同。前两个混在一起显示，用户会以为全是模型说的，
     而「继承上一轮」那一档恰恰是可能出错的那一档。

   ★ 这张卡片【不参与任何判断】，它只是把已经算好的东西画出来。
     任何形如「如果卡片上写着什么，就怎样怎样」的逻辑都不许加到这里来 ——
     上下文在那个方向上会变成一份没人验证过的控制流。
   ========================================================================== */

import type { ContextField, ContextOrigin, LlmRunDetail } from '../../data/ai/llm/types'

/** 卡片标题。导出给脚本断言，不在 JSX 里手写第二份。 */
export const CONTEXT_TITLE = '这一轮在分析什么'

/** 每一行的中文标签。★ 用 Record<ContextField, …>：
 *  以后往 ContextField 里加一个字段而不在这里补标签，是**编译错误**，
 *  不会出现「加了个字段、卡片上静静少一行」。 */
export const CONTEXT_FIELD_LABEL: Record<ContextField, string> = {
  topic: '分析对象',
  segment: '用户群体',
  comparedWith: '对比对象',
  metric: '指标',
  timeRangeText: '时间范围',
  previousFinding: '上一轮的结论',
}

/** 每个字段的来源怎么说。★ 同样钉成 Record，加第四态不补是编译错误。 */
export const CONTEXT_ORIGIN_LABEL: Record<ContextOrigin, string> = {
  llm: '模型申报',
  inherited: '继承上一轮',
  window: '来自窗口',
}

/** 一行都没申报时说的话。抽成常量，脚本逐字断言。 */
export const CONTEXT_EMPTY_NOTE =
  '这一轮模型没有申报它在分析什么 —— 下面只有时间范围，那是我们按本次真实窗口填的。'

/** 上一轮的限定被丢掉时说的话。 */
export const CONTEXT_DROPPED_LEAD = '这一轮换了分析对象，所以上一轮带过来的这些限定没有跟过来：'

/** 卡片底部那段解释。 */
export const CONTEXT_FOOT_NOTE =
  '★ 上下文只做两件事：给模型读、给你看。它【不参与任何判断】—— ' +
  '这一页里没有一处「如果问题里出现某个词就……」的分支，' +
  '「他们」是谁是模型读了上面那段历史之后自己判断的。'

/** 字段的显示顺序。★ 写死一份，不依赖对象键的顺序（那个顺序是运行时定的）。 */
const FIELD_ORDER: ContextField[] = [
  'topic',
  'segment',
  'comparedWith',
  'metric',
  'timeRangeText',
  'previousFinding',
]

function filled(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== ''
}

export function AnalysisContextCard({ detail }: { detail: LlmRunDetail }) {
  const out = detail.contextOut
  const inn = detail.contextIn

  const rows = FIELD_ORDER.filter((f) => filled(out[f]))
  const dropped = FIELD_ORDER.filter((f) => filled(inn[f]) && !filled(out[f]))

  /* 只有时间范围那一行时，说明模型什么都没申报 —— 那句解释必须出现，
     否则读者会以为「分析对象」这一行是被截掉了。 */
  const onlyWindow = rows.length === 1 && rows[0] === 'timeRangeText'

  return (
    <div className="rounded-lg border border-hairline bg-plane/40 px-3.5 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <p className="text-[11px] font-semibold text-ink-3">{CONTEXT_TITLE}</p>
        {/* ★ 这一句不是废话：不说的话，用户会分不清这张卡描述的是
            「我刚才那一问」还是「整个会话至今」—— 而它是【这一轮】的。
            下一轮里「分析对象」变成别的东西时，这张卡会跟着变。 */}
        <p className="text-[10.5px] text-ink-3">（说的是【这一轮】，不是整个会话）</p>
      </div>

      {onlyWindow && (
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">{CONTEXT_EMPTY_NOTE}</p>
      )}

      <dl className="mt-2 flex flex-col gap-1.5">
        {rows.map((f) => {
          const origin: ContextOrigin = detail.contextOrigins[f] ?? 'llm'
          return (
            <div key={f} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2.5">
              <dt className="w-24 shrink-0 text-[11.5px] text-ink-3">{CONTEXT_FIELD_LABEL[f]}</dt>
              <dd className="flex flex-wrap items-baseline gap-1.5 text-[12.5px] leading-relaxed text-ink-2">
                <span>{out[f]}</span>
                <span
                  className={
                    origin === 'llm'
                      ? 'rounded bg-brand-soft px-1.5 py-0.5 text-[10.5px] font-medium text-brand-ink'
                      : 'rounded bg-plane px-1.5 py-0.5 text-[10.5px] font-medium text-ink-3'
                  }
                >
                  {CONTEXT_ORIGIN_LABEL[origin]}
                </span>
              </dd>
            </div>
          )
        })}
      </dl>

      {/* ★ 换话题时被丢掉的限定也要说出来。
          不说的话，用户会以为「18-24 岁」还在上下文里 ——
          而这一轮的结论其实是全站的，读的人会自己把两者接起来。 */}
      {dropped.length > 0 && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-2">
          <strong className="font-semibold text-ink">{CONTEXT_DROPPED_LEAD}</strong>
          {dropped
            .filter((f) => f !== 'timeRangeText')
            .map((f) => `${CONTEXT_FIELD_LABEL[f]}「${inn[f]}」`)
            .join('、')}
          。它们不再适用于现在这个问题。
        </p>
      )}

      {/* ★ 历史被裁掉时必须说出来。
          ★ 这一段【必须真的渲染出来】—— 不许只是算好了挂在 detail 上。
            第一版就是这样：loop.ts 老老实实算出了 historyNote，页面上却一个字没显示。
            那是最坏的一种「如实」：数据层做对了、用户看不到，等于静默截断，
            而且谁也不报错。 */}
      {detail.historyNote && (
        <p className="mt-2 rounded border border-hairline bg-plane px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-2">
          {detail.historyNote}
        </p>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">{CONTEXT_FOOT_NOTE}</p>
    </div>
  )
}

export default AnalysisContextCard
