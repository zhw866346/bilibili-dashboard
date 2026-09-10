/* 整个程序的「入口」——浏览器加载页面后，从这里开始执行。 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './index.css'

// 为什么要用 HashRouter 而不是更常见的 BrowserRouter？
// 因为 HashRouter 打包后可以直接双击 index.html 打开（网址里会多个 # 号），
// 不需要先架一个服务器。对"双击图标就能看"这种验收方式更友好。

const container = document.getElementById('root')
if (!container) throw new Error('找不到 id="root" 的容器，请检查 index.html')

createRoot(container).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
