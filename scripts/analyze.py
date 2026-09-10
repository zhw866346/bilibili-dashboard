"""
B站用户活跃度与内容消费 —— Python + Pandas 分析脚本

它做什么：
    读 data/csv/ 下的四个 CSV（由 scripts/export-data.mjs 从 dataset.ts 导出），
    用 Pandas 做数据体检、清洗、分层、交叉分析和时间序列分析，
    最后把结果写成 src/data/python/results.generated.ts 给看板展示。

为什么要写成 .ts 而不是 .json：
    看板打包后要能双击 dist/index.html 直接打开。file:// 协议下浏览器会拦掉
    fetch 本地文件，做成 TypeScript 模块直接 import 就没有这个问题。

★ 和前端一致性的约定：
    这个脚本算出来的口径必须和 src/data/metrics.ts 完全一致，
    否则页面上会出现两个对不上的数字。每一处口径对齐的地方都写了注释。
    「注册时间严格大于窗口首日」这类看起来别扭的地方是刻意复刻的，不要"顺手修正"，
    改了会让前面几个页面的数字跟着变。

用法：
    npm run data:export     # 先从 dataset.ts 导出 CSV
    npm run data:analyze    # 再跑这个脚本
    npm run data:refresh    # 两步一起
"""

import json
import sys
import textwrap
from pathlib import Path

import numpy as np
import pandas as pd

# Windows 控制台默认是 GBK，直接 print 中文会报 UnicodeEncodeError
sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
CSV_DIR = ROOT / "data" / "csv"
OUT_PATH = ROOT / "src" / "data" / "python" / "results.generated.ts"

# ---------------------------------------------------------------------------
# 下面这四个常量必须和 src/data/dataset.ts 保持一致。
# 改错了不会静默出错——看板加载时会比对，不一致就弹红色横幅。
# ---------------------------------------------------------------------------
SEED = 20260910
END_DATE = "2026-09-10"
DAYS = 60
WINDOW_DAYS = [7, 14, 30]

CATEGORIES = ["游戏", "知识", "科技", "生活", "娱乐", "动画", "影视", "音乐"]
AGE_GROUPS = ["18-24", "25-31", "32-40", "40+"]
# 和 src/utils/ageGroup.ts 的分箱逐字一致：18-24 / 25-31 / 32-40 / 41 以上
AGE_BINS = [17, 24, 31, 40, np.inf]

# 和 src/data/metrics.ts 的 COMPLETION_THRESHOLD 一致
COMPLETION_THRESHOLD = 0.8

FLAG_COLUMNS = ["is_like", "is_favorite", "is_comment", "is_share"]


# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------


def snippet(name: str) -> str:
    """
    从本文件自己的源码里，把标了 CASE 记号的代码段抠出来。

    为什么这么做：看板上要展示「真正跑过的 Python 代码」。
    如果手抄一份放进页面，改脚本时就会忘记同步，两边迟早对不上。
    从源码里抠，代码和结果由构造保证一致，不靠人记得。
    """
    source = Path(__file__).read_text(encoding="utf-8")
    begin = "# ===== CASE:" + name + " BEGIN ====="
    end = "# ===== CASE:" + name + " END ====="
    start = source.index(begin)
    stop = source.index(end, start)
    body = source[start + len(begin) : stop]
    return textwrap.dedent(body).strip() + "\n"


def to_plain(value):
    """
    把 Pandas / NumPy 的数值转成能写进 TypeScript 的普通类型。

    顺带统一保留 4 位小数：不这么做的话，浮点会周期性地抖出
    40.70000000000001 这种尾巴，每次重跑 git diff 都有一堆噪音，
    就失去了「输入没变、输出就该逐字节相同」这个可验证的性质。
    """
    if isinstance(value, dict):
        return {key: to_plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_plain(item) for item in value]
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, (np.floating, float)):
        number = float(value)
        if not np.isfinite(number):
            raise ValueError(f"结果里出现了非有限数值 {value!r}，这会让页面显示 NaN。请检查上游计算。")
        return round(number, 4)
    if isinstance(value, (int, str)) or value is None:
        return value
    return str(value)


def optional_float(value):
    """缺失值转成 None（TypeScript 里的 null），其余按 to_plain 的规则处理。"""
    if value is None or pd.isna(value):
        return None
    return round(float(value), 4)


def slice_window_df(days: int):
    """
    取「最后 days 天」的观看明细，顺带把这两天段的日期一起返回。

    ★ 窗口口径只留这一份，不要各处再写一遍。
      这里的算法是「按去重后的日期列表，从末尾往回数 days 个」，
      不是「截止日减 days 天」。两种算法在日期连续时结果完全一样，
      但一旦哪天一条观看记录都没有，就会差一天 —— 而且**不会报错**，
      只是数字悄悄对不上。这类错最难查，所以口径只准有一处。
      window_summary() 和下面按窗口算的两个新模块都走这里。

    ★ 它依赖一个前提：数据里每一天都有观看记录（60 天一天不缺）。
      前端 getDayIndex() 是按 dataset.dates 建桶的，恒为 60 天。
      对账脚本里「逐日 DAU（60 天）」那几项守的就是这个前提。
    """
    all_dates = sorted(views["date"].unique())
    end = all_dates[-1]
    start = all_dates[max(0, len(all_dates) - days)]
    window = views[(views["date"] >= start) & (views["date"] <= end)]
    return window, start, end


def fnv1a_of_self() -> str:
    """
    给这个脚本自己算一个指纹，写进结果文件。

    ★ 为什么是 FNV-1a，而不是 SHA-256：
      这个指纹要由**页面那边**重算一遍、和结果文件里记的比对，
      才能发现「改了脚本但忘了重跑」。
      但看板要在 file:// 下双击就能打开，而 file:// 不是安全上下文，
      浏览器的 crypto.subtle 在这种页面里是 undefined——SHA-256 根本算不了。
      所以换成一个几行就能手写、不依赖任何浏览器 API 的校验和。
      它不是密码学哈希，也不需要是：这里要抓的是「文件被改过」，
      不是「有人伪造了文件」。

    ★ 为什么先统一换行符：
      Windows 上的编辑器很容易把 .py 存成 CRLF，git 也可能在检出时改行尾。
      只要行尾一变，字节级指纹就全变了，页面会弹出一个假的「脚本已过期」警告。
      假警告比没有警告更糟——它会让人以后再也不信这个警告。
      所以两边都先归一到 LF 再算。
    """
    data = Path(__file__).read_bytes().replace(b"\r\n", b"\n")

    h = 0x811C9DC5
    for byte in data:
        h ^= byte
        h = (h * 0x01000193) & 0xFFFFFFFF
    return format(h, "08x")


print("")
print("Python + Pandas 分析")
print("=" * 60)

# ===========================================================================
# 1. 读取数据
# ===========================================================================

# ===== CASE:load BEGIN =====
# 显式声明每一列的类型，不让 pandas 自己猜。
# 猜出来的类型会随 pandas 版本变（比如布尔列可能被读成 bool、也可能被读成 object），
# 显式声明才能保证每次跑出来的结果完全一样。

USER_DTYPES = {
    "user_id": "str",
    "age": "int16",
    "gender": "str",
    "city": "str",
    "register_date": "str",
    "user_level": "int8",
}
CREATOR_DTYPES = {"up_id": "str", "creator_type": "str", "followers": "int32"}
VIDEO_DTYPES = {
    "video_id": "str",
    "up_id": "str",
    "category": "str",
    "publish_date": "str",
    "duration": "int32",
}
# 点赞/收藏/评论/分享在 CSV 里存的是 1 和 0，不是 True/False。
# 这和 SQL 页建表时把布尔存成 0/1 是同一个口径，对账才对得上。
VIEW_DTYPES = {
    "user_id": "str",
    "video_id": "str",
    "date": "str",
    "watch_seconds": "int32",
    "is_like": "int8",
    "is_favorite": "int8",
    "is_comment": "int8",
    "is_share": "int8",
}

users = pd.read_csv(CSV_DIR / "users.csv", dtype=USER_DTYPES)
creators = pd.read_csv(CSV_DIR / "creators.csv", dtype=CREATOR_DTYPES)
videos = pd.read_csv(CSV_DIR / "videos.csv", dtype=VIDEO_DTYPES)
views = pd.read_csv(CSV_DIR / "video_views.csv", dtype=VIEW_DTYPES)

# 看一眼每张表几行几列。df.shape 返回 (行数, 列数)。
TABLES = {"users": users, "creators": creators, "videos": videos, "video_views": views}
TABLE_LABELS = {
    "users": "用户表",
    "creators": "创作者表",
    "videos": "视频表",
    "video_views": "观看记录表",
}

shapes = [
    {"table": name, "label": TABLE_LABELS[name], "rows": int(df.shape[0]), "columns": int(df.shape[1])}
    for name, df in TABLES.items()
]

# 每列被读成了什么类型、每张表前 5 行长什么样。
# ★ 必须在清洗【之前】取。清洗会把日期列从字符串转成 datetime，
#   那之后再回头看 dtypes，看到的就不是「刚从 CSV 读进来」的样子了。
dtypes = [
    {"table": name, "column": column, "dtype": str(dtype)}
    for name, df in TABLES.items()
    for column, dtype in df.dtypes.items()
]
head_samples = [
    {
        "table": name,
        "label": TABLE_LABELS[name],
        "columns": list(df.columns),
        "rows": [
            [None if pd.isna(value) else value for value in row]
            for row in df.head(5).to_numpy().tolist()
        ],
    }
    for name, df in TABLES.items()
]
# ===== CASE:load END =====

print("")
print("【1】读取数据")
for item in shapes:
    print(f"    {item['label']:<12} {item['rows']:>9,} 行 × {item['columns']:>2} 列")
print(f"    合计 {sum(item['rows'] for item in shapes):,} 行")

# ===========================================================================
# 2. 数据体检
# ===========================================================================

# ===== CASE:quality BEGIN =====
# 数据体检要回答四个问题：有没有空值、有没有重复、表之间的关系对不对、数值有没有越界。

# ---- ① 缺失值：查两遍才算数 ----
# 第一遍用 isna()：它认的是真空白（CSV 里连续的逗号）。
# 但真实数据里更常见的是「伪装成合法值的缺失」——比如一列里写着 "NA"、"null"、"-"，
# 看起来有值，其实是空的。pandas 会把一部分哨兵词转成 NaN，但不是全部。
# 只查第一遍就下结论「没有缺失值」，是不负责任的。
missing = [
    {"table": name, "column": column, "count": int(count)}
    for name, df in TABLES.items()
    for column, count in df.isna().sum().items()
    if count > 0
]
missing_total = int(sum(item["count"] for item in missing))

SENTINELS = ["NA", "NaN", "nan", "null", "NULL", "None", "none", "-", "N/A", ""]
sentinel_hits = []
for name, df in TABLES.items():
    for column in df.columns:
        series = df[column]
        if pd.api.types.is_numeric_dtype(series) or pd.api.types.is_bool_dtype(series):
            continue
        for sentinel in SENTINELS:
            count = int((series == sentinel).sum())
            if count > 0:
                sentinel_hits.append(
                    {"table": name, "column": column, "value": sentinel, "count": count}
                )

# ---- ② 重复值：两种口径差很多，而且都说得通 ----
# 整行完全一样 = 真正的重复数据。
# 但「同一个用户、同一天、同一个视频」出现多次，不算脏数据——
# 这张表的粒度是「一次播放」，不是「用户 × 视频 × 天」。
# 分开报，是为了让读者看清这两种「重复」是两回事。
duplicate_full_rows = int(views.duplicated().sum())
DUPLICATE_KEYS = [
    ("user_id,video_id,date", "用户 + 视频 + 日期", ["user_id", "video_id", "date"]),
    ("user_id,date", "用户 + 日期", ["user_id", "date"]),
]
duplicate_keys = [
    {"key": key, "label": label, "count": int(views.duplicated(subset=columns).sum())}
    for key, label, columns in DUPLICATE_KEYS
]

# ---- ③ 外键完整性：子表里有没有找不到爹的行 ----
foreign_keys = []
for child, column, parent, parent_column in [
    ("video_views", "user_id", "users", "user_id"),
    ("video_views", "video_id", "videos", "video_id"),
    ("videos", "up_id", "creators", "up_id"),
]:
    child_df, parent_df = TABLES[child], TABLES[parent]
    orphans = int((~child_df[column].isin(set(parent_df[parent_column]))).sum())
    foreign_keys.append(
        {"child": child, "column": column, "parent": parent, "orphans": orphans}
    )

# ---- ④ 越界检查：数值有没有跑到业务上不可能的范围 ----
registered_ids = set(users["user_id"])
duration_by_video = dict(zip(videos["video_id"], videos["duration"]))
age_by_user = dict(zip(users["user_id"], users["age"]))

watch = views["watch_seconds"]
duration_matched = views["video_id"].map(duration_by_video)
age_matched = views["user_id"].map(age_by_user)

distinct_dates = sorted(views["date"].unique())
window_first_date = distinct_dates[0]

range_checks = [
    {
        "check": "观看秒数 > 0",
        "detail": "一次观看至少 1 秒，否则不该产生记录",
        "violations": int((watch <= 0).sum()),
    },
    {
        "check": "观看秒数 ≤ 视频总时长",
        "detail": "看得比视频本身还长是不可能的",
        "violations": int((watch > duration_matched).sum()),
    },
    {
        "check": f"观看日期落在最近 {DAYS} 天内",
        "detail": f"{window_first_date} ~ {END_DATE}",
        "violations": int(((views["date"] < window_first_date) | (views["date"] > END_DATE)).sum()),
    },
    {
        "check": "年龄在 18–55 岁之间",
        "detail": "数据生成时的年龄范围",
        "violations": int(((age_matched < 18) | (age_matched > 55)).sum()),
    },
    {
        "check": "注册日期不晚于数据截止日",
        "detail": f"截止日 {END_DATE}",
        "violations": int((users["register_date"] > END_DATE).sum()),
    },
]
# ===== CASE:quality END =====

print("")
print("【2】数据体检")
print(f"    缺失值（isna 口径）    {missing_total} 个")
print(f"    缺失值（哨兵字符串口径） {sum(item['count'] for item in sentinel_hits)} 个")
print(f"    整行完全重复            {duplicate_full_rows} 行")
for item in duplicate_keys:
    print(f"    重复的「{item['label']}」{' ' * 4} {item['count']:,} 行")
print(f"    外键孤儿行              {sum(item['orphans'] for item in foreign_keys)} 行")
print(f"    越界行                  {sum(item['violations'] for item in range_checks)} 行")

# ===========================================================================
# 3. 数据清洗与派生列
# ===========================================================================

# ===== CASE:clean BEGIN =====
# 体检的结论是这份数据是干净的，所以清洗这一步不丢任何行——
# 它的作用是「确认干净」并把数据整理成好分析的形状，不是表演删数据。

rows_before = int(len(views))

# ---- ① 类型转换：把 1/0 还原成布尔，把日期字符串转成日期类型 ----
views[FLAG_COLUMNS] = views[FLAG_COLUMNS].astype(bool)
views["date"] = pd.to_datetime(views["date"], format="%Y-%m-%d")
users["register_date"] = pd.to_datetime(users["register_date"], format="%Y-%m-%d")

# ---- ② 派生列：把分析要用到的信息并到观看记录上 ----
# 视频的分区、总时长，用户所属的年龄段，都是后面分析要反复用的维度。
views = views.merge(
    videos[["video_id", "category", "duration"]], on="video_id", how="left", validate="many_to_one"
)
# 年龄段用 pd.cut 分箱，边界和 src/utils/ageGroup.ts 逐字一致。
# right=True 表示左开右闭，所以 24 落在 (17,24] 里，归属 18-24。
# pd.cut 没有 observed 参数（那是 groupby / crosstab 的），这里只用 bins + labels。
users["age_group"] = pd.cut(users["age"], bins=AGE_BINS, labels=AGE_GROUPS, right=True)
views = views.merge(
    users[["user_id", "age_group"]], on="user_id", how="left", validate="many_to_one"
)

# 完播：这次看的秒数达到视频总时长的 80%。
# ★ duration > 0 这个守卫、以及 >= 和 * 0.8 的写法都是照抄 src/data/metrics.ts 的，
#   不许改成 round() 或整数除法——JS 和 Python 都是 IEEE754 双精度的同一次运算，
#   照抄才能保证两边每一个视频的判定结果完全一样。
views["completed"] = (views["duration"] > 0) & (
    views["watch_seconds"] >= views["duration"] * COMPLETION_THRESHOLD
)

# 派生列加完之后行数必须一行不少，否则说明 merge 写错了（比如用了 inner join）
rows_after = int(len(views))
if rows_after != rows_before:
    raise ValueError(f"清洗过程中行数从 {rows_before} 变成了 {rows_after}，merge 逻辑有问题。")

derived_columns = ["category", "duration", "age_group", "completed"]
# ===== CASE:clean END =====

print("")
print("【3】数据清洗与派生列")
print(f"    清洗前 {rows_before:,} 行 → 清洗后 {rows_after:,} 行（一行没丢）")
print(f"    新增派生列：{'、'.join(derived_columns)}")

# ===========================================================================
# 4. 用户活跃度
# ===========================================================================

# ===== CASE:activity BEGIN =====
# groupby + agg + sort_values 是 Pandas 做分析最常用的三件套：
# 先按日期分组，再对每组算几个数，最后排好序。

daily = (
    views.groupby("date")
    .agg(
        dau=("user_id", "nunique"),        # 当天有多少个不同的人来过
        views=("user_id", "size"),         # 当天一共播放了多少次
        seconds=("watch_seconds", "sum"),  # 当天一共看了多少秒
    )
    .reset_index()
    .sort_values("date")
)

# 日环比：今天比昨天多了还是少了。
# ★ 这里不传 fill_method 参数：pandas 2.2 里它被废弃、3.0 里已经删掉了，
#   写上去在老版本能跑、在新版本直接报 TypeError。现在的默认行为就是
#   「不填补空值」——缺的数据就该是空的，正好是我们要的。
daily["change_pct"] = daily["dau"].pct_change() * 100

# 7 日移动平均。原始 DAU 每天都上下跳，看不出趋势；
# 取最近 7 天的平均就平滑多了。窗口设为 7 是因为一周正好覆盖一个完整的
# 「工作日 + 周末」循环，能把周末效应抹平（第 8 节会验证这一点）。
daily["dau_smooth7"] = daily["dau"].rolling(7).mean()

# 每个用户在整个观察期里活跃了多少天。
# 这个指标必须有完整的 60 天才成立，所以不随时间筛选变。
per_user = (
    views.groupby("user_id")
    .agg(
        active_days=("date", "nunique"),
        total_views=("user_id", "size"),
        total_seconds=("watch_seconds", "sum"),
    )
    .reset_index()
)

# 一次都没来过的用户也要算进来（活跃 0 天），否则「沉默用户占比」会偏低
all_users = users[["user_id"]].copy()
per_user = all_users.merge(per_user, on="user_id", how="left")
per_user[["active_days", "total_views", "total_seconds"]] = (
    per_user[["active_days", "total_views", "total_seconds"]].fillna(0).astype("int64")
)
# 日均观看分钟数 = 总秒数 ÷ 天数 ÷ 60
per_user["daily_minutes"] = per_user["total_seconds"] / DAYS / 60

# 活跃天数分布：0 天、1 天、……、60 天各有几个人
active_days_hist = per_user["active_days"].value_counts().sort_index()
active_days_hist = [
    {"days": int(days), "users": int(active_days_hist.get(days, 0))}
    for days in range(DAYS + 1)
]
# ===== CASE:activity END =====

print("")
print("【4】用户活跃度")
print(f"    日均活跃用户（DAU）  {daily['dau'].mean():,.1f} 人")
print(f"    用户平均活跃天数     {per_user['active_days'].mean():.1f} 天 / {DAYS} 天")
never_active = int((per_user["active_days"] == 0).sum())
print(f"    一次都没来过的用户   {never_active:,} 人")

# ===========================================================================
# 5. 用户分层（qcut 等频分箱）
# ===========================================================================

# ===== CASE:tiers BEGIN =====
# pd.cut 是「等距分箱」：你定边界，每档多宽你说了算。
# pd.qcut 是「等频分箱」：你定档数，它自动找边界，让每档人数尽量一样多。
#
# 用户价值天然是长尾的——少数人贡献大部分时长。用等距分箱会得到
# 「最低档塞了几千人、最高档只有几个人」这种没法看的分布，
# 所以这里用 qcut 按「人均每日观看分钟数」四等分。
per_user["tier"] = pd.qcut(
    per_user["daily_minutes"],
    q=4,
    labels=["Q1 最低", "Q2", "Q3", "Q4 最高"],
    duplicates="drop",
)

# 每档的边界值，用来在页面上如实标出「这一档是什么范围」
tier_bounds = per_user.groupby("tier", observed=True)["daily_minutes"].agg(["min", "max"])

# 把分层贴回明细，才能看「每一档的人在看什么内容」
views_with_tier = views.merge(
    per_user[["user_id", "tier"]], on="user_id", how="left", validate="many_to_one"
)

tier_summary = (
    per_user.groupby("tier", observed=True)
    .agg(users=("user_id", "size"), avg_active_days=("active_days", "mean"))
    .reset_index()
)
tier_minutes = per_user.groupby("tier", observed=True)["daily_minutes"].sum()
tier_views = views_with_tier.groupby("tier", observed=True).size()
total_minutes = float(tier_minutes.sum())
total_views_all = int(tier_views.sum())

# 每一档最偏好的三个分区
tier_top_categories = []
for tier, group in views_with_tier.groupby("tier", observed=True):
    counts = group["category"].value_counts()
    share_sum = int(counts.sum())
    tier_top_categories.append(
        {
            "tier": str(tier),
            "top": [
                {"category": str(category), "share": round(int(count) / share_sum * 100, 4)}
                for category, count in counts.head(3).items()
            ],
        }
    )

tiers = []
for row in tier_summary.itertuples(index=False):
    tier = str(row.tier)
    top = next(item["top"] for item in tier_top_categories if item["tier"] == tier)
    users_in_tier = int(row.users)
    tier_views_count = int(tier_views.get(row.tier, 0))
    tiers.append(
        {
            "id": tier,
            "users": users_in_tier,
            "minMinutes": round(float(tier_bounds.loc[row.tier, "min"]), 4),
            "maxMinutes": round(float(tier_bounds.loc[row.tier, "max"]), 4),
            "avgActiveDays": round(float(row.avg_active_days), 4),
            "totalMinutes": round(float(tier_minutes.get(row.tier, 0)), 4),
            "minutesShare": round(float(tier_minutes.get(row.tier, 0)) / total_minutes * 100, 4),
            "viewsShare": round(tier_views_count / total_views_all * 100, 4),
            "topCategories": top,
        }
    )
# ===== CASE:tiers END =====

print("")
print("【5】用户分层（qcut 四等分）")
for tier in tiers:
    print(
        f"    {tier['id']:<10} {tier['users']:>5,} 人"
        f"    贡献时长 {tier['minutesShare']:>5.1f}%"
        f"    平均活跃 {tier['avgActiveDays']:>4.1f} 天"
    )

# ===========================================================================
# 6. 内容消费：视频时长和完播率是什么关系
# ===========================================================================

# ===== CASE:content BEGIN =====
# SQL 里做「视频时长 vs 完播率」这种「先按视频聚合、再算相关系数」的分析很别扭，
# 而在 Pandas 里就是 groupby 之后一行 corr()。

video_level = (
    views.groupby("video_id")
    .agg(
        plays=("user_id", "size"),
        completed=("completed", "sum"),
        avg_watch_seconds=("watch_seconds", "mean"),
    )
    .reset_index()
    .merge(videos[["video_id", "category", "duration"]], on="video_id", how="inner")
)
video_level["completed_rate"] = video_level["completed"] / video_level["plays"] * 100

# 皮尔逊相关系数。只说明「一起变化」，不说明谁导致谁——
# 相关不等于因果，这一点在页面上要写清楚。
duration_completion_r = float(video_level["duration"].corr(video_level["completed_rate"]))

category_content = []
for category in CATEGORIES:
    group = video_level[video_level["category"] == category]
    if group.empty:
        category_content.append(
            {
                "category": category,
                "videos": 0,
                "medianDuration": 0.0,
                "plays": 0,
                "avgCompletedRate": 0.0,
                "avgWatchSeconds": 0.0,
            }
        )
        continue
    category_content.append(
        {
            "category": category,
            "videos": int(len(group)),
            "medianDuration": round(float(group["duration"].median()), 4),
            "plays": int(group["plays"].sum()),
            "avgCompletedRate": round(float(group["completed_rate"].mean()), 4),
            "avgWatchSeconds": round(float(group["avg_watch_seconds"].mean()), 4),
        }
    )
# ===== CASE:content END =====

print("")
print("【6】内容消费")
print(f"    视频时长与完播率的相关系数  r = {duration_completion_r:.3f}")

# ===========================================================================
# 7. 用户 × 内容
# ===========================================================================

# ===== CASE:cross BEGIN =====
# pivot_table 把「长表」掰成「宽表」：行是分层、列是分区、格子里是数值。
# 这是 Pandas 最好用的功能之一，SQL 里要写 PIVOT 或者一堆 CASE WHEN。

# ---- ① 行为分层 × 内容分区 ----
tier_category = pd.crosstab(views_with_tier["tier"], views_with_tier["category"])
tier_category = tier_category.reindex(columns=CATEGORIES, fill_value=0)
# 每一档内部归一化成占比：这样比较的是「偏好」而不是「规模」
tier_category_share = tier_category.div(tier_category.sum(axis=1), axis=0) * 100

tier_category_rows = []
for tier, row in tier_category_share.iterrows():
    row_total_views = int(tier_category.loc[tier].sum())
    tier_category_rows.append(
        {
            "tier": str(tier),
            "totalViews": row_total_views,
            "cells": [
                {
                    "category": category,
                    "views": int(tier_category.loc[tier, category]),
                    "share": round(float(row[category]), 4),
                }
                for category in CATEGORIES
            ],
        }
    )

# ---- ② 四个年龄段的「口味相似度」 ----
# 把每个年龄段在 8 个分区上的观看量当成一个 8 维向量，
# 两两算余弦相似度：值越接近 1，说明这两个年龄段爱看的东西越像。
age_category = pd.crosstab(views["age_group"], views["category"])
age_category = age_category.reindex(index=AGE_GROUPS, columns=CATEGORIES, fill_value=0)
matrix = age_category.to_numpy(dtype="float64")
norms = np.linalg.norm(matrix, axis=1)
cosine = matrix @ matrix.T / np.outer(norms, norms)

preference_similarity = [
    {
        "a": AGE_GROUPS[i],
        "b": AGE_GROUPS[j],
        "cosine": round(float(cosine[i][j]), 4),
    }
    for i in range(len(AGE_GROUPS))
    for j in range(i + 1, len(AGE_GROUPS))
]

# ---- ③ 年龄段 × 内容分区 的逐格明细（按时间窗口算） ----
# ★ 为什么以前不做、现在要做，完整理由写在第 9 节 window_summary() 的说明里，
#   一句话概括：
#   不是为了多摆一张表，是为了让 AI 助手页的「SQL 和 Python 交叉验证」有第二个独立信源。


def build_age_preference(window: pd.DataFrame) -> list:
    """
    每档人在 8 个内容分区上各花了多少注意力。

    ★ 派生口径逐字对齐前端 src/data/selectors.ts 的 buildUserContentCells()：
        share         = 该格播放次数 ÷ 该年龄段 8 个分区的播放次数之和 × 100
                        （行内归一化：4 个年龄段各自加总都是 100%，
                          这样比的是「偏好」，不会被「哪个年龄段人多」带偏）
        coverage      = 该格独立观看用户数 ÷ 该年龄段窗口内活跃用户数 × 100
        avgMinutes    = 该格总秒数 ÷ 该格播放次数 ÷ 60（平均点开一次看多久）
        completedRate = 高完成度观看次数 ÷ 播放次数 × 100
        engageRate    = （赞 + 藏 + 评 + 享）的次数 ÷ 播放次数 × 100
                        分子是【行为次数】不是人数：一个人又赞又藏算 2 次互动。

    ★ viewers 必须是窗口内跨天去重的独立观看用户数。
      绝不能拿逐日人数相加 —— 同一个人连着 5 天看游戏，加出来是 5 个人。
      所以这里用 nunique()。

    ★ 分母为 0 时一律取 0，不许出现 NaN / 无穷大：
      NaN 会在最后 to_plain() 那一步直接抛错（那是防页面显示 NaN 的硬闸）。
    """

    def cell_matrix(values, aggfunc) -> pd.DataFrame:
        """
        按「年龄段 × 分区」交叉汇总，并强制补齐 4 × 8 个键。

        ★ fillna(0) 和 reindex 一起用，缺一不可：
          · fillna(0)：某个年龄段一次都没看过某个分区时，crosstab 会给 NaN。
            留下 NaN，最后写文件那一步会直接抛错。
          · reindex：把没出现过的行列补出来。缺键会让前端读到 undefined，
            页面上会冒出 "undefined" 这种脏字符。
        """
        table = pd.crosstab(
            window["age_group"],
            window["category"],
            values=values,
            aggfunc=aggfunc,
        )
        return table.fillna(0).reindex(index=AGE_GROUPS, columns=CATEGORIES, fill_value=0)

    views = pd.crosstab(window["age_group"], window["category"]).reindex(
        index=AGE_GROUPS, columns=CATEGORIES, fill_value=0
    )
    viewers = cell_matrix(window["user_id"], "nunique")
    seconds = cell_matrix(window["watch_seconds"], "sum")
    completed = cell_matrix(window["completed"], "sum")
    # 四种互动行为的次数之和。注意是在【一行观看记录】内部求和，
    # 不是数有多少人互动过 —— 和前端 engageRate 的分子保持一致。
    engage = cell_matrix(window[FLAG_COLUMNS].sum(axis=1), "sum")

    rows = []
    for age in AGE_GROUPS:
        age_total_views = int(views.loc[age].sum())
        # 覆盖率的分母：这个年龄段在窗口内活跃过的去重人数。
        # 和前端 metrics.ts 的 activeUsersByAge 是同一个数，对账时会比。
        age_active_users = int(window.loc[window["age_group"] == age, "user_id"].nunique())

        cells = []
        for category in CATEGORIES:
            view_count = int(views.loc[age, category])
            viewer_count = int(viewers.loc[age, category])
            second_count = float(seconds.loc[age, category])

            cells.append(
                {
                    "category": category,
                    "views": view_count,
                    "viewers": viewer_count,
                    "seconds": round(second_count, 4),
                    "share": round(view_count / age_total_views * 100, 4)
                    if age_total_views
                    else 0.0,
                    "coverage": round(viewer_count / age_active_users * 100, 4)
                    if age_active_users
                    else 0.0,
                    "avgMinutes": round(second_count / 60 / view_count, 4) if view_count else 0.0,
                    "completedRate": round(int(completed.loc[age, category]) / view_count * 100, 4)
                    if view_count
                    else 0.0,
                    "engageRate": round(float(engage.loc[age, category]) / view_count * 100, 4)
                    if view_count
                    else 0.0,
                }
            )

        # 按偏好占比降序：页面上一眼就能看出这档人最偏哪个分区
        cells.sort(key=lambda cell: -cell["share"])

        rows.append(
            {
                "age": age,
                # ★ 这里不输出显示用的中文标签（「18–24岁」这种）。
                #   前端 src/utils/ageGroup.ts 是年龄段的唯一权威定义，
                #   页面用 ageGroupLabel() 自己映射就行。
                #   在这边再写一份，等于给自己造第二个真相来源。
                "activeUsers": age_active_users,
                "totalViews": age_total_views,
                "cells": cells,
            }
        )

    return rows


# ===== CASE:cross END =====

print("")
print("【7】用户 × 内容")
most_similar = max(preference_similarity, key=lambda item: item["cosine"])
least_similar = min(preference_similarity, key=lambda item: item["cosine"])
print(f"    口味最接近的两个年龄段  {most_similar['a']} 与 {most_similar['b']}（{most_similar['cosine']:.4f}）")
print(f"    口味差最远的两个年龄段  {least_similar['a']} 与 {least_similar['b']}（{least_similar['cosine']:.4f}）")

# ===========================================================================
# 8. 趋势：周末效应与波动率
# ===========================================================================

# ===== CASE:trend BEGIN =====
# 这一节回答一个具体问题：DAU 每天上上下下，有多少是「周末效应」造成的？
# 而这套数据在生成时，确实设了周末系数——
# src/data/dataset.ts 里的 DOW_MULTIPLIER：周末 1.18、周五 1.06、工作日 1.00。
# 也就是说，我们有机会「用数据反查构造参数」：算出来的比值应该接近 1.18。

daily["dow"] = daily["date"].dt.dayofweek  # 0 = 周一，6 = 周日
daily["dow_group"] = np.select(
    [daily["dow"] >= 5, daily["dow"] == 4],
    ["weekend", "friday"],
    default="weekday",
)

dow_factor = daily.groupby("dow_group")["dau"].mean()
weekday_baseline = float(dow_factor.get("weekday", 0))
dow_effect = [
    {
        "group": group,
        "label": label,
        "avgDau": round(float(dow_factor.get(group, 0)), 4),
        "ratioToWeekday": round(float(dow_factor.get(group, 0)) / weekday_baseline, 4)
        if weekday_baseline > 0
        else 0.0,
        "days": int((daily["dow_group"] == group).sum()),
    }
    for group, label in [("weekday", "工作日"), ("friday", "周五"), ("weekend", "周末")]
]

# 波动率：日环比的变化幅度。数值越大说明这个平台每天的活跃越不稳定。
changes = daily["change_pct"].dropna()
volatility = {
    "stdPct": round(float(changes.std()), 4),
    "meanAbsPct": round(float(changes.abs().mean()), 4),
    "maxAbsPct": round(float(changes.abs().max()), 4),
    "maxAbsDate": daily.loc[daily["change_pct"].abs().idxmax(), "date"].strftime("%Y-%m-%d"),
}

daily_rows = [
    {
        "date": row.date.strftime("%Y-%m-%d"),
        "dow": int(row.dow),
        "dowGroup": str(row.dow_group),
        "dau": int(row.dau),
        "views": int(row.views),
        "seconds": int(row.seconds),
        "dauSmooth7": optional_float(row.dau_smooth7),
        "changePct": optional_float(row.change_pct),
    }
    for row in daily.itertuples(index=False)
]

# ---- 各内容分区的「前后半段」对比（按时间窗口算） ----


def build_category_trend(window: pd.DataFrame) -> dict:
    """
    把窗口对半切，看每个内容分区的播放量是涨了还是跌了，并排名。

    ★ 口径来自 AI 分析助手页的示例问题，原文是：
      「把窗口对半切，比较各分区前后半段的播放量，算增长率并排名。」
      这里的实现就是照着那句话写的。

    ★ 三件必须一起说清楚、否则会被误读的事（页面上也要写出来）：

      1. 两段天数可能不等：7 天窗口切出来是 3 天 vs 4 天。
         所以比的是【日均播放量】，不是总量 —— 拿 3 天的总量去比 4 天的，
         短的那段天然吃亏，排名就不可信了。
         也正是因为这样，页面上必须把两段各多少天标出来。

      2. 这不是「本周 vs 上周」。它比的是**窗口自己内部**的前后两半：
         窗口 30 天时，它说的是「这 30 天的后半段 vs 前半段」，
         和「近 30 天 vs 再往前 30 天」是两回事，数值也不一样。

      3. 窗口越短越不稳。7 天窗口切完每段只有 3~4 天，
         一天的异常就能把排名整个掀翻。
         所以这个排名适合看方向，不适合当精确结论用。

    ★ 前半段日均是 0 时，增长率记 None（前端 TS 里是 null），不是 0 也不是无穷大。
      和项目里「上一周期为 0 就不显示环比」是同一条规矩 ——
      算不出来就说算不出来，不要拿一个看着像结论的数糊过去。

    ★ 日期的切法按窗口内实际存在的日期来数（不是直接拿 days 除），
      这样 firstDays + secondDays 一定等于窗口天数，不会因为某天没数据而错位。
    """
    dates = pd.DatetimeIndex(sorted(window["date"].unique()))
    first_days = len(dates) // 2
    second_days = len(dates) - first_days
    first_dates = dates[:first_days]
    second_dates = dates[first_days:]

    # 一行 = 一个分区，一列 = 一天，格子里是当天的播放次数
    per_day = (
        window.groupby(["category", "date"], observed=True)
        .size()
        .unstack(fill_value=0)
        .reindex(index=CATEGORIES, columns=dates, fill_value=0)
    )

    rows = []
    for category in CATEGORIES:
        first_views = int(per_day.loc[category, first_dates].sum())
        second_views = int(per_day.loc[category, second_dates].sum())
        first_daily = first_views / first_days if first_days > 0 else 0.0
        second_daily = second_views / second_days if second_days > 0 else 0.0
        growth = (second_daily - first_daily) / first_daily * 100 if first_daily > 0 else None

        rows.append(
            {
                "category": category,
                "firstViews": first_views,
                "secondViews": second_views,
                "firstDailyViews": round(first_daily, 4),
                "secondDailyViews": round(second_daily, 4),
                "growthPct": round(growth, 4) if growth is not None else None,
            }
        )

    # 涨得多的排前面。算不出增长率的（前半段那个分区一次都没被看过）排最后，
    # 而不是当成 0 混在中间 —— 那会让人误以为它「没涨没跌」。
    rows.sort(key=lambda row: (row["growthPct"] is None, -(row["growthPct"] or 0.0)))

    return {
        "firstStart": first_dates[0].strftime("%Y-%m-%d") if first_days else "",
        "firstEnd": first_dates[-1].strftime("%Y-%m-%d") if first_days else "",
        "firstDays": first_days,
        "secondStart": second_dates[0].strftime("%Y-%m-%d") if second_days else "",
        "secondEnd": second_dates[-1].strftime("%Y-%m-%d") if second_days else "",
        "secondDays": second_days,
        "categories": rows,
    }


def build_segment_trend(window: pd.DataFrame) -> dict:
    """
    把窗口对半切，看每个年龄段的【日均活跃率】在窗口里是往上还是往下走。

    ★ 口径来自 AI 分析助手页的示例问题，原文是：
      「哪些用户群体存在活跃度下降？」
      这里的实现就是照着那句话写的。

    ★ 分母是「该年龄段的总人数」，不是全站人数。
      分子分母必须是同一批人：分子是 18-24 岁里活跃过的，分母就只能是
      18-24 岁的总人数。拿全站人数当分母，算出来的是「这个年龄段占全站多少」，
      完全是另一件事。这条规矩和 SQL 案例 03「各年龄段活跃率」是同一个。

    ★ 分母用的是【注册用户总数】，和窗口无关 —— 换个时间窗口，
      分母不变，变的只有分子。所以三个窗口的活跃率是可以横向比的。

    ★ 为什么比【日均活跃率】而不是「这半段里活跃过的人数」：
      两段天数常常不等（近 7 天切出来是 3 天 vs 4 天），而「活跃过至少一次」
      这个口径下，天多的那一半天然更容易把人扫到 —— 拿它比，短的那段永远吃亏，
      排名就不可信了。所以一律先摊平成日均。
      （这条坑在本文件的 categoryTrend 那一节里已经踩过一次，是同一个道理。）

    ★ 「日均活跃率」怎么算：
        活跃人天 ÷（该档总人数 × 该半段天数）× 100
      活跃人天 = 「某人某天来过」这一事实的去重计数（和 SQL 分析页的案例 03 同口径）。
      按天去重再摊平，正好等于「每天活跃人数 ÷ 总人数」的日均值。

    ★ changePp 的单位是【百分点】，不是百分比。
      从 44.80% 掉到 39.79% 是「降了 5.01 个百分点」，不是「降了 5.01%」。
      前端文案里必须写「个百分点」，写错了就是在夸大或缩小事实。

    ★ 日期切法按窗口内实际存在的日期数（不是 days ÷ 2），
      和 build_category_trend 用同一套数法，两边的切分点才对得上。
    """
    dates = pd.DatetimeIndex(sorted(window["date"].unique()))
    first_days = len(dates) // 2
    second_days = len(dates) - first_days
    first_dates = dates[:first_days]
    second_dates = dates[first_days:]

    # 分母：截止日之前注册的全部用户，按年龄段分。和 window_summary 里的
    # total_users_by_age 是同一批人（同一句筛选），所以两者能对上。
    registered = users[users["register_date"] <= pd.Timestamp(END_DATE)]
    total_by_age = registered["age_group"].value_counts()

    def active_days_by_age(sub: pd.DataFrame) -> pd.Series:
        """
        「某人某天来过」按年龄段数一遍，返回 Series（索引是年龄段）。

        ★ 先去重再数：同一个人一天看了 5 个视频，只能算 1 个人天。
          直接 size() 数的是观看次数，那是另一个指标。
        ★ 空窗口返回空 Series，让下面的 .get(age, 0) 兜底补 0。
          缺键会在前端变成 undefined，页面上就是脏字符。
        """
        if len(sub) == 0:
            return pd.Series(dtype="int64")
        uniq = sub[["age_group", "date", "user_id"]].drop_duplicates()
        return uniq.groupby("age_group").size()

    first_active = active_days_by_age(window[window["date"].isin(first_dates)])
    second_active = active_days_by_age(window[window["date"].isin(second_dates)])

    def daily_rate(active_days: float, total_users: int, days: int) -> float:
        if total_users <= 0 or days <= 0:
            return 0.0
        return active_days / (total_users * days) * 100

    segments = []
    for age in AGE_GROUPS:
        total_users = int(total_by_age.get(age, 0))
        f_days = int(first_active.get(age, 0))
        s_days = int(second_active.get(age, 0))
        f_rate = daily_rate(f_days, total_users, first_days)
        s_rate = daily_rate(s_days, total_users, second_days)
        segments.append(
            {
                "age": age,
                "totalUsers": total_users,
                "firstActiveUserDays": f_days,
                "firstDau": round(f_days / first_days, 4) if first_days > 0 else 0.0,
                "firstDailyActiveRate": round(f_rate, 4),
                "secondActiveUserDays": s_days,
                "secondDau": round(s_days / second_days, 4) if second_days > 0 else 0.0,
                "secondDailyActiveRate": round(s_rate, 4),
                # 单位是百分点（后半段 − 前半段），可正可负。
                # 用未取整的两个率相减、再统一取整，避免两次取整误差叠加。
                "changePp": round(s_rate - f_rate, 4),
            }
        )

    # 全站合计的活跃人天 —— AI 助手页的交叉验证就钉这两个整数。
    # 一条 SQL 里挂两条检查、两条合起来才钉住切分点：切分点错一天，
    # 两段的合计会同时变化、两条都会红。只验一条容易漏。
    return {
        "firstStart": first_dates[0].strftime("%Y-%m-%d") if first_days else "",
        "firstEnd": first_dates[-1].strftime("%Y-%m-%d") if first_days else "",
        "firstDays": first_days,
        "secondStart": second_dates[0].strftime("%Y-%m-%d") if second_days else "",
        "secondEnd": second_dates[-1].strftime("%Y-%m-%d") if second_days else "",
        "secondDays": second_days,
        "firstActiveUserDays": int(sum(s["firstActiveUserDays"] for s in segments)),
        "secondActiveUserDays": int(sum(s["secondActiveUserDays"] for s in segments)),
        "segments": segments,
    }


# ===== CASE:trend END =====

print("")
print("【8】趋势与周末效应")
for item in dow_effect:
    print(
        f"    {item['label']:<6} 平均 DAU {item['avgDau']:>8,.1f}"
        f"    相对工作日 ×{item['ratioToWeekday']:.4f}"
        f"    （{item['days']} 天）"
    )
print(f"    DAU 日环比的波动率（标准差）  {volatility['stdPct']:.2f}%")

# ===========================================================================
# 9. 时间窗口汇总（给页面上的对账表用）
# ===========================================================================


def window_summary(days: int) -> dict:
    """
    取最后 days 天的汇总。

    ★ 下面每个字段名都是照抄 src/data/metrics.ts 的 WindowSummary 的，
      不是另起一套。名字一样，第 9 节的对账就能逐字段直接比，
      不用在脑子里维护一张「它的 A 对应我的 B」的翻译表——
      那种表迟早会翻译错，而翻译错了看起来就像数据不一致。

    ★ 三处刻意复刻、不要"顺手改好"的地方：
      1. totalUsers 是「截至数据截止日的累计注册数」，是存量，
         不管切 7 天还是 30 天都是同一个数，它同时是活跃率的分母。
      2. dau 是「窗口内每日活跃人数之和 ÷ 天数」，是日均值；
         而 totalViews / totalSeconds 是窗口内的累计值。两者量纲不同，不要混。
      3. 窗口内新增用户用的是 register_date > 窗口首日（严格大于），
         所以首日当天注册的人不算在内。这个口径有点别扭，但前端就是这么算的，
         改了会让用户分析页的数字跟着变。

    ★ 关于年龄段 × 分区的 32 格交叉明细：这里曾经写过一句
      「那个交叉已经实现过两次，第三次是纯粹的重复劳动，故意不做」。
      那句话在**当时**是对的 —— 前端第四页有一份、SQL 案例 06 有一份，
      再加第三份不产生新信息。

      后来变了：AI 分析助手页要拿这个口径做**交叉验证** ——
      用 SQL 在浏览器里真跑一遍，把结果和 Pandas 这边算的并排摆出来逐格比。
      要让「两边对得上」这句话成立，Pandas 这边就必须**真的自己算一遍**；
      从前端搬一份过来再比，等于自己跟自己比，一点意义都没有。

      所以现在补上它，不是为了在页面上再摆一张同样的表，
      是为了给交叉验证提供一个独立信源。顺带，这一页的对账表也就能覆盖到它。

    ★ 窗口的切法统一走 slice_window_df()，不要在这里另写一段。
    """
    window, start, end = slice_window_df(days)

    # 先把「谁在哪天来过」去重成一张表：一行 = 一个人活跃的一天。
    # ★ 这一步不能省。观看记录表是按「次」记的，一个人一天看 10 次就有 10 行，
    #   直接数行数会把人均指标算小、把活跃人数算大。
    active_user_days = window[["date", "user_id", "age_group"]].drop_duplicates()

    # 存量：截至数据截止日的累计注册用户（注意是 END_DATE，不是窗口末日）
    registered = users[users["register_date"] <= pd.Timestamp(END_DATE)]
    total_users_by_age = registered["age_group"].value_counts()

    dau_by_age = active_user_days["age_group"].value_counts()
    active_users_by_age = active_user_days.groupby("age_group", observed=True)["user_id"].nunique()
    views_by_age = window.groupby("age_group", observed=True).size()
    seconds_by_age = window.groupby("age_group", observed=True)["watch_seconds"].sum()

    total_views = int(len(window))
    total_seconds = int(window["watch_seconds"].sum())
    total_likes = int(window["is_like"].sum())
    total_favorites = int(window["is_favorite"].sum())
    total_comments = int(window["is_comment"].sum())
    total_shares = int(window["is_share"].sum())

    by_category = {}
    for category in CATEGORIES:
        segment = window[window["category"] == category]
        by_category[category] = {
            "views": int(len(segment)),
            "seconds": int(segment["watch_seconds"].sum()),
            "likes": int(segment["is_like"].sum()),
            "favorites": int(segment["is_favorite"].sum()),
            "comments": int(segment["is_comment"].sum()),
            "shares": int(segment["is_share"].sum()),
            "completed": int(segment["completed"].sum()),
            # 跨天去重：同一个人连着 5 天看游戏，整个窗口里只算 1 个人
            "viewers": int(segment["user_id"].nunique()),
        }

    def per_age(series: pd.Series, divisor: float = 1.0) -> dict:
        """
        按年龄段取值，缺的档位补 0，不许缺键。

        ★ 「不许缺键」是硬要求，不是保险：某个年龄段在 7 天窗口里可能一次都没活跃，
          value_counts() 会直接不返回这一档。前端读到的就是 undefined，
          页面上会出现 "undefined" 这种脏字符。补 0 是唯一正确的做法。
        """
        return {age: round(float(series.get(age, 0)) / divisor, 4) for age in AGE_GROUPS}

    return {
        "days": days,
        "startDate": start.strftime("%Y-%m-%d"),
        "endDate": end.strftime("%Y-%m-%d"),
        "totalUsers": int(len(registered)),
        "totalUsersByAge": per_age(total_users_by_age),
        # 严格大于窗口首日：首日当天注册的人不算「窗口内新增」
        "newUsersInWindow": int((registered["register_date"] > start).sum()),
        # 日均活跃 = 窗口内每日活跃人数之和 ÷ 天数
        # ★ 分年龄的也必须除以天数。dau_by_age 数的是「人·天」，
        #   不除会得到一个 7 倍大的数，而且因为量级看着还算合理，很难一眼看出来。
        "dau": round(float(len(active_user_days)) / days, 4),
        "dauByAge": per_age(dau_by_age, divisor=days),
        "activeUsers": int(active_user_days["user_id"].nunique()),
        "activeUsersByAge": per_age(active_users_by_age),
        "totalViews": total_views,
        "viewsByAge": per_age(views_by_age),
        "totalSeconds": total_seconds,
        "secondsByAge": per_age(seconds_by_age),
        "engagedUsers": int(
            window.loc[window[FLAG_COLUMNS].any(axis=1), "user_id"].nunique()
        ),
        "totalLikes": total_likes,
        "totalFavorites": total_favorites,
        "totalComments": total_comments,
        "totalShares": total_shares,
        "byCategory": by_category,
        # 下面两块的代码写在 CASE:cross / CASE:trend 那两个块里。
        # 数据挂在这里（而不是挂在 cross / trend 下面），是因为它们天生按窗口算：
        # viewers 是「窗口内跨天去重」的独立观看用户数，换个窗口就是另一个数。
        # 字段名和前端 metrics.ts 的 WindowSummary 对齐，对账时能逐字段直接比。
        "agePreference": build_age_preference(window),
        "categoryTrend": build_category_trend(window),
        # 按年龄段的前后半段活跃率对比。
        # 同样不是为了在 Python 页上再摆一张表，是给 AI 助手页的
        # 「SQL ↔ Python 交叉验证」当第二个独立信源。代码写在 CASE:trend 里。
        "segmentTrend": build_segment_trend(window),
    }


windows = {str(days): window_summary(days) for days in WINDOW_DAYS}

print("")
print("【9】时间窗口汇总")
for days, summary in windows.items():
    print(
        f"    近 {days:>2} 天（{summary['startDate']} ~ {summary['endDate']}）"
        f"    日均 DAU {summary['dau']:>8,.1f}"
        f"    播放 {summary['totalViews']:>9,} 次"
    )

# 上面两块新结果也是第 9 节算出来的（只是代码写在 CASE:cross / CASE:trend 里），
# 所以不另起一个【N】编号，跟着【9】一起打印。
print("")
print("    年龄段偏好 · 分区前后半段对比")
for days, summary in windows.items():
    youngest = summary["agePreference"][0]
    top_cell = youngest["cells"][0]
    print(
        f"    近 {days:>2} 天  {youngest['age']} 岁最偏 {top_cell['category']}"
        f"（占 {top_cell['share']:>5.1f}%）"
    )
    trend = summary["categoryTrend"]
    leader = trend["categories"][0]
    print(
        f"             前半段 {trend['firstStart']} ~ {trend['firstEnd']}（{trend['firstDays']} 天）"
        f" / 后半段 {trend['secondStart']} ~ {trend['secondEnd']}（{trend['secondDays']} 天）"
    )
    if leader["growthPct"] is not None:
        print(
            f"             增长最快  {leader['category']}"
            f"  日均 {leader['firstDailyViews']:>8,.1f} → {leader['secondDailyViews']:>8,.1f}"
            f"（{leader['growthPct']:+.2f}%）"
        )

# 各年龄段的「前半段 vs 后半段」日均活跃率。
# 打印出来是为了让跑管道的人一眼看到结论会不会随时间窗口翻 ——
# 页面上那张图的说辞就是照着这里的事实写的。
print("")
print("    各年龄段 日均活跃率：前半段 → 后半段（变化，单位百分点）")
for days, summary in windows.items():
    seg = summary["segmentTrend"]
    worst = min(seg["segments"], key=lambda s: s["changePp"])
    parts = []
    for s in seg["segments"]:
        parts.append(
            f"{s['age']} {s['firstDailyActiveRate']:>5.1f}→{s['secondDailyActiveRate']:>5.1f}"
            f"（{s['changePp']:+.2f}）"
        )
    print(f"    近 {days:>2} 天  " + "  ".join(parts))
    print(
        f"             降幅最大：{worst['age']}"
        f"（{worst['changePp']:+.2f} 个百分点）"
        f"    四档跨度 {max(s['changePp'] for s in seg['segments']) - worst['changePp']:.2f} 个百分点"
    )

# ===========================================================================
# 10. 输出结果文件
# ===========================================================================

results = {
    "manifest": {
        "seed": SEED,
        "endDate": END_DATE,
        "days": DAYS,
        "windowDays": WINDOW_DAYS,
        "rowCounts": {name: int(df.shape[0]) for name, df in TABLES.items()},
        "pythonVersion": ".".join(str(part) for part in sys.version_info[:3]),
        "pandasVersion": pd.__version__,
        "numpyVersion": np.__version__,
        # 脚本自己的指纹。页面会用 Vite 的 ?raw 拿到同一份源码重算、比对。
        "analyzePyHash": fnv1a_of_self(),
    },
    "quality": {
        "shapes": shapes,
        "missing": missing,
        "missingTotal": missing_total,
        "sentinelHits": sentinel_hits,
        "duplicateFullRows": duplicate_full_rows,
        "duplicateKeys": duplicate_keys,
        "foreignKeys": foreign_keys,
        "rangeChecks": range_checks,
        "rowsBefore": rows_before,
        "rowsAfter": rows_after,
        "derivedColumns": derived_columns,
        "distinctDates": len(distinct_dates),
        "firstDate": window_first_date,
        "dtypes": dtypes,
        "head": head_samples,
    },
    "activity": {
        "daily": daily_rows,
        "activeDaysHist": active_days_hist,
        "neverActiveUsers": never_active,
        "avgActiveDays": round(float(per_user["active_days"].mean()), 4),
        "volatility": volatility,
    },
    "tiers": tiers,
    "content": {
        "durationCompletionR": round(duration_completion_r, 4),
        # 参与相关系数计算的视频数。如果这个数小于 1000，说明有视频一次都没被看过，
        # 页面上要如实说明「相关系数是基于有播放记录的视频算的」。
        "videosAnalyzed": int(len(video_level)),
        "categories": category_content,
    },
    "cross": {
        "tierCategory": tier_category_rows,
        "preferenceSimilarity": preference_similarity,
    },
    "trend": {
        "dowEffect": dow_effect,
        "weekdayBaselineDau": round(weekday_baseline, 4),
    },
    "windows": windows,
    "snippets": {
        name: snippet(name)
        for name in ["load", "quality", "clean", "activity", "tiers", "content", "cross", "trend"]
    },
}

payload = json.dumps(to_plain(results), ensure_ascii=False, indent=2)

HEADER = """/* eslint-disable */
/**
 * 本文件由 scripts/analyze.py 自动生成，请勿手改。
 *
 * 重新生成：npm run data:refresh
 *
 * ★ 为什么把分析结果做成 TypeScript 模块，而不是一个 .json 文件：
 *   这个看板要在 file:// 协议下也能打开（双击 dist/index.html）。
 *   那种情况下浏览器会拦掉 fetch 本地文件，而直接 import 模块没有这个问题。
 */

import type { PyResults } from './types'

export const PY_RESULTS: PyResults = """

OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
# newline='\n' 是必须的：Windows 上默认会把 \n 写成 \r\n，
# 结果整个文件变成 CRLF，git diff 会显示成「全文都改了」。
with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as handle:
    handle.write(HEADER + payload + "\n")

size_kb = OUT_PATH.stat().st_size / 1024
print("")
print("=" * 60)
print(f"已写出 {OUT_PATH.relative_to(ROOT)}（{size_kb:.1f} KB）")
print("")
