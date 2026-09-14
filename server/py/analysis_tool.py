#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""==========================================================================
Python 分析工具
--------------------------------------------------------------------------
用法：把请求以 JSON 写进 stdin，结果以 JSON 从 stdout 读出来。

  echo '{"task":"pct_change","rows":[...],"params":{...}}' | python analysis_tool.py

★ 安全边界：这个脚本【不执行大模型写的任何代码】。
  大模型只能从下面 TASKS 里那 5 个写死的任务中选一个，再指定列名。
  这是在本机跑的进程，允许模型写代码 = 把整台机器交出去。

★ 为什么宁可用「闭集任务」这么笨的办法：
  这个工具要回答的问题（变化率、排名、趋势、分布）本来就是有限的几种。
  把它们的参数化，比开放一个代码执行沙箱简单得多、也安全得多 ——
  而且页面上「这是真 pandas 算的」这句话仍然成立。

★ 为什么这个文件值得存在（而不是在浏览器里用 JavaScript 算）：
  斜率用的是 numpy 最小二乘，分箱用的是 pd.cut ——
  这两件事正是「换一个工具」的意义所在，也正是面试时会问到的地方。
==========================================================================="""

import sys
import json

# ★ Windows 控制台默认是 GBK。三个流【都要设】，漏掉任何一个都会出问题：
#     stdout 不设 → 中文输出直接抛 UnicodeEncodeError
#     stderr 不设 → 报错信息里的中文变乱码，等于没法排查
#     stdin  不设 → ★最阴的一个：Node 写进来的是 UTF-8 字节，Python 按 GBK 解，
#                   而 GBK 几乎能解码任何字节序列，所以【不报错】，
#                   只是「游戏」静悄悄变成「娓告垙」、「科技」变成「绉戞妧」。
#                   这个 bug 是实测抓到的：只测 ASCII 数据（年龄档、数字）永远发现不了，
#                   一定要用中文分区名测一次。
#   项目里 scripts/analyze.py 踩过同一个坑的前两条。
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")
except Exception:
    pass


class TaskError(Exception):
    """带着【给大模型看的】中文理由。模型要能据此自己改对。"""

    def __init__(self, code, message, detail=""):
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail


# --------------------------------------------------------------------------
# 工具函数
# --------------------------------------------------------------------------

def to_records(df):
    """DataFrame → 一组可以直接 json.dumps 的记录。

    ★ 这是整个文件最容易踩的坑，所以单独抽出来并写清楚：

      不能用 json.dumps(df.to_dict("records"))，因为 pandas 的缺失值是
      float('nan')，而 Python 的 json 模块【默认会把它写成裸的 NaN】——
      那不是合法的 JSON，浏览器 JSON.parse 会直接报错、
      页面变成一片空白，而错误只在控制台里，页面上什么提示都没有。

      走 to_json 这一趟往返，pandas 自己会把 NaN 变成 null、
      numpy 的 int64 变成 int、时间戳变成字符串，一次全解决 ——
      比手写 astype(object).where(notna(), None) 可靠得多。
    """
    import pandas as pd  # noqa: F401

    return json.loads(df.to_json(orient="records", force_ascii=False, date_format="iso"))


def need_col(df, params, key):
    """取一个必填的列名，并确认它真的存在。

    ★ 错误消息里必须带上【现有列名】：模型看不到数据，只有这几个字能告诉它
      「你写错列名了，正确的应该在这里面选」。只说一句「列不存在」，
      模型下一轮还会写出同样的列名。
    """
    col = params.get(key)
    if not col:
        raise TaskError("MISSING_PARAM", f"参数「{key}」是必填的。")
    if col not in df.columns:
        raise TaskError(
            "NO_SUCH_COLUMN",
            f"数据里没有叫「{col}」的列。现有列是：{'、'.join(map(str, df.columns))}",
        )
    return col


def optional_col(df, params, key):
    """取一个【可选】的列名。给了就必须真的存在。

    ★ 原先是 `if group and group in df.columns` 这种写法兜住的 —— 列名写错时
      【不报错】，只是分组整个不生效，结果里少一列。
      模型拿到一张没有分组列的表，还以为自己分了组，然后据此写结论。
      这和 need_col 要防的是同一件事，区别只是这个参数可以不传。
    """
    col = params.get(key)
    if not col:
        return None
    if col not in df.columns:
        raise TaskError(
            "NO_SUCH_COLUMN",
            f"数据里没有叫「{col}」的列。现有列是：{'、'.join(map(str, df.columns))}",
        )
    return col


def as_int(params, key):
    """把参数里一个值取成 int；取不动就报 BAD_PARAM。

    ★ 一个也不能静默。原来直接写 int(params.get("bins"))，于是：
        "auto" → ValueError 一路冒到最外层，变成一段 pandas 内部堆栈（模型看不懂）
        5.5    → 静默截成 5
        True   → bool 是 int 的子类，静默变成 1
    """
    raw = params.get(key)
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise TaskError("BAD_PARAM", f"参数「{key}」必须是整数，收到的是 {raw!r}。")
    if isinstance(raw, float) and not raw.is_integer():
        raise TaskError("BAD_PARAM", f"参数「{key}」必须是整数，收到的是 {raw!r}。")
    return int(raw)


def numeric(series):
    """转成数值；转不动的一律变 NaN（而不是抛异常）。"""
    import pandas as pd

    return pd.to_numeric(series, errors="coerce")


# --------------------------------------------------------------------------
# 五个任务
# --------------------------------------------------------------------------

def task_pct_change(df, params):
    """逐行算变化率：(to - from) / from * 100。"""
    import numpy as np

    col_from = need_col(df, params, "value_from")
    col_to = need_col(df, params, "value_to")
    label = optional_col(df, params, "group_by")

    # ★ 下面两条校验拦的是【输出列重名】。它们原先都不存在，而后果是一段
    #   看不懂的 pandas 堆栈（DataFrame columns must be unique for orient='records'），
    #   模型完全无从下手 —— 它看到的是 pandas 的内部错误，不是「你哪写错了」。
    #
    #   （输入侧的列名重复不可能发生：数据是以「一行一个对象」交给 Python 的，
    #     JSON 对象的键不会重复。所以只用管输出侧。）
    if col_from == col_to:
        raise TaskError(
            "BAD_PARAM",
            f"参数「value_from」和「value_to」指的是同一列（都是「{col_from}」），"
            "这样算出来永远是 0。请给两列不同的。",
        )
    if label and label in (col_from, col_to):
        raise TaskError(
            "BAD_PARAM",
            f"参数「group_by」不能和 value_from / value_to 是同一列（都是「{label}」）——"
            "那样结果里会有两个同名的列，没法输出。请换一列当分组，或者去掉 group_by。",
        )

    a = numeric(df[col_from])
    b = numeric(df[col_to])

    # ★ 分母 <= 0（或者缺失）时结果是 null，【不是 0】。
    #   「算不出来」和「变化了 0%」是两回事。写成 0 会让下游把它当成
    #   一个真实的观测值去排名、去下结论 —— 而且不报错。
    #   这条规矩和项目里 analyze.py 处理「前半段为 0」时保持一致。
    with np.errstate(divide="ignore", invalid="ignore"):
        pct = np.where(a > 0, (b - a) / a * 100.0, np.nan)

    out = df.copy()
    out["change_pct"] = np.round(pct, 4)
    out["_from_value"] = a
    out["_to_value"] = b

    cols = []
    if label:
        cols.append(label)
    cols += ["_from_value", "_to_value", "change_pct"]

    result = out[cols].copy()
    result.columns = ([label] if label else []) + [col_from, col_to, "change_pct"]
    return result


def task_ranking(df, params):
    """按某一列排序并编名次。"""
    by = need_col(df, params, "by")
    order = str(params.get("order") or "desc").lower()
    if order not in ("asc", "desc"):
        raise TaskError("BAD_PARAM", "参数「order」只能是 asc 或 desc。")

    # ★ top_n 的 0 和负数【必须报错】，不能当成「全都要」或者夹到 1。
    #   原先是 `len(df) if top_n in (None, "", 0) else max(1, min(int(top_n), len(df)))`：
    #     top_n=0  → 被那个 `or 0` 的元组当成「省略」，静默返回全部
    #     top_n=-3 → max(1, min(-3, len)) = 1，静默只返回一行
    #   两种都不报错。模型拿到一个和它要求的不一样的行数，然后据此写结论。
    top_n = params.get("top_n")
    if top_n is None or top_n == "":
        n = len(df)
    else:
        n = as_int(params, "top_n")
        if n <= 0:
            raise TaskError(
                "BAD_PARAM",
                f"参数「top_n」必须是正整数，或者省略表示全部 {len(df)} 行；收到的是 {n}。",
            )
        n = min(n, len(df))

    # ★ 输入里已经有一列叫 rank 时，insert 会抛
    #   `cannot insert rank, already exists`（又是一段看不懂的 pandas 错误）。
    #   这个情形很常见：模型先在 SQL 里写了 ROW_NUMBER() AS rank，
    #   再让 Python 排一次。所以要说清「怎么办」，不能只说「冲突了」。
    if "rank" in df.columns:
        raise TaskError(
            "BAD_PARAM",
            "上一步的结果里已经有一列叫「rank」了，我没法再插一列同名的。"
            "请让 SQL 里换个列名（比如 row_no），或者直接用它那一列、不要再用这个任务排一次。",
        )

    out = df.sort_values(by, ascending=(order == "asc")).head(n).copy()
    out.insert(0, "rank", range(1, len(out) + 1))
    return out


def task_average(df, params):
    """总体均值 / 合计，或者按某一列分组之后各自算。"""
    import numpy as np

    value = need_col(df, params, "value")
    group = optional_col(df, params, "group_by")

    v = numeric(df[value])

    # ★ 整列都不是数字时【直接报错】，不给一行 sum=0.0、count=0 的结果。
    #
    #   原来这里给的是 {"mean": null, "sum": 0.0, "count": 0} —— 那个 0.0
    #   会被前端的数字核对器认成「有出处的 0」，于是模型可以理直气壮地写
    #   「该类目的总观看时长是 0」并在页面上通过核对。
    #   而「算不出来」和「合计就是 0」是两件事（同 task_pct_change 对分母的规矩）。
    #   distribution / trend 在同样情形下都是一律报错，这里跟它们保持一致。
    if not v.notna().any():
        raise TaskError("NO_DATA", f"「{value}」一个有效数值都没有，算不了平均值。")

    if group:
        tmp = df[[group]].copy()
        tmp["_v"] = v
        g = tmp.groupby(group, observed=True)["_v"]
        out = g.agg(["mean", "sum", "count"]).reset_index()
        out.columns = [group, "mean", "sum", "count"]
        out["mean"] = out["mean"].round(4)
        out["count"] = out["count"].astype(int)
        # ★ 一个组里全是非数字时，sum 必须是 null 而不是 0.0 —— 理由同上。
        #   （整列都有值的时候走不到这一行，但某一个组全空是完全可能的。）
        out.loc[out["count"] == 0, "sum"] = np.nan
    else:
        out = _pd().DataFrame(
            [{"mean": round(float(v.mean()), 4),
              "sum": float(v.sum()),
              "count": int(v.count())}]
        )
    return out


def task_trend(df, params):
    """按 x 排序，对 y 做最小二乘拟合，给出斜率和首末变化。

    ★ 这是五个任务里唯一一个「SQL 做不了」的：斜率要拟合，纯 SQL 没法表达。
      这正是「为什么需要第二个工具」最干净的一个例子。

    ★★ x 只用来【排序】，不参与拟合。 ★★
      斜率是按「排序后第几行」拟合的（xs = np.arange(...)），
      所以它的单位是「每相邻一行变化多少」，不是「x 每增加 1 变化多少」。
      列名因此叫 slope_per_row 而不是 slope_per_step ——
      step 看着像「x 的一步」，而它不是。
      提示词里也把这一句写死了（prompt.ts 的 PY_TOOL），
      不然模型会把它当成「每天的增量」去下结论，而 x 是日期时两者差别可能很大。
    """
    import numpy as np

    col_x = need_col(df, params, "x")
    col_y = need_col(df, params, "y")

    ordered = df.sort_values(col_x).copy()
    ys = numeric(ordered[col_y]).to_numpy(dtype=float)
    mask = ~np.isnan(ys)

    if mask.sum() < 2:
        raise TaskError("NOT_ENOUGH_POINTS", f"「{col_y}」只有 {int(mask.sum())} 个有效数值，算不出趋势（至少要 2 个）。")

    xs = np.arange(len(ordered), dtype=float)[mask]
    yy = ys[mask]
    slope = float(np.polyfit(xs, yy, 1)[0])

    first = float(yy[0])
    last = float(yy[-1])
    total = last - first

    return _pd().DataFrame([{
        "points": int(mask.sum()),
        # 单位：排序后【每相邻一行】的平均变化量，不是每个单位 x
        "slope_per_row": round(slope, 6),
        "first": round(first, 4),
        "last": round(last, 4),
        "total_change": round(total, 4),
        # 起点为 0 时同样是 null 而不是 0，理由同 task_pct_change
        "total_change_pct": round(total / first * 100.0, 4) if first > 0 else None,
        "direction": "下降" if slope < 0 else ("上升" if slope > 0 else "持平"),
    }])


def task_distribution(df, params):
    """按数值分箱，数每箱有多少行。"""
    import pandas as pd

    value = need_col(df, params, "value")

    # ★ 原来这里是 `int(params.get("bins") or 5)`，两个坑：
    #     bins="auto" → int() 抛 ValueError，一路冒到最外层，页面上是一段
    #                   pandas 内部堆栈（模型完全不知道该怎么改）
    #     bins=0      → falsy，被 `or 5` 悄悄换成 5 箱（模型要 0 箱，得到 5 箱）
    raw_bins = params.get("bins")
    bins = 5 if raw_bins is None or raw_bins == "" else as_int(params, "bins")
    if bins < 2 or bins > 50:
        raise TaskError("BAD_PARAM", f"参数「bins」（分几箱）必须在 2 到 50 之间，收到的是 {bins}。")

    s = numeric(df[value]).dropna()
    if s.empty:
        raise TaskError("NO_DATA", f"「{value}」一个有效数值都没有。")

    cut = pd.cut(s, bins=bins)
    counts = cut.value_counts().sort_index()
    return _pd().DataFrame(
        [{"range": str(idx), "count": int(c)} for idx, c in counts.items()]
    )


TASKS = {
    "pct_change": task_pct_change,
    "ranking": task_ranking,
    "average": task_average,
    "trend": task_trend,
    "distribution": task_distribution,
}


def _pd():
    import pandas as pd

    return pd


# --------------------------------------------------------------------------
# 入口
# --------------------------------------------------------------------------

def probe():
    """--probe：报告本机 Python 与依赖的版本，给健康检查用。"""
    import platform

    info = {"version": platform.python_version(), "pandas": None, "numpy": None}
    try:
        import pandas as pd

        info["pandas"] = pd.__version__
    except Exception as e:
        info["pandas_error"] = f"{type(e).__name__}: {e}"
    try:
        import numpy as np

        info["numpy"] = np.__version__
    except Exception as e:
        info["numpy_error"] = f"{type(e).__name__}: {e}"
    return info


def main():
    if "--probe" in sys.argv:
        print(json.dumps(probe(), ensure_ascii=False))
        return 0

    try:
        req = json.load(sys.stdin)
    except Exception as e:
        print(json.dumps({"ok": False, "error": {
            "code": "BAD_INPUT", "message": "stdin 不是合法 JSON。", "detail": str(e)}},
            ensure_ascii=False))
        return 1

    task = req.get("task")
    if task not in TASKS:
        print(json.dumps({"ok": False, "error": {
            "code": "TASK_NOT_ALLOWED",
            "message": f"没有「{task}」这个任务。只能选：{'、'.join(TASKS)}",
        }}, ensure_ascii=False))
        return 1

    try:
        pd = _pd()
        rows = req.get("rows") or []
        df = pd.DataFrame(rows)
        if df.empty:
            raise TaskError("EMPTY_INPUT", "上一步没有返回任何数据行，这一步算不了。")

        out = TASKS[task](df, req.get("params") or {})
        result = to_records(out)

        print(json.dumps({
            "ok": True,
            "python": probe(),
            "result": {"task": task, "columns": list(out.columns), "rows": result,
                       "rowCount": len(result)},
        }, ensure_ascii=False, allow_nan=False))
        return 0

    except TaskError as e:
        print(json.dumps({"ok": False, "error": {
            "code": e.code, "message": e.message, "detail": e.detail}},
            ensure_ascii=False))
        return 1
    except Exception as e:
        import traceback

        print(json.dumps({"ok": False, "error": {
            "code": "PY_FAILED",
            "message": f"Python 算这一步的时候出错了（{type(e).__name__}）。",
            "detail": traceback.format_exc()[-800:],
        }}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
