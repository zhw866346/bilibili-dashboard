/* eslint-disable */
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

export const PY_RESULTS: PyResults = {
  "manifest": {
    "seed": 20260910,
    "endDate": "2026-09-10",
    "days": 60,
    "windowDays": [
      7,
      14,
      30
    ],
    "rowCounts": {
      "users": 6000,
      "creators": 180,
      "videos": 1000,
      "video_views": 565740
    },
    "pythonVersion": "3.13.15",
    "pandasVersion": "3.0.5",
    "numpyVersion": "2.5.3",
    "analyzePyHash": "d03b7bfa"
  },
  "quality": {
    "shapes": [
      {
        "table": "users",
        "label": "用户表",
        "rows": 6000,
        "columns": 6
      },
      {
        "table": "creators",
        "label": "创作者表",
        "rows": 180,
        "columns": 3
      },
      {
        "table": "videos",
        "label": "视频表",
        "rows": 1000,
        "columns": 5
      },
      {
        "table": "video_views",
        "label": "观看记录表",
        "rows": 565740,
        "columns": 8
      }
    ],
    "missing": [],
    "missingTotal": 0,
    "sentinelHits": [],
    "duplicateFullRows": 4,
    "duplicateKeys": [
      {
        "key": "user_id,video_id,date",
        "label": "用户 + 视频 + 日期",
        "count": 1659
      },
      {
        "key": "user_id,date",
        "label": "用户 + 日期",
        "count": 436448
      }
    ],
    "foreignKeys": [
      {
        "child": "video_views",
        "column": "user_id",
        "parent": "users",
        "orphans": 0
      },
      {
        "child": "video_views",
        "column": "video_id",
        "parent": "videos",
        "orphans": 0
      },
      {
        "child": "videos",
        "column": "up_id",
        "parent": "creators",
        "orphans": 0
      }
    ],
    "rangeChecks": [
      {
        "check": "观看秒数 > 0",
        "detail": "一次观看至少 1 秒，否则不该产生记录",
        "violations": 0
      },
      {
        "check": "观看秒数 ≤ 视频总时长",
        "detail": "看得比视频本身还长是不可能的",
        "violations": 0
      },
      {
        "check": "观看日期落在最近 60 天内",
        "detail": "2026-07-13 ~ 2026-09-10",
        "violations": 0
      },
      {
        "check": "年龄在 18–55 岁之间",
        "detail": "数据生成时的年龄范围",
        "violations": 0
      },
      {
        "check": "注册日期不晚于数据截止日",
        "detail": "截止日 2026-09-10",
        "violations": 0
      }
    ],
    "rowsBefore": 565740,
    "rowsAfter": 565740,
    "derivedColumns": [
      "category",
      "duration",
      "age_group",
      "completed"
    ],
    "distinctDates": 60,
    "firstDate": "2026-07-13",
    "dtypes": [
      {
        "table": "users",
        "column": "user_id",
        "dtype": "str"
      },
      {
        "table": "users",
        "column": "age",
        "dtype": "int16"
      },
      {
        "table": "users",
        "column": "gender",
        "dtype": "str"
      },
      {
        "table": "users",
        "column": "city",
        "dtype": "str"
      },
      {
        "table": "users",
        "column": "register_date",
        "dtype": "str"
      },
      {
        "table": "users",
        "column": "user_level",
        "dtype": "int8"
      },
      {
        "table": "creators",
        "column": "up_id",
        "dtype": "str"
      },
      {
        "table": "creators",
        "column": "creator_type",
        "dtype": "str"
      },
      {
        "table": "creators",
        "column": "followers",
        "dtype": "int32"
      },
      {
        "table": "videos",
        "column": "video_id",
        "dtype": "str"
      },
      {
        "table": "videos",
        "column": "up_id",
        "dtype": "str"
      },
      {
        "table": "videos",
        "column": "category",
        "dtype": "str"
      },
      {
        "table": "videos",
        "column": "publish_date",
        "dtype": "str"
      },
      {
        "table": "videos",
        "column": "duration",
        "dtype": "int32"
      },
      {
        "table": "video_views",
        "column": "user_id",
        "dtype": "str"
      },
      {
        "table": "video_views",
        "column": "video_id",
        "dtype": "str"
      },
      {
        "table": "video_views",
        "column": "date",
        "dtype": "str"
      },
      {
        "table": "video_views",
        "column": "watch_seconds",
        "dtype": "int32"
      },
      {
        "table": "video_views",
        "column": "is_like",
        "dtype": "int8"
      },
      {
        "table": "video_views",
        "column": "is_favorite",
        "dtype": "int8"
      },
      {
        "table": "video_views",
        "column": "is_comment",
        "dtype": "int8"
      },
      {
        "table": "video_views",
        "column": "is_share",
        "dtype": "int8"
      }
    ],
    "head": [
      {
        "table": "users",
        "label": "用户表",
        "columns": [
          "user_id",
          "age",
          "gender",
          "city",
          "register_date",
          "user_level"
        ],
        "rows": [
          [
            "U00001",
            21,
            "男",
            "一线城市",
            "2025-05-17",
            3
          ],
          [
            "U00002",
            27,
            "女",
            "三线及以下",
            "2024-03-14",
            6
          ],
          [
            "U00003",
            55,
            "男",
            "二线城市",
            "2026-09-10",
            2
          ],
          [
            "U00004",
            48,
            "男",
            "一线城市",
            "2025-02-22",
            4
          ],
          [
            "U00005",
            19,
            "女",
            "一线城市",
            "2026-09-10",
            3
          ]
        ]
      },
      {
        "table": "creators",
        "label": "创作者表",
        "columns": [
          "up_id",
          "creator_type",
          "followers"
        ],
        "rows": [
          [
            "C0001",
            "个人",
            11155
          ],
          [
            "C0002",
            "个人",
            707
          ],
          [
            "C0003",
            "个人",
            19606
          ],
          [
            "C0004",
            "个人",
            4390
          ],
          [
            "C0005",
            "个人",
            71916
          ]
        ]
      },
      {
        "table": "videos",
        "label": "视频表",
        "columns": [
          "video_id",
          "up_id",
          "category",
          "publish_date",
          "duration"
        ],
        "rows": [
          [
            "V00001",
            "C0162",
            "动画",
            "2026-05-15",
            1913
          ],
          [
            "V00002",
            "C0026",
            "科技",
            "2026-07-15",
            1540
          ],
          [
            "V00003",
            "C0078",
            "动画",
            "2026-07-31",
            1797
          ],
          [
            "V00004",
            "C0142",
            "音乐",
            "2026-08-19",
            410
          ],
          [
            "V00005",
            "C0143",
            "娱乐",
            "2026-09-03",
            343
          ]
        ]
      },
      {
        "table": "video_views",
        "label": "观看记录表",
        "columns": [
          "user_id",
          "video_id",
          "date",
          "watch_seconds",
          "is_like",
          "is_favorite",
          "is_comment",
          "is_share"
        ],
        "rows": [
          [
            "U00001",
            "V00137",
            "2026-07-21",
            1474,
            0,
            0,
            0,
            0
          ],
          [
            "U00001",
            "V00796",
            "2026-07-21",
            1216,
            0,
            0,
            0,
            0
          ],
          [
            "U00001",
            "V00034",
            "2026-07-21",
            148,
            0,
            0,
            0,
            0
          ],
          [
            "U00001",
            "V00887",
            "2026-07-21",
            32,
            0,
            0,
            0,
            0
          ],
          [
            "U00001",
            "V00519",
            "2026-07-21",
            456,
            0,
            0,
            0,
            0
          ]
        ]
      }
    ]
  },
  "activity": {
    "daily": [
      {
        "date": "2026-07-13",
        "dow": 0,
        "dowGroup": "weekday",
        "dau": 1927,
        "views": 8613,
        "seconds": 4852194,
        "dauSmooth7": null,
        "changePct": null
      },
      {
        "date": "2026-07-14",
        "dow": 1,
        "dowGroup": "weekday",
        "dau": 2061,
        "views": 8944,
        "seconds": 5055485,
        "dauSmooth7": null,
        "changePct": 6.9538
      },
      {
        "date": "2026-07-15",
        "dow": 2,
        "dowGroup": "weekday",
        "dau": 2054,
        "views": 8984,
        "seconds": 5067214,
        "dauSmooth7": null,
        "changePct": -0.3396
      },
      {
        "date": "2026-07-16",
        "dow": 3,
        "dowGroup": "weekday",
        "dau": 2061,
        "views": 9174,
        "seconds": 5209028,
        "dauSmooth7": null,
        "changePct": 0.3408
      },
      {
        "date": "2026-07-17",
        "dow": 4,
        "dowGroup": "friday",
        "dau": 2150,
        "views": 9442,
        "seconds": 5221512,
        "dauSmooth7": null,
        "changePct": 4.3183
      },
      {
        "date": "2026-07-18",
        "dow": 5,
        "dowGroup": "weekend",
        "dau": 2414,
        "views": 10479,
        "seconds": 5837157,
        "dauSmooth7": null,
        "changePct": 12.2791
      },
      {
        "date": "2026-07-19",
        "dow": 6,
        "dowGroup": "weekend",
        "dau": 2383,
        "views": 10425,
        "seconds": 5849633,
        "dauSmooth7": 2150.0,
        "changePct": -1.2842
      },
      {
        "date": "2026-07-20",
        "dow": 0,
        "dowGroup": "weekday",
        "dau": 2113,
        "views": 9255,
        "seconds": 5155630,
        "dauSmooth7": 2176.5714,
        "changePct": -11.3303
      },
      {
        "date": "2026-07-21",
        "dow": 1,
        "dowGroup": "weekday",
        "dau": 2070,
        "views": 9051,
        "seconds": 5063857,
        "dauSmooth7": 2177.8571,
        "changePct": -2.035
      },
      {
        "date": "2026-07-22",
        "dow": 2,
        "dowGroup": "weekday",
        "dau": 2074,
        "views": 9246,
        "seconds": 5220553,
        "dauSmooth7": 2180.7143,
        "changePct": 0.1932
      },
      {
        "date": "2026-07-23",
        "dow": 3,
        "dowGroup": "weekday",
        "dau": 2025,
        "views": 8839,
        "seconds": 4959558,
        "dauSmooth7": 2175.5714,
        "changePct": -2.3626
      },
      {
        "date": "2026-07-24",
        "dow": 4,
        "dowGroup": "friday",
        "dau": 2130,
        "views": 9494,
        "seconds": 5329244,
        "dauSmooth7": 2172.7143,
        "changePct": 5.1852
      },
      {
        "date": "2026-07-25",
        "dow": 5,
        "dowGroup": "weekend",
        "dau": 2408,
        "views": 10402,
        "seconds": 5906660,
        "dauSmooth7": 2171.8571,
        "changePct": 13.0516
      },
      {
        "date": "2026-07-26",
        "dow": 6,
        "dowGroup": "weekend",
        "dau": 2396,
        "views": 10349,
        "seconds": 5822807,
        "dauSmooth7": 2173.7143,
        "changePct": -0.4983
      },
      {
        "date": "2026-07-27",
        "dow": 0,
        "dowGroup": "weekday",
        "dau": 2018,
        "views": 8978,
        "seconds": 5017325,
        "dauSmooth7": 2160.1429,
        "changePct": -15.7763
      },
      {
        "date": "2026-07-28",
        "dow": 1,
        "dowGroup": "weekday",
        "dau": 2031,
        "views": 8902,
        "seconds": 4962641,
        "dauSmooth7": 2154.5714,
        "changePct": 0.6442
      },
      {
        "date": "2026-07-29",
        "dow": 2,
        "dowGroup": "weekday",
        "dau": 2103,
        "views": 9136,
        "seconds": 5091531,
        "dauSmooth7": 2158.7143,
        "changePct": 3.5451
      },
      {
        "date": "2026-07-30",
        "dow": 3,
        "dowGroup": "weekday",
        "dau": 1993,
        "views": 8702,
        "seconds": 4877610,
        "dauSmooth7": 2154.1429,
        "changePct": -5.2306
      },
      {
        "date": "2026-07-31",
        "dow": 4,
        "dowGroup": "friday",
        "dau": 2142,
        "views": 9326,
        "seconds": 5355268,
        "dauSmooth7": 2155.8571,
        "changePct": 7.4762
      },
      {
        "date": "2026-08-01",
        "dow": 5,
        "dowGroup": "weekend",
        "dau": 2438,
        "views": 10604,
        "seconds": 5887129,
        "dauSmooth7": 2160.1429,
        "changePct": 13.8189
      },
      {
        "date": "2026-08-02",
        "dow": 6,
        "dowGroup": "weekend",
        "dau": 2426,
        "views": 10738,
        "seconds": 5984796,
        "dauSmooth7": 2164.4286,
        "changePct": -0.4922
      },
      {
        "date": "2026-08-03",
        "dow": 0,
        "dowGroup": "weekday",
        "dau": 2053,
        "views": 8900,
        "seconds": 5013503,
        "dauSmooth7": 2169.4286,
        "changePct": -15.3751
      },
      {
        "date": "2026-08-04",
        "dow": 1,
        "dowGroup": "weekday",
        "dau": 2004,
        "views": 8869,
        "seconds": 4939311,
        "dauSmooth7": 2165.5714,
        "changePct": -2.3868
      },
      {
        "date": "2026-08-05",
        "dow": 2,
        "dowGroup": "weekday",
        "dau": 2021,
        "views": 8809,
        "seconds": 4981782,
        "dauSmooth7": 2153.8571,
        "changePct": 0.8483
      },
      {
        "date": "2026-08-06",
        "dow": 3,
        "dowGroup": "weekday",
        "dau": 2027,
        "views": 8877,
        "seconds": 4997331,
        "dauSmooth7": 2158.7143,
        "changePct": 0.2969
      },
      {
        "date": "2026-08-07",
        "dow": 4,
        "dowGroup": "friday",
        "dau": 2177,
        "views": 9533,
        "seconds": 5403127,
        "dauSmooth7": 2163.7143,
        "changePct": 7.4001
      },
      {
        "date": "2026-08-08",
        "dow": 5,
        "dowGroup": "weekend",
        "dau": 2422,
        "views": 10830,
        "seconds": 6146353,
        "dauSmooth7": 2161.4286,
        "changePct": 11.254
      },
      {
        "date": "2026-08-09",
        "dow": 6,
        "dowGroup": "weekend",
        "dau": 2407,
        "views": 10518,
        "seconds": 5967093,
        "dauSmooth7": 2158.7143,
        "changePct": -0.6193
      },
      {
        "date": "2026-08-10",
        "dow": 0,
        "dowGroup": "weekday",
        "dau": 2070,
        "views": 9003,
        "seconds": 5087251,
        "dauSmooth7": 2161.1429,
        "changePct": -14.0008
      },
      {
        "date": "2026-08-11",
        "dow": 1,
        "dowGroup": "weekday",
        "dau": 1990,
        "views": 8731,
        "seconds": 4897429,
        "dauSmooth7": 2159.1429,
        "changePct": -3.8647
      },
      {
        "date": "2026-08-12",
        "dow": 2,
        "dowGroup": "weekday",
        "dau": 2022,
        "views": 8730,
        "seconds": 4861288,
        "dauSmooth7": 2159.2857,
        "changePct": 1.608
      },
      {
        "date": "2026-08-13",
        "dow": 3,
        "dowGroup": "weekday",
        "dau": 2007,
        "views": 8708,
        "seconds": 4862895,
        "dauSmooth7": 2156.4286,
        "changePct": -0.7418
      },
      {
        "date": "2026-08-14",
        "dow": 4,
        "dowGroup": "friday",
        "dau": 2121,
        "views": 9223,
        "seconds": 5144744,
        "dauSmooth7": 2148.4286,
        "changePct": 5.6801
      },
      {
        "date": "2026-08-15",
        "dow": 5,
        "dowGroup": "weekend",
        "dau": 2385,
        "views": 10407,
        "seconds": 5885141,
        "dauSmooth7": 2143.1429,
        "changePct": 12.447
      },
      {
        "date": "2026-08-16",
        "dow": 6,
        "dowGroup": "weekend",
        "dau": 2430,
        "views": 10664,
        "seconds": 6033345,
        "dauSmooth7": 2146.4286,
        "changePct": 1.8868
      },
      {
        "date": "2026-08-17",
        "dow": 0,
        "dowGroup": "weekday",
        "dau": 2046,
        "views": 8999,
        "seconds": 5088926,
        "dauSmooth7": 2143.0,
        "changePct": -15.8025
      },
      {
        "date": "2026-08-18",
        "dow": 1,
        "dowGroup": "weekday",
        "dau": 2049,
        "views": 9062,
        "seconds": 5019306,
        "dauSmooth7": 2151.4286,
        "changePct": 0.1466
      },
      {
        "date": "2026-08-19",
        "dow": 2,
        "dowGroup": "weekday",
        "dau": 2068,
        "views": 8881,
        "seconds": 5069253,
        "dauSmooth7": 2158.0,
        "changePct": 0.9273
      },
      {
        "date": "2026-08-20",
        "dow": 3,
        "dowGroup": "weekday",
        "dau": 2004,
        "views": 8815,
        "seconds": 4825829,
        "dauSmooth7": 2157.5714,
        "changePct": -3.0948
      },
      {
        "date": "2026-08-21",
        "dow": 4,
        "dowGroup": "friday",
        "dau": 2169,
        "views": 9500,
        "seconds": 5448161,
        "dauSmooth7": 2164.4286,
        "changePct": 8.2335
      },
      {
        "date": "2026-08-22",
        "dow": 5,
        "dowGroup": "weekend",
        "dau": 2447,
        "views": 10697,
        "seconds": 6024657,
        "dauSmooth7": 2173.2857,
        "changePct": 12.817
      },
      {
        "date": "2026-08-23",
        "dow": 6,
        "dowGroup": "weekend",
        "dau": 2410,
        "views": 10457,
        "seconds": 5953964,
        "dauSmooth7": 2170.4286,
        "changePct": -1.5121
      },
      {
        "date": "2026-08-24",
        "dow": 0,
        "dowGroup": "weekday",
        "dau": 2026,
        "views": 9070,
        "seconds": 5066637,
        "dauSmooth7": 2167.5714,
        "changePct": -15.9336
      },
      {
        "date": "2026-08-25",
        "dow": 1,
        "dowGroup": "weekday",
        "dau": 2033,
        "views": 8943,
        "seconds": 5050643,
        "dauSmooth7": 2165.2857,
        "changePct": 0.3455
      },
      {
        "date": "2026-08-26",
        "dow": 2,
        "dowGroup": "weekday",
        "dau": 2087,
        "views": 9066,
        "seconds": 5157918,
        "dauSmooth7": 2168.0,
        "changePct": 2.6562
      },
      {
        "date": "2026-08-27",
        "dow": 3,
        "dowGroup": "weekday",
        "dau": 2043,
        "views": 8802,
        "seconds": 4948885,
        "dauSmooth7": 2173.5714,
        "changePct": -2.1083
      },
      {
        "date": "2026-08-28",
        "dow": 4,
        "dowGroup": "friday",
        "dau": 2128,
        "views": 9226,
        "seconds": 5202334,
        "dauSmooth7": 2167.7143,
        "changePct": 4.1605
      },
      {
        "date": "2026-08-29",
        "dow": 5,
        "dowGroup": "weekend",
        "dau": 2468,
        "views": 10815,
        "seconds": 6209357,
        "dauSmooth7": 2170.7143,
        "changePct": 15.9774
      },
      {
        "date": "2026-08-30",
        "dow": 6,
        "dowGroup": "weekend",
        "dau": 2362,
        "views": 10395,
        "seconds": 5755757,
        "dauSmooth7": 2163.8571,
        "changePct": -4.295
      },
      {
        "date": "2026-08-31",
        "dow": 0,
        "dowGroup": "weekday",
        "dau": 2016,
        "views": 8783,
        "seconds": 4962904,
        "dauSmooth7": 2162.4286,
        "changePct": -14.6486
      },
      {
        "date": "2026-09-01",
        "dow": 1,
        "dowGroup": "weekday",
        "dau": 2035,
        "views": 8795,
        "seconds": 4931957,
        "dauSmooth7": 2162.7143,
        "changePct": 0.9425
      },
      {
        "date": "2026-09-02",
        "dow": 2,
        "dowGroup": "weekday",
        "dau": 2077,
        "views": 9134,
        "seconds": 5048679,
        "dauSmooth7": 2161.2857,
        "changePct": 2.0639
      },
      {
        "date": "2026-09-03",
        "dow": 3,
        "dowGroup": "weekday",
        "dau": 2066,
        "views": 9016,
        "seconds": 5092410,
        "dauSmooth7": 2164.5714,
        "changePct": -0.5296
      },
      {
        "date": "2026-09-04",
        "dow": 4,
        "dowGroup": "friday",
        "dau": 2093,
        "views": 9161,
        "seconds": 5136419,
        "dauSmooth7": 2159.5714,
        "changePct": 1.3069
      },
      {
        "date": "2026-09-05",
        "dow": 5,
        "dowGroup": "weekend",
        "dau": 2463,
        "views": 10760,
        "seconds": 6014658,
        "dauSmooth7": 2158.8571,
        "changePct": 17.678
      },
      {
        "date": "2026-09-06",
        "dow": 6,
        "dowGroup": "weekend",
        "dau": 2418,
        "views": 10465,
        "seconds": 5801888,
        "dauSmooth7": 2166.8571,
        "changePct": -1.827
      },
      {
        "date": "2026-09-07",
        "dow": 0,
        "dowGroup": "weekday",
        "dau": 2070,
        "views": 9164,
        "seconds": 5170419,
        "dauSmooth7": 2174.5714,
        "changePct": -14.3921
      },
      {
        "date": "2026-09-08",
        "dow": 1,
        "dowGroup": "weekday",
        "dau": 2051,
        "views": 8871,
        "seconds": 4971015,
        "dauSmooth7": 2176.8571,
        "changePct": -0.9179
      },
      {
        "date": "2026-09-09",
        "dow": 2,
        "dowGroup": "weekday",
        "dau": 2060,
        "views": 8926,
        "seconds": 4991877,
        "dauSmooth7": 2174.4286,
        "changePct": 0.4388
      },
      {
        "date": "2026-09-10",
        "dow": 3,
        "dowGroup": "weekday",
        "dau": 2050,
        "views": 9052,
        "seconds": 5077087,
        "dauSmooth7": 2172.1429,
        "changePct": -0.4854
      }
    ],
    "activeDaysHist": [
      {
        "days": 0,
        "users": 0
      },
      {
        "days": 1,
        "users": 0
      },
      {
        "days": 2,
        "users": 1
      },
      {
        "days": 3,
        "users": 5
      },
      {
        "days": 4,
        "users": 4
      },
      {
        "days": 5,
        "users": 32
      },
      {
        "days": 6,
        "users": 49
      },
      {
        "days": 7,
        "users": 76
      },
      {
        "days": 8,
        "users": 98
      },
      {
        "days": 9,
        "users": 97
      },
      {
        "days": 10,
        "users": 152
      },
      {
        "days": 11,
        "users": 179
      },
      {
        "days": 12,
        "users": 199
      },
      {
        "days": 13,
        "users": 221
      },
      {
        "days": 14,
        "users": 255
      },
      {
        "days": 15,
        "users": 256
      },
      {
        "days": 16,
        "users": 235
      },
      {
        "days": 17,
        "users": 261
      },
      {
        "days": 18,
        "users": 267
      },
      {
        "days": 19,
        "users": 271
      },
      {
        "days": 20,
        "users": 272
      },
      {
        "days": 21,
        "users": 260
      },
      {
        "days": 22,
        "users": 231
      },
      {
        "days": 23,
        "users": 250
      },
      {
        "days": 24,
        "users": 208
      },
      {
        "days": 25,
        "users": 224
      },
      {
        "days": 26,
        "users": 199
      },
      {
        "days": 27,
        "users": 161
      },
      {
        "days": 28,
        "users": 192
      },
      {
        "days": 29,
        "users": 174
      },
      {
        "days": 30,
        "users": 171
      },
      {
        "days": 31,
        "users": 147
      },
      {
        "days": 32,
        "users": 155
      },
      {
        "days": 33,
        "users": 104
      },
      {
        "days": 34,
        "users": 110
      },
      {
        "days": 35,
        "users": 112
      },
      {
        "days": 36,
        "users": 91
      },
      {
        "days": 37,
        "users": 67
      },
      {
        "days": 38,
        "users": 57
      },
      {
        "days": 39,
        "users": 58
      },
      {
        "days": 40,
        "users": 32
      },
      {
        "days": 41,
        "users": 25
      },
      {
        "days": 42,
        "users": 16
      },
      {
        "days": 43,
        "users": 14
      },
      {
        "days": 44,
        "users": 7
      },
      {
        "days": 45,
        "users": 2
      },
      {
        "days": 46,
        "users": 3
      },
      {
        "days": 47,
        "users": 0
      },
      {
        "days": 48,
        "users": 0
      },
      {
        "days": 49,
        "users": 0
      },
      {
        "days": 50,
        "users": 0
      },
      {
        "days": 51,
        "users": 0
      },
      {
        "days": 52,
        "users": 0
      },
      {
        "days": 53,
        "users": 0
      },
      {
        "days": 54,
        "users": 0
      },
      {
        "days": 55,
        "users": 0
      },
      {
        "days": 56,
        "users": 0
      },
      {
        "days": 57,
        "users": 0
      },
      {
        "days": 58,
        "users": 0
      },
      {
        "days": 59,
        "users": 0
      },
      {
        "days": 60,
        "users": 0
      }
    ],
    "neverActiveUsers": 0,
    "avgActiveDays": 21.5487,
    "volatility": {
      "stdPct": 7.9952,
      "meanAbsPct": 5.573,
      "maxAbsPct": 17.678,
      "maxAbsDate": "2026-09-05"
    }
  },
  "tiers": [
    {
      "id": "Q1 最低",
      "users": 1500,
      "minMinutes": 0.9794,
      "maxMinutes": 9.9889,
      "avgActiveDays": 11.8267,
      "totalMinutes": 11014.0508,
      "minutesShare": 12.47,
      "viewsShare": 12.1195,
      "topCategories": [
        {
          "category": "生活",
          "share": 18.8011
        },
        {
          "category": "游戏",
          "share": 17.6708
        },
        {
          "category": "知识",
          "share": 17.1531
        }
      ]
    },
    {
      "id": "Q2",
      "users": 1500,
      "minMinutes": 9.9933,
      "maxMinutes": 14.1347,
      "avgActiveDays": 18.1527,
      "totalMinutes": 18100.8369,
      "minutesShare": 20.4936,
      "viewsShare": 20.1386,
      "topCategories": [
        {
          "category": "游戏",
          "share": 20.2937
        },
        {
          "category": "生活",
          "share": 17.636
        },
        {
          "category": "知识",
          "share": 15.1827
        }
      ]
    },
    {
      "id": "Q3",
      "users": 1500,
      "minMinutes": 14.1369,
      "maxMinutes": 18.8733,
      "avgActiveDays": 23.928,
      "totalMinutes": 24577.6536,
      "minutesShare": 27.8265,
      "viewsShare": 27.7187,
      "topCategories": [
        {
          "category": "游戏",
          "share": 22.5066
        },
        {
          "category": "生活",
          "share": 17.0671
        },
        {
          "category": "娱乐",
          "share": 14.3308
        }
      ]
    },
    {
      "id": "Q4 最高",
      "users": 1500,
      "minMinutes": 18.8744,
      "maxMinutes": 36.3647,
      "avgActiveDays": 32.2873,
      "totalMinutes": 34632.0044,
      "minutesShare": 39.2099,
      "viewsShare": 40.0232,
      "topCategories": [
        {
          "category": "游戏",
          "share": 25.6855
        },
        {
          "category": "生活",
          "share": 15.8652
        },
        {
          "category": "娱乐",
          "share": 15.67
        }
      ]
    }
  ],
  "content": {
    "durationCompletionR": 0.0719,
    "videosAnalyzed": 1000,
    "categories": [
      {
        "category": "游戏",
        "videos": 123,
        "medianDuration": 1610.0,
        "plays": 128690,
        "avgCompletedRate": 11.9558,
        "avgWatchSeconds": 681.934
      },
      {
        "category": "知识",
        "videos": 124,
        "medianDuration": 2047.0,
        "plays": 76609,
        "avgCompletedRate": 14.6874,
        "avgWatchSeconds": 903.1928
      },
      {
        "category": "科技",
        "videos": 122,
        "medianDuration": 1290.0,
        "plays": 74372,
        "avgCompletedRate": 13.9073,
        "avgWatchSeconds": 565.455
      },
      {
        "category": "生活",
        "videos": 117,
        "medianDuration": 644.0,
        "plays": 95671,
        "avgCompletedRate": 13.8244,
        "avgWatchSeconds": 287.7377
      },
      {
        "category": "娱乐",
        "videos": 130,
        "medianDuration": 302.5,
        "plays": 82118,
        "avgCompletedRate": 12.1712,
        "avgWatchSeconds": 133.2398
      },
      {
        "category": "动画",
        "videos": 121,
        "medianDuration": 1456.0,
        "plays": 52688,
        "avgCompletedRate": 11.3166,
        "avgWatchSeconds": 615.2923
      },
      {
        "category": "影视",
        "videos": 123,
        "medianDuration": 2970.0,
        "plays": 34280,
        "avgCompletedRate": 14.5459,
        "avgWatchSeconds": 1306.9687
      },
      {
        "category": "音乐",
        "videos": 140,
        "medianDuration": 324.0,
        "plays": 21312,
        "avgCompletedRate": 15.1429,
        "avgWatchSeconds": 146.231
      }
    ]
  },
  "cross": {
    "tierCategory": [
      {
        "tier": "Q1 最低",
        "totalViews": 68565,
        "cells": [
          {
            "category": "游戏",
            "views": 12116,
            "share": 17.6708
          },
          {
            "category": "知识",
            "views": 11761,
            "share": 17.1531
          },
          {
            "category": "科技",
            "views": 10140,
            "share": 14.7889
          },
          {
            "category": "生活",
            "views": 12891,
            "share": 18.8011
          },
          {
            "category": "娱乐",
            "views": 8655,
            "share": 12.6231
          },
          {
            "category": "动画",
            "views": 4520,
            "share": 6.5923
          },
          {
            "category": "影视",
            "views": 4945,
            "share": 7.2121
          },
          {
            "category": "音乐",
            "views": 3537,
            "share": 5.1586
          }
        ]
      },
      {
        "tier": "Q2",
        "totalViews": 113932,
        "cells": [
          {
            "category": "游戏",
            "views": 23121,
            "share": 20.2937
          },
          {
            "category": "知识",
            "views": 17298,
            "share": 15.1827
          },
          {
            "category": "科技",
            "views": 16122,
            "share": 14.1505
          },
          {
            "category": "生活",
            "views": 20093,
            "share": 17.636
          },
          {
            "category": "娱乐",
            "views": 15509,
            "share": 13.6125
          },
          {
            "category": "动画",
            "views": 9328,
            "share": 8.1873
          },
          {
            "category": "影视",
            "views": 7412,
            "share": 6.5056
          },
          {
            "category": "音乐",
            "views": 5049,
            "share": 4.4316
          }
        ]
      },
      {
        "tier": "Q3",
        "totalViews": 156816,
        "cells": [
          {
            "category": "游戏",
            "views": 35294,
            "share": 22.5066
          },
          {
            "category": "知识",
            "views": 21529,
            "share": 13.7288
          },
          {
            "category": "科技",
            "views": 21190,
            "share": 13.5127
          },
          {
            "category": "生活",
            "views": 26764,
            "share": 17.0671
          },
          {
            "category": "娱乐",
            "views": 22473,
            "share": 14.3308
          },
          {
            "category": "动画",
            "views": 14103,
            "share": 8.9933
          },
          {
            "category": "影视",
            "views": 9559,
            "share": 6.0957
          },
          {
            "category": "音乐",
            "views": 5904,
            "share": 3.7649
          }
        ]
      },
      {
        "tier": "Q4 最高",
        "totalViews": 226427,
        "cells": [
          {
            "category": "游戏",
            "views": 58159,
            "share": 25.6855
          },
          {
            "category": "知识",
            "views": 26021,
            "share": 11.492
          },
          {
            "category": "科技",
            "views": 26920,
            "share": 11.889
          },
          {
            "category": "生活",
            "views": 35923,
            "share": 15.8652
          },
          {
            "category": "娱乐",
            "views": 35481,
            "share": 15.67
          },
          {
            "category": "动画",
            "views": 24737,
            "share": 10.9249
          },
          {
            "category": "影视",
            "views": 12364,
            "share": 5.4605
          },
          {
            "category": "音乐",
            "views": 6822,
            "share": 3.0129
          }
        ]
      }
    ],
    "preferenceSimilarity": [
      {
        "a": "18-24",
        "b": "25-31",
        "cosine": 0.9408
      },
      {
        "a": "18-24",
        "b": "32-40",
        "cosine": 0.7911
      },
      {
        "a": "18-24",
        "b": "40+",
        "cosine": 0.6591
      },
      {
        "a": "25-31",
        "b": "32-40",
        "cosine": 0.9486
      },
      {
        "a": "25-31",
        "b": "40+",
        "cosine": 0.8571
      },
      {
        "a": "32-40",
        "b": "40+",
        "cosine": 0.9708
      }
    ]
  },
  "trend": {
    "dowEffect": [
      {
        "group": "weekday",
        "label": "工作日",
        "avgDau": 2041.8056,
        "ratioToWeekday": 1.0,
        "days": 36
      },
      {
        "group": "friday",
        "label": "周五",
        "avgDau": 2138.75,
        "ratioToWeekday": 1.0475,
        "days": 8
      },
      {
        "group": "weekend",
        "label": "周末",
        "avgDau": 2417.3125,
        "ratioToWeekday": 1.1839,
        "days": 16
      }
    ],
    "weekdayBaselineDau": 2041.8056
  },
  "windows": {
    "7": {
      "days": 7,
      "startDate": "2026-09-04",
      "endDate": "2026-09-10",
      "totalUsers": 6000,
      "totalUsersByAge": {
        "18-24": 1913.0,
        "25-31": 1778.0,
        "32-40": 1449.0,
        "40+": 860.0
      },
      "newUsersInWindow": 446,
      "dau": 2172.1429,
      "dauByAge": {
        "18-24": 802.2857,
        "25-31": 698.7143,
        "32-40": 460.4286,
        "40+": 210.7143
      },
      "activeUsers": 5560,
      "activeUsersByAge": {
        "18-24": 1826.0,
        "25-31": 1685.0,
        "32-40": 1328.0,
        "40+": 721.0
      },
      "totalViews": 66399,
      "viewsByAge": {
        "18-24": 26941.0,
        "25-31": 21862.0,
        "32-40": 12599.0,
        "40+": 4997.0
      },
      "totalSeconds": 37163363,
      "secondsByAge": {
        "18-24": 13775255.0,
        "25-31": 12121221.0,
        "32-40": 7703751.0,
        "40+": 3563136.0
      },
      "engagedUsers": 4100,
      "totalLikes": 5016,
      "totalFavorites": 2869,
      "totalComments": 1398,
      "totalShares": 898,
      "byCategory": {
        "游戏": {
          "views": 15114,
          "seconds": 10344126,
          "likes": 970,
          "favorites": 338,
          "comments": 245,
          "shares": 164,
          "completed": 1784,
          "viewers": 4419
        },
        "知识": {
          "views": 9010,
          "seconds": 8122730,
          "likes": 839,
          "favorites": 797,
          "comments": 189,
          "shares": 150,
          "completed": 1304,
          "viewers": 4085
        },
        "科技": {
          "views": 8685,
          "seconds": 4833499,
          "likes": 739,
          "favorites": 633,
          "comments": 155,
          "shares": 117,
          "completed": 1189,
          "viewers": 4052
        },
        "生活": {
          "views": 11215,
          "seconds": 3241924,
          "likes": 764,
          "favorites": 322,
          "comments": 215,
          "shares": 111,
          "completed": 1554,
          "viewers": 4491
        },
        "娱乐": {
          "views": 9673,
          "seconds": 1297607,
          "likes": 549,
          "favorites": 135,
          "comments": 253,
          "shares": 181,
          "completed": 1196,
          "viewers": 3995
        },
        "动画": {
          "views": 6229,
          "seconds": 3773743,
          "likes": 628,
          "favorites": 405,
          "comments": 173,
          "shares": 82,
          "completed": 622,
          "viewers": 3068
        },
        "影视": {
          "views": 3948,
          "seconds": 5185697,
          "likes": 298,
          "favorites": 165,
          "comments": 89,
          "shares": 38,
          "completed": 614,
          "viewers": 2679
        },
        "音乐": {
          "views": 2525,
          "seconds": 364037,
          "likes": 229,
          "favorites": 74,
          "comments": 79,
          "shares": 55,
          "completed": 381,
          "viewers": 1910
        }
      },
      "agePreference": [
        {
          "age": "18-24",
          "activeUsers": 1826,
          "totalViews": 26941,
          "cells": [
            {
              "category": "游戏",
              "views": 8162,
              "viewers": 1723,
              "seconds": 5283490.0,
              "share": 30.2958,
              "coverage": 94.3593,
              "avgMinutes": 10.7888,
              "completedRate": 8.6988,
              "engageRate": 12.2274
            },
            {
              "category": "娱乐",
              "views": 4839,
              "viewers": 1580,
              "seconds": 620927.0,
              "share": 17.9615,
              "coverage": 86.5279,
              "avgMinutes": 2.1386,
              "completedRate": 9.2168,
              "engageRate": 12.4199
            },
            {
              "category": "动画",
              "views": 3780,
              "viewers": 1482,
              "seconds": 2220001.0,
              "share": 14.0307,
              "coverage": 81.161,
              "avgMinutes": 9.7884,
              "completedRate": 7.8836,
              "engageRate": 21.1111
            },
            {
              "category": "生活",
              "views": 3714,
              "viewers": 1502,
              "seconds": 982095.0,
              "share": 13.7857,
              "coverage": 82.2563,
              "avgMinutes": 4.4072,
              "completedRate": 9.2623,
              "engageRate": 13.1395
            },
            {
              "category": "科技",
              "views": 2466,
              "viewers": 1256,
              "seconds": 1266694.0,
              "share": 9.1533,
              "coverage": 68.7842,
              "avgMinutes": 8.5611,
              "completedRate": 7.7453,
              "engageRate": 21.249
            },
            {
              "category": "知识",
              "views": 2101,
              "viewers": 1175,
              "seconds": 1726410.0,
              "share": 7.7985,
              "coverage": 64.3483,
              "avgMinutes": 13.6951,
              "completedRate": 8.2818,
              "engageRate": 23.7506
            },
            {
              "category": "影视",
              "views": 1339,
              "viewers": 921,
              "seconds": 1600840.0,
              "share": 4.9701,
              "coverage": 50.4381,
              "avgMinutes": 19.9258,
              "completedRate": 10.0822,
              "engageRate": 16.7289
            },
            {
              "category": "音乐",
              "views": 540,
              "viewers": 441,
              "seconds": 74798.0,
              "share": 2.0044,
              "coverage": 24.1512,
              "avgMinutes": 2.3086,
              "completedRate": 8.8889,
              "engageRate": 20.0
            }
          ]
        },
        {
          "age": "25-31",
          "activeUsers": 1685,
          "totalViews": 21862,
          "cells": [
            {
              "category": "游戏",
              "views": 4788,
              "viewers": 1508,
              "seconds": 3419860.0,
              "share": 21.901,
              "coverage": 89.4955,
              "avgMinutes": 11.9043,
              "completedRate": 14.3066,
              "engageRate": 11.1529
            },
            {
              "category": "生活",
              "views": 3991,
              "viewers": 1425,
              "seconds": 1143185.0,
              "share": 18.2554,
              "coverage": 84.5697,
              "avgMinutes": 4.774,
              "completedRate": 13.3801,
              "engageRate": 12.5282
            },
            {
              "category": "科技",
              "views": 3165,
              "viewers": 1349,
              "seconds": 1771526.0,
              "share": 14.4772,
              "coverage": 80.0593,
              "avgMinutes": 9.3287,
              "completedRate": 14.5024,
              "engageRate": 18.831
            },
            {
              "category": "娱乐",
              "views": 3125,
              "viewers": 1325,
              "seconds": 425735.0,
              "share": 14.2942,
              "coverage": 78.635,
              "avgMinutes": 2.2706,
              "completedRate": 14.176,
              "engageRate": 10.528
            },
            {
              "category": "知识",
              "views": 3029,
              "viewers": 1293,
              "seconds": 2703995.0,
              "share": 13.8551,
              "coverage": 76.7359,
              "avgMinutes": 14.8784,
              "completedRate": 14.1961,
              "engageRate": 22.5157
            },
            {
              "category": "动画",
              "views": 1803,
              "viewers": 1047,
              "seconds": 1137142.0,
              "share": 8.2472,
              "coverage": 62.1365,
              "avgMinutes": 10.5116,
              "completedRate": 12.7011,
              "engageRate": 20.9651
            },
            {
              "category": "影视",
              "views": 1075,
              "viewers": 752,
              "seconds": 1396741.0,
              "share": 4.9172,
              "coverage": 44.6291,
              "avgMinutes": 21.6549,
              "completedRate": 15.7209,
              "engageRate": 15.6279
            },
            {
              "category": "音乐",
              "views": 886,
              "viewers": 663,
              "seconds": 123037.0,
              "share": 4.0527,
              "coverage": 39.3472,
              "avgMinutes": 2.3145,
              "completedRate": 14.1084,
              "engageRate": 16.3657
            }
          ]
        },
        {
          "age": "32-40",
          "activeUsers": 1328,
          "totalViews": 12599,
          "cells": [
            {
              "category": "知识",
              "views": 2599,
              "viewers": 1064,
              "seconds": 2422130.0,
              "share": 20.6286,
              "coverage": 80.1205,
              "avgMinutes": 15.5324,
              "completedRate": 16.8911,
              "engageRate": 20.0077
            },
            {
              "category": "生活",
              "views": 2483,
              "viewers": 1054,
              "seconds": 771474.0,
              "share": 19.7079,
              "coverage": 79.3675,
              "avgMinutes": 5.1784,
              "completedRate": 17.7205,
              "engageRate": 12.7265
            },
            {
              "category": "科技",
              "views": 2257,
              "viewers": 1015,
              "seconds": 1310153.0,
              "share": 17.9141,
              "coverage": 76.4307,
              "avgMinutes": 9.6747,
              "completedRate": 17.2353,
              "engageRate": 16.8808
            },
            {
              "category": "游戏",
              "views": 1769,
              "viewers": 891,
              "seconds": 1303629.0,
              "share": 14.0408,
              "coverage": 67.0934,
              "avgMinutes": 12.2822,
              "completedRate": 16.45,
              "engageRate": 8.4794
            },
            {
              "category": "娱乐",
              "views": 1297,
              "viewers": 796,
              "seconds": 186454.0,
              "share": 10.2945,
              "coverage": 59.9398,
              "avgMinutes": 2.396,
              "completedRate": 16.8851,
              "engageRate": 11.5652
            },
            {
              "category": "影视",
              "views": 937,
              "viewers": 646,
              "seconds": 1289200.0,
              "share": 7.4371,
              "coverage": 48.6446,
              "avgMinutes": 22.9313,
              "completedRate": 18.8901,
              "engageRate": 13.3404
            },
            {
              "category": "音乐",
              "views": 760,
              "viewers": 543,
              "seconds": 111959.0,
              "share": 6.0322,
              "coverage": 40.8886,
              "avgMinutes": 2.4552,
              "completedRate": 18.0263,
              "engageRate": 16.5789
            },
            {
              "category": "动画",
              "views": 497,
              "viewers": 408,
              "seconds": 308752.0,
              "share": 3.9448,
              "coverage": 30.7229,
              "avgMinutes": 10.3539,
              "completedRate": 14.0845,
              "engageRate": 17.1026
            }
          ]
        },
        {
          "age": "40+",
          "activeUsers": 721,
          "totalViews": 4997,
          "cells": [
            {
              "category": "知识",
              "views": 1281,
              "viewers": 553,
              "seconds": 1270195.0,
              "share": 25.6354,
              "coverage": 76.699,
              "avgMinutes": 16.5261,
              "completedRate": 20.3747,
              "engageRate": 21.3895
            },
            {
              "category": "生活",
              "views": 1027,
              "viewers": 510,
              "seconds": 345170.0,
              "share": 20.5523,
              "coverage": 70.7351,
              "avgMinutes": 5.6016,
              "completedRate": 22.9796,
              "engageRate": 10.5161
            },
            {
              "category": "科技",
              "views": 797,
              "viewers": 432,
              "seconds": 485126.0,
              "share": 15.9496,
              "coverage": 59.9168,
              "avgMinutes": 10.1448,
              "completedRate": 18.8206,
              "engageRate": 17.9423
            },
            {
              "category": "影视",
              "views": 597,
              "viewers": 360,
              "seconds": 898916.0,
              "share": 11.9472,
              "coverage": 49.9307,
              "avgMinutes": 25.0954,
              "completedRate": 22.2781,
              "engageRate": 12.2278
            },
            {
              "category": "娱乐",
              "views": 412,
              "viewers": 294,
              "seconds": 64491.0,
              "share": 8.2449,
              "coverage": 40.7767,
              "avgMinutes": 2.6089,
              "completedRate": 21.3592,
              "engageRate": 9.2233
            },
            {
              "category": "游戏",
              "views": 395,
              "viewers": 297,
              "seconds": 337147.0,
              "share": 7.9047,
              "coverage": 41.1928,
              "avgMinutes": 14.2256,
              "completedRate": 24.8101,
              "engageRate": 8.8608
            },
            {
              "category": "音乐",
              "views": 339,
              "viewers": 263,
              "seconds": 54243.0,
              "share": 6.7841,
              "coverage": 36.4771,
              "avgMinutes": 2.6668,
              "completedRate": 20.944,
              "engageRate": 17.1091
            },
            {
              "category": "动画",
              "views": 149,
              "viewers": 131,
              "seconds": 107848.0,
              "share": 2.9818,
              "coverage": 18.1692,
              "avgMinutes": 12.0635,
              "completedRate": 16.7785,
              "engageRate": 18.1208
            }
          ]
        }
      ],
      "categoryTrend": {
        "firstStart": "2026-09-04",
        "firstEnd": "2026-09-06",
        "firstDays": 3,
        "secondStart": "2026-09-07",
        "secondEnd": "2026-09-10",
        "secondDays": 4,
        "categories": [
          {
            "category": "影视",
            "firstViews": 1763,
            "secondViews": 2185,
            "firstDailyViews": 587.6667,
            "secondDailyViews": 546.25,
            "growthPct": -7.0476
          },
          {
            "category": "动画",
            "firstViews": 2786,
            "secondViews": 3443,
            "firstDailyViews": 928.6667,
            "secondDailyViews": 860.75,
            "growthPct": -7.3134
          },
          {
            "category": "音乐",
            "firstViews": 1151,
            "secondViews": 1374,
            "firstDailyViews": 383.6667,
            "secondDailyViews": 343.5,
            "growthPct": -10.4692
          },
          {
            "category": "娱乐",
            "firstViews": 4418,
            "secondViews": 5255,
            "firstDailyViews": 1472.6667,
            "secondDailyViews": 1313.75,
            "growthPct": -10.7911
          },
          {
            "category": "科技",
            "firstViews": 3969,
            "secondViews": 4716,
            "firstDailyViews": 1323.0,
            "secondDailyViews": 1179.0,
            "growthPct": -10.8844
          },
          {
            "category": "知识",
            "firstViews": 4133,
            "secondViews": 4877,
            "firstDailyViews": 1377.6667,
            "secondDailyViews": 1219.25,
            "growthPct": -11.4989
          },
          {
            "category": "游戏",
            "firstViews": 6944,
            "secondViews": 8170,
            "firstDailyViews": 2314.6667,
            "secondDailyViews": 2042.5,
            "growthPct": -11.7584
          },
          {
            "category": "生活",
            "firstViews": 5222,
            "secondViews": 5993,
            "firstDailyViews": 1740.6667,
            "secondDailyViews": 1498.25,
            "growthPct": -13.9267
          }
        ]
      },
      "segmentTrend": {
        "firstStart": "2026-09-04",
        "firstEnd": "2026-09-06",
        "firstDays": 3,
        "secondStart": "2026-09-07",
        "secondEnd": "2026-09-10",
        "secondDays": 4,
        "firstActiveUserDays": 6974,
        "secondActiveUserDays": 8231,
        "segments": [
          {
            "age": "18-24",
            "totalUsers": 1913,
            "firstActiveUserDays": 2571,
            "firstDau": 857.0,
            "firstDailyActiveRate": 44.7987,
            "secondActiveUserDays": 3045,
            "secondDau": 761.25,
            "secondDailyActiveRate": 39.7935,
            "changePp": -5.0052
          },
          {
            "age": "25-31",
            "totalUsers": 1778,
            "firstActiveUserDays": 2265,
            "firstDau": 755.0,
            "firstDailyActiveRate": 42.4634,
            "secondActiveUserDays": 2626,
            "secondDau": 656.5,
            "secondDailyActiveRate": 36.9235,
            "changePp": -5.5399
          },
          {
            "age": "32-40",
            "totalUsers": 1449,
            "firstActiveUserDays": 1477,
            "firstDau": 492.3333,
            "firstDailyActiveRate": 33.9775,
            "secondActiveUserDays": 1746,
            "secondDau": 436.5,
            "secondDailyActiveRate": 30.1242,
            "changePp": -3.8532
          },
          {
            "age": "40+",
            "totalUsers": 860,
            "firstActiveUserDays": 661,
            "firstDau": 220.3333,
            "firstDailyActiveRate": 25.6202,
            "secondActiveUserDays": 814,
            "secondDau": 203.5,
            "secondDailyActiveRate": 23.6628,
            "changePp": -1.9574
          }
        ]
      }
    },
    "14": {
      "days": 14,
      "startDate": "2026-08-28",
      "endDate": "2026-09-10",
      "totalUsers": 6000,
      "totalUsersByAge": {
        "18-24": 1913.0,
        "25-31": 1778.0,
        "32-40": 1449.0,
        "40+": 860.0
      },
      "newUsersInWindow": 647,
      "dau": 2168.3571,
      "dauByAge": {
        "18-24": 801.0714,
        "25-31": 699.8571,
        "32-40": 457.0,
        "40+": 210.4286
      },
      "activeUsers": 5916,
      "activeUsersByAge": {
        "18-24": 1901.0,
        "25-31": 1761.0,
        "32-40": 1418.0,
        "40+": 836.0
      },
      "totalViews": 132563,
      "viewsByAge": {
        "18-24": 53630.0,
        "25-31": 43771.0,
        "32-40": 25114.0,
        "40+": 10048.0
      },
      "totalSeconds": 74366761,
      "secondsByAge": {
        "18-24": 27443820.0,
        "25-31": 24367373.0,
        "32-40": 15519983.0,
        "40+": 7035585.0
      },
      "engagedUsers": 5255,
      "totalLikes": 10020,
      "totalFavorites": 5865,
      "totalComments": 2763,
      "totalShares": 1740,
      "byCategory": {
        "游戏": {
          "views": 29956,
          "seconds": 20573786,
          "likes": 1963,
          "favorites": 694,
          "comments": 496,
          "shares": 311,
          "completed": 3610,
          "viewers": 5312
        },
        "知识": {
          "views": 17879,
          "seconds": 16056350,
          "likes": 1662,
          "favorites": 1662,
          "comments": 358,
          "shares": 300,
          "completed": 2605,
          "viewers": 5279
        },
        "科技": {
          "views": 17552,
          "seconds": 9878892,
          "likes": 1439,
          "favorites": 1285,
          "comments": 291,
          "shares": 219,
          "completed": 2457,
          "viewers": 5248
        },
        "生活": {
          "views": 22405,
          "seconds": 6449448,
          "likes": 1565,
          "favorites": 589,
          "comments": 468,
          "shares": 223,
          "completed": 3088,
          "viewers": 5478
        },
        "娱乐": {
          "views": 19374,
          "seconds": 2593016,
          "likes": 1129,
          "favorites": 268,
          "comments": 477,
          "shares": 326,
          "completed": 2358,
          "viewers": 5086
        },
        "动画": {
          "views": 12370,
          "seconds": 7598829,
          "likes": 1280,
          "favorites": 846,
          "comments": 358,
          "shares": 180,
          "completed": 1325,
          "viewers": 4190
        },
        "影视": {
          "views": 8005,
          "seconds": 10485454,
          "likes": 563,
          "favorites": 333,
          "comments": 163,
          "shares": 71,
          "completed": 1207,
          "viewers": 4108
        },
        "音乐": {
          "views": 5022,
          "seconds": 730986,
          "likes": 419,
          "favorites": 188,
          "comments": 152,
          "shares": 110,
          "completed": 758,
          "viewers": 3135
        }
      },
      "agePreference": [
        {
          "age": "18-24",
          "activeUsers": 1901,
          "totalViews": 53630,
          "cells": [
            {
              "category": "游戏",
              "views": 15971,
              "viewers": 1884,
              "seconds": 10386119.0,
              "share": 29.78,
              "coverage": 99.1057,
              "avgMinutes": 10.8385,
              "completedRate": 8.8849,
              "engageRate": 12.4663
            },
            {
              "category": "娱乐",
              "views": 9736,
              "viewers": 1844,
              "seconds": 1241749.0,
              "share": 18.154,
              "coverage": 97.0016,
              "avgMinutes": 2.1257,
              "completedRate": 9.1721,
              "engageRate": 12.007
            },
            {
              "category": "动画",
              "views": 7524,
              "viewers": 1817,
              "seconds": 4447224.0,
              "share": 14.0295,
              "coverage": 95.5813,
              "avgMinutes": 9.8512,
              "completedRate": 8.2935,
              "engageRate": 22.5279
            },
            {
              "category": "生活",
              "views": 7493,
              "viewers": 1796,
              "seconds": 1987451.0,
              "share": 13.9717,
              "coverage": 94.4766,
              "avgMinutes": 4.4207,
              "completedRate": 8.8349,
              "engageRate": 13.973
            },
            {
              "category": "科技",
              "views": 4931,
              "viewers": 1660,
              "seconds": 2545456.0,
              "share": 9.1945,
              "coverage": 87.3225,
              "avgMinutes": 8.6036,
              "completedRate": 8.1525,
              "engageRate": 20.6652
            },
            {
              "category": "知识",
              "views": 4259,
              "viewers": 1592,
              "seconds": 3486015.0,
              "share": 7.9415,
              "coverage": 83.7454,
              "avgMinutes": 13.6418,
              "completedRate": 8.5231,
              "engageRate": 24.6302
            },
            {
              "category": "影视",
              "views": 2659,
              "viewers": 1343,
              "seconds": 3204812.0,
              "share": 4.958,
              "coverage": 70.647,
              "avgMinutes": 20.0878,
              "completedRate": 9.8533,
              "engageRate": 15.1937
            },
            {
              "category": "音乐",
              "views": 1057,
              "viewers": 752,
              "seconds": 144994.0,
              "share": 1.9709,
              "coverage": 39.5581,
              "avgMinutes": 2.2863,
              "completedRate": 9.65,
              "engageRate": 20.4352
            }
          ]
        },
        {
          "age": "25-31",
          "activeUsers": 1761,
          "totalViews": 43771,
          "cells": [
            {
              "category": "游戏",
              "views": 9608,
              "viewers": 1722,
              "seconds": 6874729.0,
              "share": 21.9506,
              "coverage": 97.7853,
              "avgMinutes": 11.9254,
              "completedRate": 14.4463,
              "engageRate": 11.0845
            },
            {
              "category": "生活",
              "views": 7925,
              "viewers": 1676,
              "seconds": 2271899.0,
              "share": 18.1056,
              "coverage": 95.1732,
              "avgMinutes": 4.7779,
              "completedRate": 14.0315,
              "engageRate": 12.4543
            },
            {
              "category": "科技",
              "views": 6546,
              "viewers": 1654,
              "seconds": 3722740.0,
              "share": 14.9551,
              "coverage": 93.9239,
              "avgMinutes": 9.4784,
              "completedRate": 15.0932,
              "engageRate": 18.3624
            },
            {
              "category": "娱乐",
              "views": 6246,
              "viewers": 1636,
              "seconds": 849544.0,
              "share": 14.2697,
              "coverage": 92.9018,
              "avgMinutes": 2.2669,
              "completedRate": 13.4966,
              "engageRate": 10.983
            },
            {
              "category": "知识",
              "views": 5979,
              "viewers": 1639,
              "seconds": 5277037.0,
              "share": 13.6597,
              "coverage": 93.0721,
              "avgMinutes": 14.7099,
              "completedRate": 13.9488,
              "engageRate": 22.9303
            },
            {
              "category": "动画",
              "views": 3553,
              "viewers": 1440,
              "seconds": 2284898.0,
              "share": 8.1172,
              "coverage": 81.7717,
              "avgMinutes": 10.7182,
              "completedRate": 13.6504,
              "engageRate": 20.8556
            },
            {
              "category": "影视",
              "views": 2193,
              "viewers": 1178,
              "seconds": 2842449.0,
              "share": 5.0102,
              "coverage": 66.8938,
              "avgMinutes": 21.6024,
              "completedRate": 14.6831,
              "engageRate": 14.4095
            },
            {
              "category": "音乐",
              "views": 1721,
              "viewers": 1066,
              "seconds": 244077.0,
              "share": 3.9318,
              "coverage": 60.5338,
              "avgMinutes": 2.3637,
              "completedRate": 14.2359,
              "engageRate": 16.502
            }
          ]
        },
        {
          "age": "32-40",
          "activeUsers": 1418,
          "totalViews": 25114,
          "cells": [
            {
              "category": "知识",
              "views": 5107,
              "viewers": 1303,
              "seconds": 4817152.0,
              "share": 20.3353,
              "coverage": 91.89,
              "avgMinutes": 15.7207,
              "completedRate": 17.7991,
              "engageRate": 20.325
            },
            {
              "category": "生活",
              "views": 4941,
              "viewers": 1303,
              "seconds": 1519532.0,
              "share": 19.6743,
              "coverage": 91.89,
              "avgMinutes": 5.1256,
              "completedRate": 17.5875,
              "engageRate": 12.0826
            },
            {
              "category": "科技",
              "views": 4474,
              "viewers": 1282,
              "seconds": 2630258.0,
              "share": 17.8148,
              "coverage": 90.409,
              "avgMinutes": 9.7983,
              "completedRate": 16.8976,
              "engageRate": 16.7859
            },
            {
              "category": "游戏",
              "views": 3578,
              "viewers": 1220,
              "seconds": 2666411.0,
              "share": 14.247,
              "coverage": 86.0367,
              "avgMinutes": 12.4204,
              "completedRate": 17.5797,
              "engageRate": 9.1951
            },
            {
              "category": "娱乐",
              "views": 2557,
              "viewers": 1114,
              "seconds": 369820.0,
              "share": 10.1816,
              "coverage": 78.5614,
              "avgMinutes": 2.4105,
              "completedRate": 17.3641,
              "engageRate": 10.7548
            },
            {
              "category": "影视",
              "views": 1932,
              "viewers": 991,
              "seconds": 2635982.0,
              "share": 7.6929,
              "coverage": 69.8872,
              "avgMinutes": 22.7397,
              "completedRate": 18.0124,
              "engageRate": 13.9752
            },
            {
              "category": "音乐",
              "views": 1529,
              "viewers": 873,
              "seconds": 230448.0,
              "share": 6.0882,
              "coverage": 61.5656,
              "avgMinutes": 2.512,
              "completedRate": 18.2472,
              "engageRate": 17.2008
            },
            {
              "category": "动画",
              "views": 996,
              "viewers": 697,
              "seconds": 650380.0,
              "share": 3.9659,
              "coverage": 49.1537,
              "avgMinutes": 10.8832,
              "completedRate": 16.1647,
              "engageRate": 16.7671
            }
          ]
        },
        {
          "age": "40+",
          "activeUsers": 836,
          "totalViews": 10048,
          "cells": [
            {
              "category": "知识",
              "views": 2534,
              "viewers": 745,
              "seconds": 2476146.0,
              "share": 25.2189,
              "coverage": 89.1148,
              "avgMinutes": 16.2861,
              "completedRate": 19.6922,
              "engageRate": 20.6788
            },
            {
              "category": "生活",
              "views": 2046,
              "viewers": 703,
              "seconds": 670566.0,
              "share": 20.3623,
              "coverage": 84.0909,
              "avgMinutes": 5.4624,
              "completedRate": 21.7498,
              "engageRate": 10.4594
            },
            {
              "category": "科技",
              "views": 1601,
              "viewers": 652,
              "seconds": 980438.0,
              "share": 15.9335,
              "coverage": 77.9904,
              "avgMinutes": 10.2065,
              "completedRate": 19.4254,
              "engageRate": 16.3648
            },
            {
              "category": "影视",
              "views": 1221,
              "viewers": 596,
              "seconds": 1802211.0,
              "share": 12.1517,
              "coverage": 71.2919,
              "avgMinutes": 24.6002,
              "completedRate": 22.5225,
              "engageRate": 11.466
            },
            {
              "category": "娱乐",
              "views": 835,
              "viewers": 492,
              "seconds": 131903.0,
              "share": 8.3101,
              "coverage": 58.8517,
              "avgMinutes": 2.6328,
              "completedRate": 21.3174,
              "engageRate": 8.3832
            },
            {
              "category": "游戏",
              "views": 799,
              "viewers": 486,
              "seconds": 646527.0,
              "share": 7.9518,
              "coverage": 58.134,
              "avgMinutes": 13.4862,
              "completedRate": 21.7772,
              "engageRate": 9.8874
            },
            {
              "category": "音乐",
              "views": 715,
              "viewers": 444,
              "seconds": 111467.0,
              "share": 7.1158,
              "coverage": 53.11,
              "avgMinutes": 2.5983,
              "completedRate": 18.4615,
              "engageRate": 14.8252
            },
            {
              "category": "动画",
              "views": 297,
              "viewers": 236,
              "seconds": 216327.0,
              "share": 2.9558,
              "coverage": 28.2297,
              "avgMinutes": 12.1396,
              "completedRate": 18.5185,
              "engageRate": 20.5387
            }
          ]
        }
      ],
      "categoryTrend": {
        "firstStart": "2026-08-28",
        "firstEnd": "2026-09-03",
        "firstDays": 7,
        "secondStart": "2026-09-04",
        "secondEnd": "2026-09-10",
        "secondDays": 7,
        "categories": [
          {
            "category": "游戏",
            "firstViews": 14842,
            "secondViews": 15114,
            "firstDailyViews": 2120.2857,
            "secondDailyViews": 2159.1429,
            "growthPct": 1.8326
          },
          {
            "category": "知识",
            "firstViews": 8869,
            "secondViews": 9010,
            "firstDailyViews": 1267.0,
            "secondDailyViews": 1287.1429,
            "growthPct": 1.5898
          },
          {
            "category": "动画",
            "firstViews": 6141,
            "secondViews": 6229,
            "firstDailyViews": 877.2857,
            "secondDailyViews": 889.8571,
            "growthPct": 1.433
          },
          {
            "category": "音乐",
            "firstViews": 2497,
            "secondViews": 2525,
            "firstDailyViews": 356.7143,
            "secondDailyViews": 360.7143,
            "growthPct": 1.1213
          },
          {
            "category": "生活",
            "firstViews": 11190,
            "secondViews": 11215,
            "firstDailyViews": 1598.5714,
            "secondDailyViews": 1602.1429,
            "growthPct": 0.2234
          },
          {
            "category": "娱乐",
            "firstViews": 9701,
            "secondViews": 9673,
            "firstDailyViews": 1385.8571,
            "secondDailyViews": 1381.8571,
            "growthPct": -0.2886
          },
          {
            "category": "科技",
            "firstViews": 8867,
            "secondViews": 8685,
            "firstDailyViews": 1266.7143,
            "secondDailyViews": 1240.7143,
            "growthPct": -2.0526
          },
          {
            "category": "影视",
            "firstViews": 4057,
            "secondViews": 3948,
            "firstDailyViews": 579.5714,
            "secondDailyViews": 564.0,
            "growthPct": -2.6867
          }
        ]
      },
      "segmentTrend": {
        "firstStart": "2026-08-28",
        "firstEnd": "2026-09-03",
        "firstDays": 7,
        "secondStart": "2026-09-04",
        "secondEnd": "2026-09-10",
        "secondDays": 7,
        "firstActiveUserDays": 15152,
        "secondActiveUserDays": 15205,
        "segments": [
          {
            "age": "18-24",
            "totalUsers": 1913,
            "firstActiveUserDays": 5599,
            "firstDau": 799.8571,
            "firstDailyActiveRate": 41.8117,
            "secondActiveUserDays": 5616,
            "secondDau": 802.2857,
            "secondDailyActiveRate": 41.9386,
            "changePp": 0.127
          },
          {
            "age": "25-31",
            "totalUsers": 1778,
            "firstActiveUserDays": 4907,
            "firstDau": 701.0,
            "firstDailyActiveRate": 39.4263,
            "secondActiveUserDays": 4891,
            "secondDau": 698.7143,
            "secondDailyActiveRate": 39.2978,
            "changePp": -0.1286
          },
          {
            "age": "32-40",
            "totalUsers": 1449,
            "firstActiveUserDays": 3175,
            "firstDau": 453.5714,
            "firstDailyActiveRate": 31.3024,
            "secondActiveUserDays": 3223,
            "secondDau": 460.4286,
            "secondDailyActiveRate": 31.7756,
            "changePp": 0.4732
          },
          {
            "age": "40+",
            "totalUsers": 860,
            "firstActiveUserDays": 1471,
            "firstDau": 210.1429,
            "firstDailyActiveRate": 24.4352,
            "secondActiveUserDays": 1475,
            "secondDau": 210.7143,
            "secondDailyActiveRate": 24.5017,
            "changePp": 0.0664
          }
        ]
      }
    },
    "30": {
      "days": 30,
      "startDate": "2026-08-12",
      "endDate": "2026-09-10",
      "totalUsers": 6000,
      "totalUsersByAge": {
        "18-24": 1913.0,
        "25-31": 1778.0,
        "32-40": 1449.0,
        "40+": 860.0
      },
      "newUsersInWindow": 961,
      "dau": 2156.8,
      "dauByAge": {
        "18-24": 805.1,
        "25-31": 689.7667,
        "32-40": 451.4667,
        "40+": 210.4667
      },
      "activeUsers": 5994,
      "activeUsersByAge": {
        "18-24": 1913.0,
        "25-31": 1778.0,
        "32-40": 1446.0,
        "40+": 857.0
      },
      "totalViews": 282587,
      "viewsByAge": {
        "18-24": 115694.0,
        "25-31": 92460.0,
        "32-40": 52928.0,
        "40+": 21505.0
      },
      "totalSeconds": 158808353,
      "secondsByAge": {
        "18-24": 59198119.0,
        "25-31": 51547464.0,
        "32-40": 32908839.0,
        "40+": 15153931.0
      },
      "engagedUsers": 5831,
      "totalLikes": 21139,
      "totalFavorites": 12408,
      "totalComments": 5813,
      "totalShares": 3815,
      "byCategory": {
        "游戏": {
          "views": 63977,
          "seconds": 43760404,
          "likes": 4182,
          "favorites": 1520,
          "comments": 1043,
          "shares": 644,
          "completed": 7741,
          "viewers": 5782
        },
        "知识": {
          "views": 38266,
          "seconds": 34569106,
          "likes": 3605,
          "favorites": 3499,
          "comments": 771,
          "shares": 641,
          "completed": 5646,
          "viewers": 5873
        },
        "科技": {
          "views": 37218,
          "seconds": 21050144,
          "likes": 3007,
          "favorites": 2742,
          "comments": 597,
          "shares": 513,
          "completed": 5201,
          "viewers": 5860
        },
        "生活": {
          "views": 47769,
          "seconds": 13746567,
          "likes": 3364,
          "favorites": 1216,
          "comments": 980,
          "shares": 535,
          "completed": 6658,
          "viewers": 5931
        },
        "娱乐": {
          "views": 41264,
          "seconds": 5501205,
          "likes": 2246,
          "favorites": 573,
          "comments": 1047,
          "shares": 672,
          "completed": 4976,
          "viewers": 5734
        },
        "动画": {
          "views": 26275,
          "seconds": 16167039,
          "likes": 2700,
          "favorites": 1719,
          "comments": 742,
          "shares": 410,
          "completed": 2881,
          "viewers": 5080
        },
        "影视": {
          "views": 17145,
          "seconds": 22456439,
          "likes": 1198,
          "favorites": 734,
          "comments": 317,
          "shares": 167,
          "completed": 2529,
          "viewers": 5394
        },
        "音乐": {
          "views": 10673,
          "seconds": 1557449,
          "likes": 837,
          "favorites": 405,
          "comments": 316,
          "shares": 233,
          "completed": 1618,
          "viewers": 4617
        }
      },
      "agePreference": [
        {
          "age": "18-24",
          "activeUsers": 1913,
          "totalViews": 115694,
          "cells": [
            {
              "category": "游戏",
              "views": 34486,
              "viewers": 1911,
              "seconds": 22426149.0,
              "share": 29.8079,
              "coverage": 99.8955,
              "avgMinutes": 10.8383,
              "completedRate": 9.0674,
              "engageRate": 12.3209
            },
            {
              "category": "娱乐",
              "views": 21113,
              "viewers": 1909,
              "seconds": 2685330.0,
              "share": 18.249,
              "coverage": 99.7909,
              "avgMinutes": 2.1198,
              "completedRate": 9.1129,
              "engageRate": 11.7084
            },
            {
              "category": "生活",
              "views": 16158,
              "viewers": 1898,
              "seconds": 4274036.0,
              "share": 13.9662,
              "coverage": 99.2159,
              "avgMinutes": 4.4086,
              "completedRate": 8.813,
              "engageRate": 13.9993
            },
            {
              "category": "动画",
              "views": 16112,
              "viewers": 1905,
              "seconds": 9523579.0,
              "share": 13.9264,
              "coverage": 99.5818,
              "avgMinutes": 9.8514,
              "completedRate": 8.6457,
              "engageRate": 21.9215
            },
            {
              "category": "科技",
              "views": 10570,
              "viewers": 1882,
              "seconds": 5498483.0,
              "share": 9.1362,
              "coverage": 98.3795,
              "avgMinutes": 8.67,
              "completedRate": 8.5336,
              "engageRate": 20.3122
            },
            {
              "category": "知识",
              "views": 9201,
              "viewers": 1852,
              "seconds": 7528245.0,
              "share": 7.9529,
              "coverage": 96.8113,
              "avgMinutes": 13.6366,
              "completedRate": 8.7708,
              "engageRate": 24.7582
            },
            {
              "category": "影视",
              "views": 5775,
              "viewers": 1738,
              "seconds": 6955195.0,
              "share": 4.9916,
              "coverage": 90.8521,
              "avgMinutes": 20.0727,
              "completedRate": 9.3853,
              "engageRate": 14.6667
            },
            {
              "category": "音乐",
              "views": 2279,
              "viewers": 1257,
              "seconds": 307102.0,
              "share": 1.9699,
              "coverage": 65.7083,
              "avgMinutes": 2.2459,
              "completedRate": 8.8197,
              "engageRate": 18.473
            }
          ]
        },
        {
          "age": "25-31",
          "activeUsers": 1778,
          "totalViews": 92460,
          "cells": [
            {
              "category": "游戏",
              "views": 20246,
              "viewers": 1772,
              "seconds": 14347242.0,
              "share": 21.897,
              "coverage": 99.6625,
              "avgMinutes": 11.8108,
              "completedRate": 14.2003,
              "engageRate": 10.9948
            },
            {
              "category": "生活",
              "views": 16761,
              "viewers": 1771,
              "seconds": 4828931.0,
              "share": 18.1278,
              "coverage": 99.6063,
              "avgMinutes": 4.8018,
              "completedRate": 14.48,
              "engageRate": 12.9706
            },
            {
              "category": "科技",
              "views": 13825,
              "viewers": 1754,
              "seconds": 7830557.0,
              "share": 14.9524,
              "coverage": 98.6502,
              "avgMinutes": 9.4401,
              "completedRate": 14.1772,
              "engageRate": 18.604
            },
            {
              "category": "娱乐",
              "views": 13118,
              "viewers": 1761,
              "seconds": 1782005.0,
              "share": 14.1878,
              "coverage": 99.0439,
              "avgMinutes": 2.2641,
              "completedRate": 13.7445,
              "engageRate": 10.6495
            },
            {
              "category": "知识",
              "views": 12826,
              "viewers": 1758,
              "seconds": 11425751.0,
              "share": 13.8719,
              "coverage": 98.8751,
              "avgMinutes": 14.8471,
              "completedRate": 14.3147,
              "engageRate": 22.9066
            },
            {
              "category": "动画",
              "views": 7436,
              "viewers": 1696,
              "seconds": 4781820.0,
              "share": 8.0424,
              "coverage": 95.3881,
              "avgMinutes": 10.7177,
              "completedRate": 13.5422,
              "engageRate": 20.6966
            },
            {
              "category": "影视",
              "views": 4592,
              "viewers": 1583,
              "seconds": 6029489.0,
              "share": 4.9665,
              "coverage": 89.0326,
              "avgMinutes": 21.884,
              "completedRate": 14.8737,
              "engageRate": 14.8955
            },
            {
              "category": "音乐",
              "views": 3656,
              "viewers": 1474,
              "seconds": 521669.0,
              "share": 3.9541,
              "coverage": 82.9021,
              "avgMinutes": 2.3781,
              "completedRate": 14.3326,
              "engageRate": 16.9037
            }
          ]
        },
        {
          "age": "32-40",
          "activeUsers": 1446,
          "totalViews": 52928,
          "cells": [
            {
              "category": "知识",
              "views": 10752,
              "viewers": 1428,
              "seconds": 10182774.0,
              "share": 20.3144,
              "coverage": 98.7552,
              "avgMinutes": 15.7843,
              "completedRate": 17.4386,
              "engageRate": 20.5729
            },
            {
              "category": "生活",
              "views": 10541,
              "viewers": 1431,
              "seconds": 3221912.0,
              "share": 19.9157,
              "coverage": 98.9627,
              "avgMinutes": 5.0943,
              "completedRate": 17.5126,
              "engageRate": 11.5169
            },
            {
              "category": "科技",
              "views": 9416,
              "viewers": 1421,
              "seconds": 5639454.0,
              "share": 17.7902,
              "coverage": 98.2711,
              "avgMinutes": 9.982,
              "completedRate": 17.7782,
              "engageRate": 16.6419
            },
            {
              "category": "游戏",
              "views": 7529,
              "viewers": 1404,
              "seconds": 5606670.0,
              "share": 14.225,
              "coverage": 97.0954,
              "avgMinutes": 12.4113,
              "completedRate": 17.9572,
              "engageRate": 9.8552
            },
            {
              "category": "娱乐",
              "views": 5258,
              "viewers": 1359,
              "seconds": 758262.0,
              "share": 9.9343,
              "coverage": 93.9834,
              "avgMinutes": 2.4035,
              "completedRate": 16.5652,
              "engageRate": 9.8517
            },
            {
              "category": "影视",
              "views": 4124,
              "viewers": 1288,
              "seconds": 5596674.0,
              "share": 7.7917,
              "coverage": 89.0733,
              "avgMinutes": 22.6183,
              "completedRate": 17.386,
              "engageRate": 13.8943
            },
            {
              "category": "音乐",
              "views": 3186,
              "viewers": 1207,
              "seconds": 480079.0,
              "share": 6.0195,
              "coverage": 83.4716,
              "avgMinutes": 2.5114,
              "completedRate": 18.1419,
              "engageRate": 16.5411
            },
            {
              "category": "动画",
              "views": 2122,
              "viewers": 1058,
              "seconds": 1423014.0,
              "share": 4.0092,
              "coverage": 73.1674,
              "avgMinutes": 11.1767,
              "completedRate": 16.541,
              "engageRate": 18.049
            }
          ]
        },
        {
          "age": "40+",
          "activeUsers": 857,
          "totalViews": 21505,
          "cells": [
            {
              "category": "知识",
              "views": 5487,
              "viewers": 835,
              "seconds": 5432336.0,
              "share": 25.515,
              "coverage": 97.4329,
              "avgMinutes": 16.5006,
              "completedRate": 20.5577,
              "engageRate": 19.8287
            },
            {
              "category": "生活",
              "views": 4309,
              "viewers": 831,
              "seconds": 1421688.0,
              "share": 20.0372,
              "coverage": 96.9662,
              "avgMinutes": 5.4989,
              "completedRate": 22.3022,
              "engageRate": 10.3272
            },
            {
              "category": "科技",
              "views": 3407,
              "viewers": 803,
              "seconds": 2081650.0,
              "share": 15.8428,
              "coverage": 93.6989,
              "avgMinutes": 10.1832,
              "completedRate": 19.5186,
              "engageRate": 16.8183
            },
            {
              "category": "影视",
              "views": 2654,
              "viewers": 785,
              "seconds": 3875081.0,
              "share": 12.3413,
              "coverage": 91.5986,
              "avgMinutes": 24.3348,
              "completedRate": 22.1176,
              "engageRate": 11.7558
            },
            {
              "category": "娱乐",
              "views": 1775,
              "viewers": 705,
              "seconds": 275608.0,
              "share": 8.2539,
              "coverage": 82.2637,
              "avgMinutes": 2.5879,
              "completedRate": 21.2958,
              "engageRate": 8.507
            },
            {
              "category": "游戏",
              "views": 1716,
              "viewers": 695,
              "seconds": 1380343.0,
              "share": 7.9795,
              "coverage": 81.0968,
              "avgMinutes": 13.4066,
              "completedRate": 22.5524,
              "engageRate": 10.0233
            },
            {
              "category": "音乐",
              "views": 1552,
              "viewers": 679,
              "seconds": 248599.0,
              "share": 7.2169,
              "coverage": 79.2299,
              "avgMinutes": 2.6697,
              "completedRate": 20.2964,
              "engageRate": 14.4974
            },
            {
              "category": "动画",
              "views": 605,
              "viewers": 421,
              "seconds": 438626.0,
              "share": 2.8133,
              "coverage": 49.1249,
              "avgMinutes": 12.0834,
              "completedRate": 21.4876,
              "engageRate": 19.3388
            }
          ]
        }
      ],
      "categoryTrend": {
        "firstStart": "2026-08-12",
        "firstEnd": "2026-08-26",
        "firstDays": 15,
        "secondStart": "2026-08-27",
        "secondEnd": "2026-09-10",
        "secondDays": 15,
        "categories": [
          {
            "category": "科技",
            "firstViews": 18510,
            "secondViews": 18708,
            "firstDailyViews": 1234.0,
            "secondDailyViews": 1247.2,
            "growthPct": 1.0697
          },
          {
            "category": "音乐",
            "firstViews": 5323,
            "secondViews": 5350,
            "firstDailyViews": 354.8667,
            "secondDailyViews": 356.6667,
            "growthPct": 0.5072
          },
          {
            "category": "娱乐",
            "firstViews": 20593,
            "secondViews": 20671,
            "firstDailyViews": 1372.8667,
            "secondDailyViews": 1378.0667,
            "growthPct": 0.3788
          },
          {
            "category": "动画",
            "firstViews": 13113,
            "secondViews": 13162,
            "firstDailyViews": 874.2,
            "secondDailyViews": 877.4667,
            "growthPct": 0.3737
          },
          {
            "category": "生活",
            "firstViews": 23856,
            "secondViews": 23913,
            "firstDailyViews": 1590.4,
            "secondDailyViews": 1594.2,
            "growthPct": 0.2389
          },
          {
            "category": "影视",
            "firstViews": 8585,
            "secondViews": 8560,
            "firstDailyViews": 572.3333,
            "secondDailyViews": 570.6667,
            "growthPct": -0.2912
          },
          {
            "category": "游戏",
            "firstViews": 32051,
            "secondViews": 31926,
            "firstDailyViews": 2136.7333,
            "secondDailyViews": 2128.4,
            "growthPct": -0.39
          },
          {
            "category": "知识",
            "firstViews": 19191,
            "secondViews": 19075,
            "firstDailyViews": 1279.4,
            "secondDailyViews": 1271.6667,
            "growthPct": -0.6045
          }
        ]
      },
      "segmentTrend": {
        "firstStart": "2026-08-12",
        "firstEnd": "2026-08-26",
        "firstDays": 15,
        "secondStart": "2026-08-27",
        "secondEnd": "2026-09-10",
        "secondDays": 15,
        "firstActiveUserDays": 32304,
        "secondActiveUserDays": 32400,
        "segments": [
          {
            "age": "18-24",
            "totalUsers": 1913,
            "firstActiveUserDays": 12158,
            "firstDau": 810.5333,
            "firstDailyActiveRate": 42.3698,
            "secondActiveUserDays": 11995,
            "secondDau": 799.6667,
            "secondDailyActiveRate": 41.8017,
            "changePp": -0.568
          },
          {
            "age": "25-31",
            "totalUsers": 1778,
            "firstActiveUserDays": 10256,
            "firstDau": 683.7333,
            "firstDailyActiveRate": 38.4552,
            "secondActiveUserDays": 10437,
            "secondDau": 695.8,
            "secondDailyActiveRate": 39.1339,
            "changePp": 0.6787
          },
          {
            "age": "32-40",
            "totalUsers": 1449,
            "firstActiveUserDays": 6734,
            "firstDau": 448.9333,
            "firstDailyActiveRate": 30.9823,
            "secondActiveUserDays": 6810,
            "secondDau": 454.0,
            "secondDailyActiveRate": 31.332,
            "changePp": 0.3497
          },
          {
            "age": "40+",
            "totalUsers": 860,
            "firstActiveUserDays": 3156,
            "firstDau": 210.4,
            "firstDailyActiveRate": 24.4651,
            "secondActiveUserDays": 3158,
            "secondDau": 210.5333,
            "secondDailyActiveRate": 24.4806,
            "changePp": 0.0155
          }
        ]
      }
    }
  },
  "snippets": {
    "load": "# 显式声明每一列的类型，不让 pandas 自己猜。\n# 猜出来的类型会随 pandas 版本变（比如布尔列可能被读成 bool、也可能被读成 object），\n# 显式声明才能保证每次跑出来的结果完全一样。\n\nUSER_DTYPES = {\n    \"user_id\": \"str\",\n    \"age\": \"int16\",\n    \"gender\": \"str\",\n    \"city\": \"str\",\n    \"register_date\": \"str\",\n    \"user_level\": \"int8\",\n}\nCREATOR_DTYPES = {\"up_id\": \"str\", \"creator_type\": \"str\", \"followers\": \"int32\"}\nVIDEO_DTYPES = {\n    \"video_id\": \"str\",\n    \"up_id\": \"str\",\n    \"category\": \"str\",\n    \"publish_date\": \"str\",\n    \"duration\": \"int32\",\n}\n# 点赞/收藏/评论/分享在 CSV 里存的是 1 和 0，不是 True/False。\n# 这和 SQL 页建表时把布尔存成 0/1 是同一个口径，对账才对得上。\nVIEW_DTYPES = {\n    \"user_id\": \"str\",\n    \"video_id\": \"str\",\n    \"date\": \"str\",\n    \"watch_seconds\": \"int32\",\n    \"is_like\": \"int8\",\n    \"is_favorite\": \"int8\",\n    \"is_comment\": \"int8\",\n    \"is_share\": \"int8\",\n}\n\nusers = pd.read_csv(CSV_DIR / \"users.csv\", dtype=USER_DTYPES)\ncreators = pd.read_csv(CSV_DIR / \"creators.csv\", dtype=CREATOR_DTYPES)\nvideos = pd.read_csv(CSV_DIR / \"videos.csv\", dtype=VIDEO_DTYPES)\nviews = pd.read_csv(CSV_DIR / \"video_views.csv\", dtype=VIEW_DTYPES)\n\n# 看一眼每张表几行几列。df.shape 返回 (行数, 列数)。\nTABLES = {\"users\": users, \"creators\": creators, \"videos\": videos, \"video_views\": views}\nTABLE_LABELS = {\n    \"users\": \"用户表\",\n    \"creators\": \"创作者表\",\n    \"videos\": \"视频表\",\n    \"video_views\": \"观看记录表\",\n}\n\nshapes = [\n    {\"table\": name, \"label\": TABLE_LABELS[name], \"rows\": int(df.shape[0]), \"columns\": int(df.shape[1])}\n    for name, df in TABLES.items()\n]\n\n# 每列被读成了什么类型、每张表前 5 行长什么样。\n# ★ 必须在清洗【之前】取。清洗会把日期列从字符串转成 datetime，\n#   那之后再回头看 dtypes，看到的就不是「刚从 CSV 读进来」的样子了。\ndtypes = [\n    {\"table\": name, \"column\": column, \"dtype\": str(dtype)}\n    for name, df in TABLES.items()\n    for column, dtype in df.dtypes.items()\n]\nhead_samples = [\n    {\n        \"table\": name,\n        \"label\": TABLE_LABELS[name],\n        \"columns\": list(df.columns),\n        \"rows\": [\n            [None if pd.isna(value) else value for value in row]\n            for row in df.head(5).to_numpy().tolist()\n        ],\n    }\n    for name, df in TABLES.items()\n]\n",
    "quality": "# 数据体检要回答四个问题：有没有空值、有没有重复、表之间的关系对不对、数值有没有越界。\n\n# ---- ① 缺失值：查两遍才算数 ----\n# 第一遍用 isna()：它认的是真空白（CSV 里连续的逗号）。\n# 但真实数据里更常见的是「伪装成合法值的缺失」——比如一列里写着 \"NA\"、\"null\"、\"-\"，\n# 看起来有值，其实是空的。pandas 会把一部分哨兵词转成 NaN，但不是全部。\n# 只查第一遍就下结论「没有缺失值」，是不负责任的。\nmissing = [\n    {\"table\": name, \"column\": column, \"count\": int(count)}\n    for name, df in TABLES.items()\n    for column, count in df.isna().sum().items()\n    if count > 0\n]\nmissing_total = int(sum(item[\"count\"] for item in missing))\n\nSENTINELS = [\"NA\", \"NaN\", \"nan\", \"null\", \"NULL\", \"None\", \"none\", \"-\", \"N/A\", \"\"]\nsentinel_hits = []\nfor name, df in TABLES.items():\n    for column in df.columns:\n        series = df[column]\n        if pd.api.types.is_numeric_dtype(series) or pd.api.types.is_bool_dtype(series):\n            continue\n        for sentinel in SENTINELS:\n            count = int((series == sentinel).sum())\n            if count > 0:\n                sentinel_hits.append(\n                    {\"table\": name, \"column\": column, \"value\": sentinel, \"count\": count}\n                )\n\n# ---- ② 重复值：两种口径差很多，而且都说得通 ----\n# 整行完全一样 = 真正的重复数据。\n# 但「同一个用户、同一天、同一个视频」出现多次，不算脏数据——\n# 这张表的粒度是「一次播放」，不是「用户 × 视频 × 天」。\n# 分开报，是为了让读者看清这两种「重复」是两回事。\nduplicate_full_rows = int(views.duplicated().sum())\nDUPLICATE_KEYS = [\n    (\"user_id,video_id,date\", \"用户 + 视频 + 日期\", [\"user_id\", \"video_id\", \"date\"]),\n    (\"user_id,date\", \"用户 + 日期\", [\"user_id\", \"date\"]),\n]\nduplicate_keys = [\n    {\"key\": key, \"label\": label, \"count\": int(views.duplicated(subset=columns).sum())}\n    for key, label, columns in DUPLICATE_KEYS\n]\n\n# ---- ③ 外键完整性：子表里有没有找不到爹的行 ----\nforeign_keys = []\nfor child, column, parent, parent_column in [\n    (\"video_views\", \"user_id\", \"users\", \"user_id\"),\n    (\"video_views\", \"video_id\", \"videos\", \"video_id\"),\n    (\"videos\", \"up_id\", \"creators\", \"up_id\"),\n]:\n    child_df, parent_df = TABLES[child], TABLES[parent]\n    orphans = int((~child_df[column].isin(set(parent_df[parent_column]))).sum())\n    foreign_keys.append(\n        {\"child\": child, \"column\": column, \"parent\": parent, \"orphans\": orphans}\n    )\n\n# ---- ④ 越界检查：数值有没有跑到业务上不可能的范围 ----\nregistered_ids = set(users[\"user_id\"])\nduration_by_video = dict(zip(videos[\"video_id\"], videos[\"duration\"]))\nage_by_user = dict(zip(users[\"user_id\"], users[\"age\"]))\n\nwatch = views[\"watch_seconds\"]\nduration_matched = views[\"video_id\"].map(duration_by_video)\nage_matched = views[\"user_id\"].map(age_by_user)\n\ndistinct_dates = sorted(views[\"date\"].unique())\nwindow_first_date = distinct_dates[0]\n\nrange_checks = [\n    {\n        \"check\": \"观看秒数 > 0\",\n        \"detail\": \"一次观看至少 1 秒，否则不该产生记录\",\n        \"violations\": int((watch <= 0).sum()),\n    },\n    {\n        \"check\": \"观看秒数 ≤ 视频总时长\",\n        \"detail\": \"看得比视频本身还长是不可能的\",\n        \"violations\": int((watch > duration_matched).sum()),\n    },\n    {\n        \"check\": f\"观看日期落在最近 {DAYS} 天内\",\n        \"detail\": f\"{window_first_date} ~ {END_DATE}\",\n        \"violations\": int(((views[\"date\"] < window_first_date) | (views[\"date\"] > END_DATE)).sum()),\n    },\n    {\n        \"check\": \"年龄在 18–55 岁之间\",\n        \"detail\": \"数据生成时的年龄范围\",\n        \"violations\": int(((age_matched < 18) | (age_matched > 55)).sum()),\n    },\n    {\n        \"check\": \"注册日期不晚于数据截止日\",\n        \"detail\": f\"截止日 {END_DATE}\",\n        \"violations\": int((users[\"register_date\"] > END_DATE).sum()),\n    },\n]\n",
    "clean": "# 体检的结论是这份数据是干净的，所以清洗这一步不丢任何行——\n# 它的作用是「确认干净」并把数据整理成好分析的形状，不是表演删数据。\n\nrows_before = int(len(views))\n\n# ---- ① 类型转换：把 1/0 还原成布尔，把日期字符串转成日期类型 ----\nviews[FLAG_COLUMNS] = views[FLAG_COLUMNS].astype(bool)\nviews[\"date\"] = pd.to_datetime(views[\"date\"], format=\"%Y-%m-%d\")\nusers[\"register_date\"] = pd.to_datetime(users[\"register_date\"], format=\"%Y-%m-%d\")\n\n# ---- ② 派生列：把分析要用到的信息并到观看记录上 ----\n# 视频的分区、总时长，用户所属的年龄段，都是后面分析要反复用的维度。\nviews = views.merge(\n    videos[[\"video_id\", \"category\", \"duration\"]], on=\"video_id\", how=\"left\", validate=\"many_to_one\"\n)\n# 年龄段用 pd.cut 分箱，边界和 src/utils/ageGroup.ts 逐字一致。\n# right=True 表示左开右闭，所以 24 落在 (17,24] 里，归属 18-24。\n# pd.cut 没有 observed 参数（那是 groupby / crosstab 的），这里只用 bins + labels。\nusers[\"age_group\"] = pd.cut(users[\"age\"], bins=AGE_BINS, labels=AGE_GROUPS, right=True)\nviews = views.merge(\n    users[[\"user_id\", \"age_group\"]], on=\"user_id\", how=\"left\", validate=\"many_to_one\"\n)\n\n# 完播：这次看的秒数达到视频总时长的 80%。\n# ★ duration > 0 这个守卫、以及 >= 和 * 0.8 的写法都是照抄 src/data/metrics.ts 的，\n#   不许改成 round() 或整数除法——JS 和 Python 都是 IEEE754 双精度的同一次运算，\n#   照抄才能保证两边每一个视频的判定结果完全一样。\nviews[\"completed\"] = (views[\"duration\"] > 0) & (\n    views[\"watch_seconds\"] >= views[\"duration\"] * COMPLETION_THRESHOLD\n)\n\n# 派生列加完之后行数必须一行不少，否则说明 merge 写错了（比如用了 inner join）\nrows_after = int(len(views))\nif rows_after != rows_before:\n    raise ValueError(f\"清洗过程中行数从 {rows_before} 变成了 {rows_after}，merge 逻辑有问题。\")\n\nderived_columns = [\"category\", \"duration\", \"age_group\", \"completed\"]\n",
    "activity": "# groupby + agg + sort_values 是 Pandas 做分析最常用的三件套：\n# 先按日期分组，再对每组算几个数，最后排好序。\n\ndaily = (\n    views.groupby(\"date\")\n    .agg(\n        dau=(\"user_id\", \"nunique\"),        # 当天有多少个不同的人来过\n        views=(\"user_id\", \"size\"),         # 当天一共播放了多少次\n        seconds=(\"watch_seconds\", \"sum\"),  # 当天一共看了多少秒\n    )\n    .reset_index()\n    .sort_values(\"date\")\n)\n\n# 日环比：今天比昨天多了还是少了。\n# ★ 这里不传 fill_method 参数：pandas 2.2 里它被废弃、3.0 里已经删掉了，\n#   写上去在老版本能跑、在新版本直接报 TypeError。现在的默认行为就是\n#   「不填补空值」——缺的数据就该是空的，正好是我们要的。\ndaily[\"change_pct\"] = daily[\"dau\"].pct_change() * 100\n\n# 7 日移动平均。原始 DAU 每天都上下跳，看不出趋势；\n# 取最近 7 天的平均就平滑多了。窗口设为 7 是因为一周正好覆盖一个完整的\n# 「工作日 + 周末」循环，能把周末效应抹平（第 8 节会验证这一点）。\ndaily[\"dau_smooth7\"] = daily[\"dau\"].rolling(7).mean()\n\n# 每个用户在整个观察期里活跃了多少天。\n# 这个指标必须有完整的 60 天才成立，所以不随时间筛选变。\nper_user = (\n    views.groupby(\"user_id\")\n    .agg(\n        active_days=(\"date\", \"nunique\"),\n        total_views=(\"user_id\", \"size\"),\n        total_seconds=(\"watch_seconds\", \"sum\"),\n    )\n    .reset_index()\n)\n\n# 一次都没来过的用户也要算进来（活跃 0 天），否则「沉默用户占比」会偏低\nall_users = users[[\"user_id\"]].copy()\nper_user = all_users.merge(per_user, on=\"user_id\", how=\"left\")\nper_user[[\"active_days\", \"total_views\", \"total_seconds\"]] = (\n    per_user[[\"active_days\", \"total_views\", \"total_seconds\"]].fillna(0).astype(\"int64\")\n)\n# 日均观看分钟数 = 总秒数 ÷ 天数 ÷ 60\nper_user[\"daily_minutes\"] = per_user[\"total_seconds\"] / DAYS / 60\n\n# 活跃天数分布：0 天、1 天、……、60 天各有几个人\nactive_days_hist = per_user[\"active_days\"].value_counts().sort_index()\nactive_days_hist = [\n    {\"days\": int(days), \"users\": int(active_days_hist.get(days, 0))}\n    for days in range(DAYS + 1)\n]\n",
    "tiers": "# pd.cut 是「等距分箱」：你定边界，每档多宽你说了算。\n# pd.qcut 是「等频分箱」：你定档数，它自动找边界，让每档人数尽量一样多。\n#\n# 用户价值天然是长尾的——少数人贡献大部分时长。用等距分箱会得到\n# 「最低档塞了几千人、最高档只有几个人」这种没法看的分布，\n# 所以这里用 qcut 按「人均每日观看分钟数」四等分。\nper_user[\"tier\"] = pd.qcut(\n    per_user[\"daily_minutes\"],\n    q=4,\n    labels=[\"Q1 最低\", \"Q2\", \"Q3\", \"Q4 最高\"],\n    duplicates=\"drop\",\n)\n\n# 每档的边界值，用来在页面上如实标出「这一档是什么范围」\ntier_bounds = per_user.groupby(\"tier\", observed=True)[\"daily_minutes\"].agg([\"min\", \"max\"])\n\n# 把分层贴回明细，才能看「每一档的人在看什么内容」\nviews_with_tier = views.merge(\n    per_user[[\"user_id\", \"tier\"]], on=\"user_id\", how=\"left\", validate=\"many_to_one\"\n)\n\ntier_summary = (\n    per_user.groupby(\"tier\", observed=True)\n    .agg(users=(\"user_id\", \"size\"), avg_active_days=(\"active_days\", \"mean\"))\n    .reset_index()\n)\ntier_minutes = per_user.groupby(\"tier\", observed=True)[\"daily_minutes\"].sum()\ntier_views = views_with_tier.groupby(\"tier\", observed=True).size()\ntotal_minutes = float(tier_minutes.sum())\ntotal_views_all = int(tier_views.sum())\n\n# 每一档最偏好的三个分区\ntier_top_categories = []\nfor tier, group in views_with_tier.groupby(\"tier\", observed=True):\n    counts = group[\"category\"].value_counts()\n    share_sum = int(counts.sum())\n    tier_top_categories.append(\n        {\n            \"tier\": str(tier),\n            \"top\": [\n                {\"category\": str(category), \"share\": round(int(count) / share_sum * 100, 4)}\n                for category, count in counts.head(3).items()\n            ],\n        }\n    )\n\ntiers = []\nfor row in tier_summary.itertuples(index=False):\n    tier = str(row.tier)\n    top = next(item[\"top\"] for item in tier_top_categories if item[\"tier\"] == tier)\n    users_in_tier = int(row.users)\n    tier_views_count = int(tier_views.get(row.tier, 0))\n    tiers.append(\n        {\n            \"id\": tier,\n            \"users\": users_in_tier,\n            \"minMinutes\": round(float(tier_bounds.loc[row.tier, \"min\"]), 4),\n            \"maxMinutes\": round(float(tier_bounds.loc[row.tier, \"max\"]), 4),\n            \"avgActiveDays\": round(float(row.avg_active_days), 4),\n            \"totalMinutes\": round(float(tier_minutes.get(row.tier, 0)), 4),\n            \"minutesShare\": round(float(tier_minutes.get(row.tier, 0)) / total_minutes * 100, 4),\n            \"viewsShare\": round(tier_views_count / total_views_all * 100, 4),\n            \"topCategories\": top,\n        }\n    )\n",
    "content": "# SQL 里做「视频时长 vs 完播率」这种「先按视频聚合、再算相关系数」的分析很别扭，\n# 而在 Pandas 里就是 groupby 之后一行 corr()。\n\nvideo_level = (\n    views.groupby(\"video_id\")\n    .agg(\n        plays=(\"user_id\", \"size\"),\n        completed=(\"completed\", \"sum\"),\n        avg_watch_seconds=(\"watch_seconds\", \"mean\"),\n    )\n    .reset_index()\n    .merge(videos[[\"video_id\", \"category\", \"duration\"]], on=\"video_id\", how=\"inner\")\n)\nvideo_level[\"completed_rate\"] = video_level[\"completed\"] / video_level[\"plays\"] * 100\n\n# 皮尔逊相关系数。只说明「一起变化」，不说明谁导致谁——\n# 相关不等于因果，这一点在页面上要写清楚。\nduration_completion_r = float(video_level[\"duration\"].corr(video_level[\"completed_rate\"]))\n\ncategory_content = []\nfor category in CATEGORIES:\n    group = video_level[video_level[\"category\"] == category]\n    if group.empty:\n        category_content.append(\n            {\n                \"category\": category,\n                \"videos\": 0,\n                \"medianDuration\": 0.0,\n                \"plays\": 0,\n                \"avgCompletedRate\": 0.0,\n                \"avgWatchSeconds\": 0.0,\n            }\n        )\n        continue\n    category_content.append(\n        {\n            \"category\": category,\n            \"videos\": int(len(group)),\n            \"medianDuration\": round(float(group[\"duration\"].median()), 4),\n            \"plays\": int(group[\"plays\"].sum()),\n            \"avgCompletedRate\": round(float(group[\"completed_rate\"].mean()), 4),\n            \"avgWatchSeconds\": round(float(group[\"avg_watch_seconds\"].mean()), 4),\n        }\n    )\n",
    "cross": "# pivot_table 把「长表」掰成「宽表」：行是分层、列是分区、格子里是数值。\n# 这是 Pandas 最好用的功能之一，SQL 里要写 PIVOT 或者一堆 CASE WHEN。\n\n# ---- ① 行为分层 × 内容分区 ----\ntier_category = pd.crosstab(views_with_tier[\"tier\"], views_with_tier[\"category\"])\ntier_category = tier_category.reindex(columns=CATEGORIES, fill_value=0)\n# 每一档内部归一化成占比：这样比较的是「偏好」而不是「规模」\ntier_category_share = tier_category.div(tier_category.sum(axis=1), axis=0) * 100\n\ntier_category_rows = []\nfor tier, row in tier_category_share.iterrows():\n    row_total_views = int(tier_category.loc[tier].sum())\n    tier_category_rows.append(\n        {\n            \"tier\": str(tier),\n            \"totalViews\": row_total_views,\n            \"cells\": [\n                {\n                    \"category\": category,\n                    \"views\": int(tier_category.loc[tier, category]),\n                    \"share\": round(float(row[category]), 4),\n                }\n                for category in CATEGORIES\n            ],\n        }\n    )\n\n# ---- ② 四个年龄段的「口味相似度」 ----\n# 把每个年龄段在 8 个分区上的观看量当成一个 8 维向量，\n# 两两算余弦相似度：值越接近 1，说明这两个年龄段爱看的东西越像。\nage_category = pd.crosstab(views[\"age_group\"], views[\"category\"])\nage_category = age_category.reindex(index=AGE_GROUPS, columns=CATEGORIES, fill_value=0)\nmatrix = age_category.to_numpy(dtype=\"float64\")\nnorms = np.linalg.norm(matrix, axis=1)\ncosine = matrix @ matrix.T / np.outer(norms, norms)\n\npreference_similarity = [\n    {\n        \"a\": AGE_GROUPS[i],\n        \"b\": AGE_GROUPS[j],\n        \"cosine\": round(float(cosine[i][j]), 4),\n    }\n    for i in range(len(AGE_GROUPS))\n    for j in range(i + 1, len(AGE_GROUPS))\n]\n\n# ---- ③ 年龄段 × 内容分区 的逐格明细（按时间窗口算） ----\n# ★ 为什么以前不做、现在要做，完整理由写在第 9 节 window_summary() 的说明里，\n#   一句话概括：\n#   不是为了多摆一张表，是为了让 AI 助手页的「SQL 和 Python 交叉验证」有第二个独立信源。\n\n\ndef build_age_preference(window: pd.DataFrame) -> list:\n    \"\"\"\n    每档人在 8 个内容分区上各花了多少注意力。\n\n    ★ 派生口径逐字对齐前端 src/data/selectors.ts 的 buildUserContentCells()：\n        share         = 该格播放次数 ÷ 该年龄段 8 个分区的播放次数之和 × 100\n                        （行内归一化：4 个年龄段各自加总都是 100%，\n                          这样比的是「偏好」，不会被「哪个年龄段人多」带偏）\n        coverage      = 该格独立观看用户数 ÷ 该年龄段窗口内活跃用户数 × 100\n        avgMinutes    = 该格总秒数 ÷ 该格播放次数 ÷ 60（平均点开一次看多久）\n        completedRate = 高完成度观看次数 ÷ 播放次数 × 100\n        engageRate    = （赞 + 藏 + 评 + 享）的次数 ÷ 播放次数 × 100\n                        分子是【行为次数】不是人数：一个人又赞又藏算 2 次互动。\n\n    ★ viewers 必须是窗口内跨天去重的独立观看用户数。\n      绝不能拿逐日人数相加 —— 同一个人连着 5 天看游戏，加出来是 5 个人。\n      所以这里用 nunique()。\n\n    ★ 分母为 0 时一律取 0，不许出现 NaN / 无穷大：\n      NaN 会在最后 to_plain() 那一步直接抛错（那是防页面显示 NaN 的硬闸）。\n    \"\"\"\n\n    def cell_matrix(values, aggfunc) -> pd.DataFrame:\n        \"\"\"\n        按「年龄段 × 分区」交叉汇总，并强制补齐 4 × 8 个键。\n\n        ★ fillna(0) 和 reindex 一起用，缺一不可：\n          · fillna(0)：某个年龄段一次都没看过某个分区时，crosstab 会给 NaN。\n            留下 NaN，最后写文件那一步会直接抛错。\n          · reindex：把没出现过的行列补出来。缺键会让前端读到 undefined，\n            页面上会冒出 \"undefined\" 这种脏字符。\n        \"\"\"\n        table = pd.crosstab(\n            window[\"age_group\"],\n            window[\"category\"],\n            values=values,\n            aggfunc=aggfunc,\n        )\n        return table.fillna(0).reindex(index=AGE_GROUPS, columns=CATEGORIES, fill_value=0)\n\n    views = pd.crosstab(window[\"age_group\"], window[\"category\"]).reindex(\n        index=AGE_GROUPS, columns=CATEGORIES, fill_value=0\n    )\n    viewers = cell_matrix(window[\"user_id\"], \"nunique\")\n    seconds = cell_matrix(window[\"watch_seconds\"], \"sum\")\n    completed = cell_matrix(window[\"completed\"], \"sum\")\n    # 四种互动行为的次数之和。注意是在【一行观看记录】内部求和，\n    # 不是数有多少人互动过 —— 和前端 engageRate 的分子保持一致。\n    engage = cell_matrix(window[FLAG_COLUMNS].sum(axis=1), \"sum\")\n\n    rows = []\n    for age in AGE_GROUPS:\n        age_total_views = int(views.loc[age].sum())\n        # 覆盖率的分母：这个年龄段在窗口内活跃过的去重人数。\n        # 和前端 metrics.ts 的 activeUsersByAge 是同一个数，对账时会比。\n        age_active_users = int(window.loc[window[\"age_group\"] == age, \"user_id\"].nunique())\n\n        cells = []\n        for category in CATEGORIES:\n            view_count = int(views.loc[age, category])\n            viewer_count = int(viewers.loc[age, category])\n            second_count = float(seconds.loc[age, category])\n\n            cells.append(\n                {\n                    \"category\": category,\n                    \"views\": view_count,\n                    \"viewers\": viewer_count,\n                    \"seconds\": round(second_count, 4),\n                    \"share\": round(view_count / age_total_views * 100, 4)\n                    if age_total_views\n                    else 0.0,\n                    \"coverage\": round(viewer_count / age_active_users * 100, 4)\n                    if age_active_users\n                    else 0.0,\n                    \"avgMinutes\": round(second_count / 60 / view_count, 4) if view_count else 0.0,\n                    \"completedRate\": round(int(completed.loc[age, category]) / view_count * 100, 4)\n                    if view_count\n                    else 0.0,\n                    \"engageRate\": round(float(engage.loc[age, category]) / view_count * 100, 4)\n                    if view_count\n                    else 0.0,\n                }\n            )\n\n        # 按偏好占比降序：页面上一眼就能看出这档人最偏哪个分区\n        cells.sort(key=lambda cell: -cell[\"share\"])\n\n        rows.append(\n            {\n                \"age\": age,\n                # ★ 这里不输出显示用的中文标签（「18–24岁」这种）。\n                #   前端 src/utils/ageGroup.ts 是年龄段的唯一权威定义，\n                #   页面用 ageGroupLabel() 自己映射就行。\n                #   在这边再写一份，等于给自己造第二个真相来源。\n                \"activeUsers\": age_active_users,\n                \"totalViews\": age_total_views,\n                \"cells\": cells,\n            }\n        )\n\n    return rows\n",
    "trend": "# 这一节回答一个具体问题：DAU 每天上上下下，有多少是「周末效应」造成的？\n# 而这套数据在生成时，确实设了周末系数——\n# src/data/dataset.ts 里的 DOW_MULTIPLIER：周末 1.18、周五 1.06、工作日 1.00。\n# 也就是说，我们有机会「用数据反查构造参数」：算出来的比值应该接近 1.18。\n\ndaily[\"dow\"] = daily[\"date\"].dt.dayofweek  # 0 = 周一，6 = 周日\ndaily[\"dow_group\"] = np.select(\n    [daily[\"dow\"] >= 5, daily[\"dow\"] == 4],\n    [\"weekend\", \"friday\"],\n    default=\"weekday\",\n)\n\ndow_factor = daily.groupby(\"dow_group\")[\"dau\"].mean()\nweekday_baseline = float(dow_factor.get(\"weekday\", 0))\ndow_effect = [\n    {\n        \"group\": group,\n        \"label\": label,\n        \"avgDau\": round(float(dow_factor.get(group, 0)), 4),\n        \"ratioToWeekday\": round(float(dow_factor.get(group, 0)) / weekday_baseline, 4)\n        if weekday_baseline > 0\n        else 0.0,\n        \"days\": int((daily[\"dow_group\"] == group).sum()),\n    }\n    for group, label in [(\"weekday\", \"工作日\"), (\"friday\", \"周五\"), (\"weekend\", \"周末\")]\n]\n\n# 波动率：日环比的变化幅度。数值越大说明这个平台每天的活跃越不稳定。\nchanges = daily[\"change_pct\"].dropna()\nvolatility = {\n    \"stdPct\": round(float(changes.std()), 4),\n    \"meanAbsPct\": round(float(changes.abs().mean()), 4),\n    \"maxAbsPct\": round(float(changes.abs().max()), 4),\n    \"maxAbsDate\": daily.loc[daily[\"change_pct\"].abs().idxmax(), \"date\"].strftime(\"%Y-%m-%d\"),\n}\n\ndaily_rows = [\n    {\n        \"date\": row.date.strftime(\"%Y-%m-%d\"),\n        \"dow\": int(row.dow),\n        \"dowGroup\": str(row.dow_group),\n        \"dau\": int(row.dau),\n        \"views\": int(row.views),\n        \"seconds\": int(row.seconds),\n        \"dauSmooth7\": optional_float(row.dau_smooth7),\n        \"changePct\": optional_float(row.change_pct),\n    }\n    for row in daily.itertuples(index=False)\n]\n\n# ---- 各内容分区的「前后半段」对比（按时间窗口算） ----\n\n\ndef build_category_trend(window: pd.DataFrame) -> dict:\n    \"\"\"\n    把窗口对半切，看每个内容分区的播放量是涨了还是跌了，并排名。\n\n    ★ 口径来自 AI 分析助手页的示例问题，原文是：\n      「把窗口对半切，比较各分区前后半段的播放量，算增长率并排名。」\n      这里的实现就是照着那句话写的。\n\n    ★ 三件必须一起说清楚、否则会被误读的事（页面上也要写出来）：\n\n      1. 两段天数可能不等：7 天窗口切出来是 3 天 vs 4 天。\n         所以比的是【日均播放量】，不是总量 —— 拿 3 天的总量去比 4 天的，\n         短的那段天然吃亏，排名就不可信了。\n         也正是因为这样，页面上必须把两段各多少天标出来。\n\n      2. 这不是「本周 vs 上周」。它比的是**窗口自己内部**的前后两半：\n         窗口 30 天时，它说的是「这 30 天的后半段 vs 前半段」，\n         和「近 30 天 vs 再往前 30 天」是两回事，数值也不一样。\n\n      3. 窗口越短越不稳。7 天窗口切完每段只有 3~4 天，\n         一天的异常就能把排名整个掀翻。\n         所以这个排名适合看方向，不适合当精确结论用。\n\n    ★ 前半段日均是 0 时，增长率记 None（前端 TS 里是 null），不是 0 也不是无穷大。\n      和项目里「上一周期为 0 就不显示环比」是同一条规矩 ——\n      算不出来就说算不出来，不要拿一个看着像结论的数糊过去。\n\n    ★ 日期的切法按窗口内实际存在的日期来数（不是直接拿 days 除），\n      这样 firstDays + secondDays 一定等于窗口天数，不会因为某天没数据而错位。\n    \"\"\"\n    dates = pd.DatetimeIndex(sorted(window[\"date\"].unique()))\n    first_days = len(dates) // 2\n    second_days = len(dates) - first_days\n    first_dates = dates[:first_days]\n    second_dates = dates[first_days:]\n\n    # 一行 = 一个分区，一列 = 一天，格子里是当天的播放次数\n    per_day = (\n        window.groupby([\"category\", \"date\"], observed=True)\n        .size()\n        .unstack(fill_value=0)\n        .reindex(index=CATEGORIES, columns=dates, fill_value=0)\n    )\n\n    rows = []\n    for category in CATEGORIES:\n        first_views = int(per_day.loc[category, first_dates].sum())\n        second_views = int(per_day.loc[category, second_dates].sum())\n        first_daily = first_views / first_days if first_days > 0 else 0.0\n        second_daily = second_views / second_days if second_days > 0 else 0.0\n        growth = (second_daily - first_daily) / first_daily * 100 if first_daily > 0 else None\n\n        rows.append(\n            {\n                \"category\": category,\n                \"firstViews\": first_views,\n                \"secondViews\": second_views,\n                \"firstDailyViews\": round(first_daily, 4),\n                \"secondDailyViews\": round(second_daily, 4),\n                \"growthPct\": round(growth, 4) if growth is not None else None,\n            }\n        )\n\n    # 涨得多的排前面。算不出增长率的（前半段那个分区一次都没被看过）排最后，\n    # 而不是当成 0 混在中间 —— 那会让人误以为它「没涨没跌」。\n    rows.sort(key=lambda row: (row[\"growthPct\"] is None, -(row[\"growthPct\"] or 0.0)))\n\n    return {\n        \"firstStart\": first_dates[0].strftime(\"%Y-%m-%d\") if first_days else \"\",\n        \"firstEnd\": first_dates[-1].strftime(\"%Y-%m-%d\") if first_days else \"\",\n        \"firstDays\": first_days,\n        \"secondStart\": second_dates[0].strftime(\"%Y-%m-%d\") if second_days else \"\",\n        \"secondEnd\": second_dates[-1].strftime(\"%Y-%m-%d\") if second_days else \"\",\n        \"secondDays\": second_days,\n        \"categories\": rows,\n    }\n\n\ndef build_segment_trend(window: pd.DataFrame) -> dict:\n    \"\"\"\n    把窗口对半切，看每个年龄段的【日均活跃率】在窗口里是往上还是往下走。\n\n    ★ 口径来自 AI 分析助手页的示例问题，原文是：\n      「哪些用户群体存在活跃度下降？」\n      这里的实现就是照着那句话写的。\n\n    ★ 分母是「该年龄段的总人数」，不是全站人数。\n      分子分母必须是同一批人：分子是 18-24 岁里活跃过的，分母就只能是\n      18-24 岁的总人数。拿全站人数当分母，算出来的是「这个年龄段占全站多少」，\n      完全是另一件事。这条规矩和 SQL 案例 03「各年龄段活跃率」是同一个。\n\n    ★ 分母用的是【注册用户总数】，和窗口无关 —— 换个时间窗口，\n      分母不变，变的只有分子。所以三个窗口的活跃率是可以横向比的。\n\n    ★ 为什么比【日均活跃率】而不是「这半段里活跃过的人数」：\n      两段天数常常不等（近 7 天切出来是 3 天 vs 4 天），而「活跃过至少一次」\n      这个口径下，天多的那一半天然更容易把人扫到 —— 拿它比，短的那段永远吃亏，\n      排名就不可信了。所以一律先摊平成日均。\n      （这条坑在本文件的 categoryTrend 那一节里已经踩过一次，是同一个道理。）\n\n    ★ 「日均活跃率」怎么算：\n        活跃人天 ÷（该档总人数 × 该半段天数）× 100\n      活跃人天 = 「某人某天来过」这一事实的去重计数（和 SQL 分析页的案例 03 同口径）。\n      按天去重再摊平，正好等于「每天活跃人数 ÷ 总人数」的日均值。\n\n    ★ changePp 的单位是【百分点】，不是百分比。\n      从 44.80% 掉到 39.79% 是「降了 5.01 个百分点」，不是「降了 5.01%」。\n      前端文案里必须写「个百分点」，写错了就是在夸大或缩小事实。\n\n    ★ 日期切法按窗口内实际存在的日期数（不是 days ÷ 2），\n      和 build_category_trend 用同一套数法，两边的切分点才对得上。\n    \"\"\"\n    dates = pd.DatetimeIndex(sorted(window[\"date\"].unique()))\n    first_days = len(dates) // 2\n    second_days = len(dates) - first_days\n    first_dates = dates[:first_days]\n    second_dates = dates[first_days:]\n\n    # 分母：截止日之前注册的全部用户，按年龄段分。和 window_summary 里的\n    # total_users_by_age 是同一批人（同一句筛选），所以两者能对上。\n    registered = users[users[\"register_date\"] <= pd.Timestamp(END_DATE)]\n    total_by_age = registered[\"age_group\"].value_counts()\n\n    def active_days_by_age(sub: pd.DataFrame) -> pd.Series:\n        \"\"\"\n        「某人某天来过」按年龄段数一遍，返回 Series（索引是年龄段）。\n\n        ★ 先去重再数：同一个人一天看了 5 个视频，只能算 1 个人天。\n          直接 size() 数的是观看次数，那是另一个指标。\n        ★ 空窗口返回空 Series，让下面的 .get(age, 0) 兜底补 0。\n          缺键会在前端变成 undefined，页面上就是脏字符。\n        \"\"\"\n        if len(sub) == 0:\n            return pd.Series(dtype=\"int64\")\n        uniq = sub[[\"age_group\", \"date\", \"user_id\"]].drop_duplicates()\n        return uniq.groupby(\"age_group\").size()\n\n    first_active = active_days_by_age(window[window[\"date\"].isin(first_dates)])\n    second_active = active_days_by_age(window[window[\"date\"].isin(second_dates)])\n\n    def daily_rate(active_days: float, total_users: int, days: int) -> float:\n        if total_users <= 0 or days <= 0:\n            return 0.0\n        return active_days / (total_users * days) * 100\n\n    segments = []\n    for age in AGE_GROUPS:\n        total_users = int(total_by_age.get(age, 0))\n        f_days = int(first_active.get(age, 0))\n        s_days = int(second_active.get(age, 0))\n        f_rate = daily_rate(f_days, total_users, first_days)\n        s_rate = daily_rate(s_days, total_users, second_days)\n        segments.append(\n            {\n                \"age\": age,\n                \"totalUsers\": total_users,\n                \"firstActiveUserDays\": f_days,\n                \"firstDau\": round(f_days / first_days, 4) if first_days > 0 else 0.0,\n                \"firstDailyActiveRate\": round(f_rate, 4),\n                \"secondActiveUserDays\": s_days,\n                \"secondDau\": round(s_days / second_days, 4) if second_days > 0 else 0.0,\n                \"secondDailyActiveRate\": round(s_rate, 4),\n                # 单位是百分点（后半段 − 前半段），可正可负。\n                # 用未取整的两个率相减、再统一取整，避免两次取整误差叠加。\n                \"changePp\": round(s_rate - f_rate, 4),\n            }\n        )\n\n    # 全站合计的活跃人天 —— AI 助手页的交叉验证就钉这两个整数。\n    # 一条 SQL 里挂两条检查、两条合起来才钉住切分点：切分点错一天，\n    # 两段的合计会同时变化、两条都会红。只验一条容易漏。\n    return {\n        \"firstStart\": first_dates[0].strftime(\"%Y-%m-%d\") if first_days else \"\",\n        \"firstEnd\": first_dates[-1].strftime(\"%Y-%m-%d\") if first_days else \"\",\n        \"firstDays\": first_days,\n        \"secondStart\": second_dates[0].strftime(\"%Y-%m-%d\") if second_days else \"\",\n        \"secondEnd\": second_dates[-1].strftime(\"%Y-%m-%d\") if second_days else \"\",\n        \"secondDays\": second_days,\n        \"firstActiveUserDays\": int(sum(s[\"firstActiveUserDays\"] for s in segments)),\n        \"secondActiveUserDays\": int(sum(s[\"secondActiveUserDays\"] for s in segments)),\n        \"segments\": segments,\n    }\n"
  }
}
