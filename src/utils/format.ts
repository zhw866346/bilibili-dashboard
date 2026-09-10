/* ==========================================================================
   数字格式化工具
   --------------------------------------------------------------------------
   数据在计算机里是一个「裸数字」（比如 12380），
   但人看的时候需要变成「1.24亿」这种能一眼读懂的样子。
   这个文件专门负责这个转换，避免每个页面各写一套。
   ========================================================================== */

/**
 * 把「原始个数」格式化成好读的中文数量。
 *
 * 注意传进来的必须是真实个数，不是「多少万」。
 *   6000      -> "6,000"
 *   12380     -> "1.24万"
 *   124000000 -> "1.24亿"
 */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e8) return `${(n / 1e8).toFixed(2)}亿`
  if (abs >= 1e4) return `${(n / 1e4).toFixed(2)}万`
  return Math.round(n).toLocaleString('zh-CN')
}

/** 给数字加千位分隔符，例如 128600 -> "128,600" */
export function withThousands(n: number): string {
  return n.toLocaleString('zh-CN')
}

/** 整数百分比，例如 12.34 -> "12.3%" */
export function formatPercent(v: number, decimals = 1): string {
  return `${v.toFixed(decimals)}%`
}

/** 分钟，例如 48.6 -> "48.6 分钟" */
export function formatMinutes(v: number, decimals = 1): string {
  return `${v.toFixed(decimals)} 分钟`
}

/** 涨跌幅，带正负号，例如 3.2 -> "+3.2%"   -0.6 -> "-0.6%" */
export function formatDelta(v: number, decimals = 1): string {
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(decimals)}%`
}

/**
 * 毫秒。★ 屏幕上凡是显示耗时的地方一律走它。
 *
 * ★ 为什么非有它不可（2026-09-12 用户截图上抓到的）：
 *   浏览器掐表用的是 `performance.now()`，差出来的是浮点数，直接打印就是
 *   `339.39999999985099 ms` —— 用户会以为这是某种精确到小数点后十四位的测量，
 *   实际只是浮点误差。单位是毫秒，小数点后的位数没有任何意义。
 *
 * ★ 这个写法不是新定的：SQL 页从第一天起就是 `SqlCaseCard.tsx:73` 那一句
 *   `result.ms < 1 ? '<1' : Math.round(result.ms)`。这里只是把同一个规矩
 *   抽成一个函数、补到 AI 助手页那 6 处上去。`<1` 那一档逐字照抄，不另立规矩。
 */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return '—'
  return ms < 1 ? '<1' : String(Math.round(ms))
}
