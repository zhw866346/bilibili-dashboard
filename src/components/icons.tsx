/* 侧边栏用的图标。
   全部是内联 SVG，不依赖任何第三方图标库——少一个依赖，少一份体积和维护成本。 */

interface IconProps {
  className?: string
}

function Svg({ className = 'h-[18px] w-[18px]', children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** 首页概览 */
export function IconOverview(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 10.2 12 3.5l9 6.7" />
      <path d="M5.6 9.2V20h12.8V9.2" />
      <path d="M9.9 20v-5.3h4.2V20" />
    </Svg>
  )
}

/** 用户分析 */
export function IconUsers(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15.5 20v-1.6a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20" />
      <circle cx="9.25" cy="7.6" r="3.1" />
      <path d="M21 20v-1.6a4 4 0 0 0-3-3.86" />
      <path d="M15.4 4.7a4 4 0 0 1 0 6.2" />
    </Svg>
  )
}

/** 内容分析 */
export function IconContent(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M10.3 9.3v5.4l4.4-2.7z" />
    </Svg>
  )
}

/** 用户 × 内容 */
export function IconCross(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9.2" cy="9.2" r="5.4" />
      <circle cx="14.8" cy="14.8" r="5.4" />
    </Svg>
  )
}

/** SQL 分析 */
export function IconSql(props: IconProps) {
  return (
    <Svg {...props}>
      <ellipse cx="12" cy="6" rx="7.2" ry="2.9" />
      <path d="M4.8 6v12c0 1.6 3.22 2.9 7.2 2.9s7.2-1.3 7.2-2.9V6" />
      <path d="M4.8 12c0 1.6 3.22 2.9 7.2 2.9s7.2-1.3 7.2-2.9" />
    </Svg>
  )
}

/** Python 分析 */
export function IconPython(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m9 8.5-4 3.5 4 3.5" />
      <path d="m15 8.5 4 3.5-4 3.5" />
    </Svg>
  )
}

/** AI 分析助手：对话气泡里带一条上升的折线——「提问 + 分析」。 */
export function IconAi(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20.4 12.6c0 3.9-3.8 7.1-8.4 7.1a10 10 0 0 1-2.6-.34L4.6 21l1.1-3.4A6.9 6.9 0 0 1 3.6 12.6c0-3.9 3.8-7.1 8.4-7.1s8.4 3.2 8.4 7.1z" />
      <path d="m8.4 13.6 2.6-3.1 2.2 2.2 2.4-3.3" />
    </Svg>
  )
}
