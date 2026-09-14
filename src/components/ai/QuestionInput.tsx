/* ==========================================================================
   提问区：输入框 + 示例问题 + 时间窗口 + 开始分析
   --------------------------------------------------------------------------
   ★ 示例问题为什么五条全都摆出来，包括还没实现的？
     因为只显示"能答的"，等于让人以为问什么都能答。
     把没实现的也摆出来、点下去如实说"这一类还没做"，
     比藏起来更可信 —— 也让"已经做了哪几类"这件事可枚举。

   ★ 时间窗口为什么不用下拉框？
     只有三个选项，摊开来一眼看全，还省一次点击。
     这个分段控件的样式照抄 ChartCard 里的「图表 / 表格」切换，保持一致。
   ========================================================================== */

import { useState, type KeyboardEvent } from 'react'

import { DEMO_QUESTIONS } from '../../data/ai/demos'
import type { DemoQuestion } from '../../data/ai/demos'
import { RANGES } from '../../data/ai/demos'

/**
 * 按钮上那四种字。
 *
 * ★ 只在这里落地一次。页面别处要说「点一下开始分析」的时候（比如「切了时间窗口
 *   但结果还是旧的」那条提示、下面示例区的引导语）必须调 submitLabel()，
 *   不能自己写死 —— 否则会出现「按钮上写着『重新分析』、提示里让你点『开始分析』」
 *   这种自相矛盾。
 */
export const SUBMIT_LABEL = {
  busy: '分析中…',
  first: '开始分析',
  again: '重新分析',
  /**
   * ★ 2026-09-12 加的第四种（用户拍板）。
   *   这一轮走的是规则路径、而后端【接得上】—— 这时同一个按钮点下去
   *   其实会切回大模型，但它的字写着「重新分析」，完全看不出这一点。
   *   ★ 不新增按钮：点了还是同一件事（重跑当前输入框里那句、不带 forceRule），
   *     只是把「它会干什么」写出来。
   */
  againWithLlm: '用大模型重新跑一遍',
} as const

/**
 * ★ canUpgrade 的默认值是 `false` —— 这是最诚实的默认：
 *   「没有第二条路可切」比「有」更保守，写不出来的时候不许替用户打包票。
 */
export function submitLabel(
  busy: boolean,
  hasResult: boolean,
  canUpgrade = false,
): string {
  if (busy) return SUBMIT_LABEL.busy
  if (!hasResult) return SUBMIT_LABEL.first
  return canUpgrade ? SUBMIT_LABEL.againWithLlm : SUBMIT_LABEL.again
}

/**
 * 示例区那一行引导语。
 *
 * ★ 两件事都写在这一个函数里：
 *   1. 「只是示例，不是能问的全部」—— 2026-09-12 用户问「只能使用示例里面的」，
 *      而在这之前全页没有一个字说过这 5 条只是示例。
 *   2. 里面那个按钮名【从 submitLabel 取】，不写死 —— 按钮显示
 *      「用大模型重新跑一遍」时，引导语里还写着「再点『开始分析』」就是自相矛盾。
 */
export function demoLead(hasResult: boolean, canUpgrade: boolean): string {
  return (
    '试试这几条 —— 只是示例，不是能问的全部；点一下会填进输入框，再点「' +
    `${submitLabel(false, hasResult, canUpgrade)}」：`
  )
}

interface QuestionInputProps {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  days: number
  onDays: (d: number) => void
  busy: boolean
  /**
   * 已经跑出过一份结果了吗。
   * ★ 注意「跑失败」也算跑过（失败也会产出一份带说明的轨迹），
   *   所以失败之后按钮显示「重新分析」是对的 —— 那条路本来就是再跑一次。
   */
  hasResult: boolean
  /**
   * 这一轮没走大模型、而后端接得上吗（`canSwitchToLlm(probe, trace)`）。
   * ★ 它只是一个【显示提示】：不改变点击的行为，只决定按钮上的字实不实。
   */
  canUpgrade?: boolean
}

export default function QuestionInput({
  value,
  onChange,
  onSubmit,
  days,
  onDays,
  busy,
  hasResult,
  canUpgrade = false,
}: QuestionInputProps) {
  /* 鼠标悬停 / 键盘聚焦哪一条示例。只影响那一张卡片的说明文字是否显示。 */
  const [active, setActive] = useState<string | null>(null)

  function pick(q: DemoQuestion) {
    onChange(q.question)
    setActive(q.id)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    /* 回车即提交。中文输入法组合期间的回车不算提交——
       否则「拼音打一半按回车选字」会直接触发分析。 */
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <section className="rounded-xl border border-hairline bg-card p-4 sm:p-5">
      <div className="flex flex-col gap-2.5 sm:flex-row">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="用一句话提问，例如：为什么最近用户活跃度下降？"
          className="min-w-0 flex-1 rounded-lg border border-hairline bg-plane/40 px-3.5 py-2.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-brand focus:bg-card"
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy}
          className="shrink-0 rounded-lg bg-ink px-5 py-2.5 text-[13px] font-medium text-white transition-opacity disabled:opacity-50"
        >
          {submitLabel(busy, hasResult, canUpgrade)}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] text-ink-3">时间窗口</span>
        <div className="flex rounded-md border border-hairline p-px">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              onClick={() => onDays(r.days)}
              className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                days === r.days ? 'bg-ink text-white' : 'text-ink-3 hover:text-ink-2'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-ink-3">
          与首页、SQL 页同一个口径（同一个函数算出来的）
        </span>
      </div>

      <div className="mt-4 border-t border-hairline pt-3">
        <p className="text-[11.5px] text-ink-3">{demoLead(hasResult, canUpgrade)}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {DEMO_QUESTIONS.map((q) => (
            <button
              key={q.id}
              type="button"
              onClick={() => pick(q)}
              onMouseEnter={() => setActive(q.id)}
              onMouseLeave={() => setActive(null)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] transition-colors ${
                value === q.question
                  ? 'border-brand bg-brand-soft text-brand-ink'
                  : 'border-hairline text-ink-2 hover:border-ink-3'
              }`}
            >
              <span>{q.question}</span>
              <span
                className={`rounded px-1.5 py-px text-[10px] font-semibold ${
                  q.implemented
                    ? 'bg-up/10 text-up'
                    : 'bg-plane text-ink-3'
                }`}
              >
                {q.implemented ? '完整演示' : '规划中'}
              </span>
            </button>
          ))}
        </div>
        {active && (
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink-2">
            {DEMO_QUESTIONS.find((q) => q.id === active)?.purpose}
          </p>
        )}
      </div>
    </section>
  )
}
