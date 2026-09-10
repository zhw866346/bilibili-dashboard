/* 总框架。
   负责三件事：
     1. 摆好「左侧导航 + 右侧内容」的版式
     2. 顶部显示当前页面的标题和说明
     3. 决定点了导航之后显示哪个页面 */

import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import Disclaimer from './components/Disclaimer'
import Sidebar from './components/Sidebar'
import { NAV_ITEMS } from './navigation'

export default function App() {
  const location = useLocation()

  // 根据当前网址，找到对应的导航项，用来显示页面标题
  const current = NAV_ITEMS.find((item) => item.path === location.pathname) ?? NAV_ITEMS[0]

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar />

      <main className="min-w-0 flex-1">
        <header className="border-b border-hairline bg-card px-5 py-4 sm:px-7 sm:py-5 lg:sticky lg:top-0 lg:z-10">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <h1 className="text-[19px] font-semibold tracking-tight text-ink">{current.label}</h1>
            <span className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-ink-3">
              {current.sub}
            </span>
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{current.purpose}</p>
        </header>

        <div className="flex flex-col gap-4 px-5 py-5 sm:px-7 sm:py-6">
          {/* 每一页都能看到「这是模拟数据」的说明 */}
          <Disclaimer />

          {/* key 用当前网址：切换页面时重新挂载，触发一次极轻的淡入 */}
          <div key={location.pathname} className="animate-fade-up">
            <Routes>
              {NAV_ITEMS.map((item) => (
                <Route key={item.path} path={item.path} element={item.element} />
              ))}
              {/* 网址写错时，回到首页 */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </div>
      </main>
    </div>
  )
}
