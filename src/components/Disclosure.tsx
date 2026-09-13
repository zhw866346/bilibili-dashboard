/* ==========================================================================
   通用折叠区（一条标题栏 + 一块可以收起来的正文）
   --------------------------------------------------------------------------
   AI 分析助手页是第一个消费者：用一个总开关把「第 1–4 步 + 代码」收起来，
   让想看结论的人不必滚过整条链路。

   ★ 收起来的内容用 display:none，不用 {open && children}。这是这个文件里
     最重要的一条决定，理由是【验收覆盖】：
       写成条件挂载，被收起来的那部分在服务端渲染的 HTML 里就彻底消失了。
       而项目那套「逐页渲染一遍」的检查正是靠渲染一遍、查脏字符和
       组件树有没有炸来兜底的。那样一来第 1–4 步就成了检查照不到的死角 ——
       【测试全绿，而一展开就崩】，这是最难查的一种故障。
       用 display:none，内容始终在 DOM 里，检查照得到，只是不显示。

   ★ ⚠️ 不要把带 Recharts 图表的东西放进这个区域。
     图表用 ResponsiveContainer 自适应宽度，而 display:none 的容器量到的宽度是 0，
     画出来会是一片空白（而且要等一次 resize 才恢复）。
     AI 页因此把「第 5 步：得到分析结果」留在了折叠区外面。

   ★ 折叠状态【不记进 localStorage、不读 window】。
     这个项目要把打包产物双击打开也能用，而且命令行里要在 Node 下渲染这一页
     （Node 里没有 window，读了会直接抛异常）。所以默认状态就是一个写死的常量。
   ========================================================================== */

import { useId, useState, type ReactNode } from 'react'

/**
 * 折叠区刚打开时是展开的吗？
 *
 * ★ 这是本页唯一一处「默认状态」的落地处，改这一行就能翻盘。
 *   当前是【展开】：这一页的立页初衷就是证明「分析链路是真的」，
 *   打开第一眼就看到整条链路才说服得了人；而且首屏那几秒正在建库，
 *   过程展开时屏幕上满是真内容（归一化的问句、命中的关键词权重、SQL 原文），
 *   收起来就只剩一张等数据的图。
 */
export const PROCESS_FOLD_DEFAULT_OPEN = true

/** 开关上那两个字。本机检查靠它反查默认状态，不手抄。 */
export const FOLD_TOGGLE_TEXT = { open: '收起', closed: '展开' } as const

interface DisclosureProps {
  /** 标题栏左边的说明，例如「查看分析过程」 */
  label: string
  /** 标题右边那行小字。★ 必须由调用方从数据派生，不要另写一套文案 */
  hint?: string
  defaultOpen?: boolean
  children: ReactNode
}

export default function Disclosure({
  label,
  hint,
  defaultOpen = PROCESS_FOLD_DEFAULT_OPEN,
  children,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen)

  /* useId 是 React 19 的 SSR 安全 API。不用 Math.random() 做 id ——
     服务端和客户端两次渲染会算出不同的值，对不上。 */
  const id = useId()

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-hairline bg-card px-4 py-3 text-left transition-colors hover:border-ink-3"
      >
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-semibold text-ink">{label}</span>
          {hint && (
            <span className="text-[11.5px] leading-relaxed text-ink-3">{hint}</span>
          )}
        </span>
        <span className="shrink-0 rounded-md border border-hairline px-2 py-1 text-[11px] font-medium text-ink-3">
          {open ? FOLD_TOGGLE_TEXT.open : FOLD_TOGGLE_TEXT.closed}
        </span>
      </button>

      {/* ★ 正文区【不套边框】：里面放的是 StepCard，再套一层就成了「卡中卡」。
          里面那几张卡自己负责自己的外框。

          data-fold-body / data-fold-end 是给命令行检查用的两个锚点，别删：
          「折叠区到底包住了哪几步」只能从渲染结果里量出来，
          靠标题文字的位置去猜太脆，而且改一次文案就假红。 */}
      <div id={id} data-fold-body className={open ? 'flex flex-col gap-3' : 'hidden'}>
        {children}
      </div>
      <span data-fold-end className="hidden" />
    </div>
  )
}
