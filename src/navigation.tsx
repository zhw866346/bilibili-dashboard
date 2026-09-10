/* ==========================================================================
   导航与路由的「唯一清单」
   --------------------------------------------------------------------------
   左侧导航栏、页面标题、路由规则，全部读这一份数据。
   以后要加一个新页面，只需要在这里加一条，导航和路由会一起出现——
   不用去三个地方分别改，也就不会漏。
   ========================================================================== */

import type { ReactNode } from 'react'

import {
  IconAi,
  IconContent,
  IconCross,
  IconOverview,
  IconPython,
  IconSql,
  IconUsers,
} from './components/icons'
import AiAnalyst from './pages/AiAnalyst'
import Content from './pages/Content'
import Overview from './pages/Overview'
import PythonAnalysis from './pages/PythonAnalysis'
import SqlAnalysis from './pages/SqlAnalysis'
import UserContent from './pages/UserContent'
import Users from './pages/Users'

export interface NavItem {
  /** 网址路径 */
  path: string
  /** 导航栏上的中文名 */
  label: string
  /** 英文副标题 */
  sub: string
  /** 一句话说明这个页面是干什么的，显示在页面顶部 */
  purpose: string
  icon: ReactNode
  element: ReactNode
}

export const NAV_ITEMS: NavItem[] = [
  {
    path: '/',
    label: '首页概览',
    sub: 'Overview',
    purpose: '大盘核心指标一览：用户规模、活跃程度、内容消费与互动表现。',
    icon: <IconOverview />,
    element: <Overview />,
  },
  {
    path: '/users',
    label: '用户分析',
    sub: 'Users',
    purpose: '按年龄段拆解用户规模、活跃度与内容偏好：谁更活跃、谁看得更深、谁喜欢什么。',
    icon: <IconUsers />,
    element: <Users />,
  },
  {
    path: '/content',
    label: '内容分析',
    sub: 'Content',
    purpose: '八个内容分区横向对比：既看流量，也看深度与互动质量。',
    icon: <IconContent />,
    element: <Content />,
  },
  {
    path: '/user-content',
    label: '用户 × 内容',
    sub: 'Cross Analysis',
    purpose: '交叉分析：什么样的人爱看什么内容。',
    icon: <IconCross />,
    element: <UserContent />,
  },
  {
    path: '/sql',
    label: 'SQL 分析',
    // 页面顶部会把 sub 大写显示，所以这里写成 SQL Analysis → SQL ANALYSIS
    sub: 'SQL Analysis',
    purpose:
      '基于用户、内容与观看行为数据，通过 SQL 完成指标计算、用户分层、内容分析与业务问题验证。',
    icon: <IconSql />,
    element: <SqlAnalysis />,
  },
  {
    path: '/python',
    label: 'Python 分析',
    sub: 'Python Analysis',
    purpose:
      '用 Pandas 补上 SQL 不方便做的部分：数据体检、分位数分层、移动平均、相关系数与向量相似度，' +
      '并与前面几页的口径逐项对账。',
    icon: <IconPython />,
    element: <PythonAnalysis />,
  },
  {
    path: '/ai',
    label: 'AI 分析助手',
    sub: 'AI Analyst',
    purpose: '通过自然语言提问，让 AI 调用 SQL / Python 分析能力完成数据分析。',
    icon: <IconAi />,
    element: <AiAnalyst />,
  },
]
