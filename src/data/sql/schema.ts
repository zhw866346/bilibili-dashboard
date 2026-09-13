/* ==========================================================================
   建表语句
   --------------------------------------------------------------------------
   和 src/types/index.ts 里的四个接口一一对应。页面上会把这几条原样展示出来，
   让读者对照「TypeScript 的类型定义」和「SQL 的建表语句」其实是同一件事的
   两种写法。

   ★ 为什么单独放一个文件，而不是写在 engine.ts 里？
     engine.ts 引入了 sql.js（一个 650KB 的数据库引擎）。
     页面只需要"看"这几条建表语句的文本，不需要把数据库引擎也一起加载。
     如果建表语句留在 engine.ts 里，页面一 import 就会把 sql.js 拖进主包，
     白白多下载 650KB。
     所以把它挪出来：页面读这个文件，engine.ts 也读这个文件，两边共用一份。
   ========================================================================== */

export const SCHEMA_SQL: string[] = [
  `CREATE TABLE users (
    user_id       TEXT PRIMARY KEY,   -- 用户编号 U00001
    age           INTEGER NOT NULL,   -- 年龄
    gender        TEXT    NOT NULL,   -- 性别
    city          TEXT    NOT NULL,   -- 城市层级
    register_date TEXT    NOT NULL,   -- 注册日期
    user_level    INTEGER NOT NULL    -- 用户等级 0-6
);`,

  `CREATE TABLE creators (
    up_id        TEXT PRIMARY KEY,    -- UP 主编号 C0001
    creator_type TEXT    NOT NULL,    -- 个人 / 机构 / MCN
    followers    INTEGER NOT NULL     -- 粉丝数
);`,

  `CREATE TABLE videos (
    video_id     TEXT PRIMARY KEY,    -- 视频编号 V00001
    up_id        TEXT    NOT NULL,    -- 投稿的 UP 主 → creators.up_id
    category     TEXT    NOT NULL,    -- 内容分区（8 选 1）
    publish_date TEXT    NOT NULL,    -- 发布日期
    duration     INTEGER NOT NULL     -- 视频总时长（秒）
);`,

  `CREATE TABLE video_views (
    user_id       TEXT    NOT NULL,   -- 谁 → users.user_id
    video_id      TEXT    NOT NULL,   -- 看了什么 → videos.video_id
    date          TEXT    NOT NULL,   -- 哪天看的
    watch_seconds INTEGER NOT NULL,   -- 这次实际看了多少秒
    is_like       INTEGER NOT NULL,   -- 是否点赞   （1 / 0）
    is_favorite   INTEGER NOT NULL,   -- 是否收藏   （1 / 0）
    is_comment    INTEGER NOT NULL,   -- 是否评论   （1 / 0）
    is_share      INTEGER NOT NULL    -- 是否分享   （1 / 0）
);`,
]

/** 四张表各自的一句话说明，页面上和建表语句一起显示 */
export const TABLE_NOTES: { name: string; note: string }[] = [
  { name: 'users', note: '用户表：年龄、性别、城市、注册日期、用户等级' },
  { name: 'creators', note: '创作者表：UP 主类型与粉丝数' },
  { name: 'videos', note: '视频表：所属 UP 主、内容分区、时长、发布日期' },
  { name: 'video_views', note: '观看记录表：一行 = 某用户某天看了某个视频，全部指标由它汇总' },
]
