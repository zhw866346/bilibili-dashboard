/* 左侧导航栏。
   两种形态：
     大屏（≥1024px）：左边一竖条，固定不动
     小屏：变成顶部一条可以左右滑动的横向导航
   内容完全一样，只是摆放方向不同。 */

import { NavLink } from 'react-router-dom'
import { NAV_ITEMS } from '../navigation'

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 px-4 ${compact ? 'py-3' : 'py-5'}`}>
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand text-[14px] font-bold text-white">
        B
      </div>
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-semibold leading-tight text-ink">
          B站用户活跃度分析
        </div>
        <div className="truncate text-[11px] leading-tight text-ink-3">
          内容消费洞察 Dashboard
        </div>
      </div>
    </div>
  )
}

function NavList({ horizontal = false }: { horizontal?: boolean }) {
  return (
    <nav
      className={
        horizontal
          ? 'flex gap-1 overflow-x-auto px-3 pb-3'
          : 'flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-3'
      }
    >
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === '/'}
          className={({ isActive }) =>
            [
              'flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors',
              isActive
                ? 'bg-brand-soft text-brand-ink'
                : 'text-ink-2 hover:bg-plane hover:text-ink',
            ].join(' ')
          }
        >
          <span className="shrink-0">{item.icon}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

export default function Sidebar() {
  return (
    <>
      {/* 大屏：左侧固定栏 */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-hairline bg-card lg:flex">
        <Brand />
        <NavList />
        <div className="border-t border-hairline px-4 py-3">
          <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
            数据源：模拟业务数据
          </div>
        </div>
      </aside>

      {/* 小屏：顶部横向导航 */}
      <div className="sticky top-0 z-20 border-b border-hairline bg-card lg:hidden">
        <Brand compact />
        <NavList horizontal />
      </div>
    </>
  )
}
