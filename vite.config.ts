import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Vite 是这个项目的「打包+开发服务器」工具。
// 你只需要知道两件事：
//   npm run dev   -> 启动开发模式，改代码浏览器自动刷新
//   npm run build -> 生成可以发布出去的成品文件（dist 文件夹）

/* --------------------------------------------------------------------------
   把 /api 转给本机后端
   --------------------------------------------------------------------------
   为什么要这一条，而不是让页面直接去调 http://127.0.0.1:8787：

     1. 页面里写相对路径 `/api/...`，那么「开发时走代理、打包后走 file://」
        两边用的是同一份代码，不用维护两个地址。
     2. 直接写绝对地址的话，浏览器会认为这是【跨域】请求（页面在 5173、
        后端在 8787），要多处理一轮跨域预检；走代理就没有这回事。

   ★ 不加这一条，大模型那一整条路径的界面是【死代码】：
     开发服务器会对 /api/health 回一个 404，于是页面永远探不到后端、
     永远显示「本页没有接入大模型」—— 后端明明在跑，页面却说他没启动。
     而这件事不报错，只是安安静静地降级。

   ★ changeOrigin 保持 false（默认值，这里写出来是为了让它显式可见）：
     它改的是 Host 头。而后端的 Origin 白名单认的是【浏览器原样发过来的
     Origin】，走代理时那个头也是原样透传的（localhost:5173 在白名单里）。
     把 changeOrigin 改成 true 会让 Host 变成 127.0.0.1:8787，
     虽然今天不影响这条白名单，但会让「请求到底是谁发的」变得看不出来 ——
     而这个项目里，「诚实」具体到每一个头都不该被悄悄改写。
   -------------------------------------------------------------------------- */

const BACKEND = 'http://127.0.0.1:8787'

const apiProxy = {
  '/api': {
    target: BACKEND,
    changeOrigin: false,
  },
}

export default defineConfig({
  // base: './' 让打包出来的文件用「相对路径」找资源，
  // 好处是直接双击 dist/index.html 也能打开，不用架服务器。
  // ★ 不要动它。代理和它是两回事：代理只在 npm run dev / preview 时存在，
  //   双击 dist/index.html（file://）时没有服务器，浏览器也不允许
  //   那种页面访问本机端口 —— 那条路会如实降级，页面上会说明原因。
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // 启动后自动帮你打开浏览器
    open: true,
    proxy: apiProxy,
  },
  // preview 是「打包完之后本地预览一下」用的，端口默认 4173。
  // 它同样需要转发，否则 npm run preview 下这一页也连不上后端。
  // （4173 已经在后端的 Origin 白名单里。）
  preview: {
    proxy: apiProxy,
  },
})
