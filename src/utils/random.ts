/* ==========================================================================
   固定种子的随机数
   --------------------------------------------------------------------------
   为什么不用 Math.random()？
   因为 Math.random() 每次刷新页面结果都不一样——今天看到 DAU 是 2,431，
   刷新一下变成 2,388，你会以为程序有 bug，也没法核对数字。

   这里用一个「固定种子」的算法：只要种子不变，每次生成的"随机"数列完全一样。
   所以页面每次刷新，数据都是同一套，数字可以复现、可以核对。

   算法本身用的是 mulberry32，一个很短小、够用的小工具，
   你不需要看懂里面的位运算，只要知道：同一个种子 → 同一串数字。
   ========================================================================== */

export type Random = () => number

/** 创建一个随机数生成器。同样的 seed 永远产生同样的序列。 */
export function createRandom(seed: number): Random {
  let a = seed >>> 0
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 返回 [min, max] 之间的整数（含两端） */
export function randInt(rng: Random, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

/** 返回 [min, max] 之间的小数 */
export function randFloat(rng: Random, min: number, max: number): number {
  return min + rng() * (max - min)
}

/** 以 p 的概率返回 true */
export function chance(rng: Random, p: number): boolean {
  return rng() < p
}

/**
 * 按权重挑一个选项。
 * 例如 pickWeighted(rng, [{value:'A', weight:3}, {value:'B', weight:1}])
 * 那么 A 被选中的概率是 75%，B 是 25%。
 */
export function pickWeighted<T>(rng: Random, items: { value: T; weight: number }[]): T {
  let total = 0
  for (const item of items) total += item.weight

  let r = rng() * total
  for (const item of items) {
    r -= item.weight
    if (r <= 0) return item.value
  }
  // 兜底：浮点误差时返回最后一个
  return items[items.length - 1].value
}

/**
 * 生成一个「泊松分布」附近的小整数，用来表示"一个用户一天看了几个视频"。
 * 大多数天看 1-3 个，偶尔看很多——这比直接用均匀随机更接近真实行为。
 */
export function poissonish(rng: Random, mean: number): number {
  // 简单做法：累加指数间隔直到超过 mean，等价于一个泊松过程的到达计数
  let count = 0
  let sum = 0
  const limit = Math.exp(-mean)
  let product = rng()
  while (product > limit && count < 60) {
    count++
    product *= rng()
    sum++
    if (sum > 60) break
  }
  return count
}
