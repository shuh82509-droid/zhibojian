# WIS 直播指挥中心｜交付说明

## 当前已完成

- 已部署 WIS 直播指挥中心，保留私有运行环境。
- 视觉参考 LIVE HUB 数据中心：深绿侧栏、浅色主画布、圆角数据卡片与场次表格。
- 档案中心为统一入口，页面上方可以切换：官旗、品牌精选、优选。
- 主页面仅展示当天开播的场次；每个店铺的数据独立查询，不跨店铺汇总。
- 每条数据以 `live_room_id`（直播场次 ID）为唯一场次标识。
- 场次明细提供“查看详情”按钮；选择后，主页面回显该场的时间、时长、GMV、ROI、转化率、成交峰谷及流量构成。

## 数据与口径

服务端通过 Fandow MCP 读取数据，浏览器不直接访问 MCP，也不携带访问密钥。

主要数据表：

- `buyin_live_business_halfhour_snapshot`：场次、GMV、千川消耗、退款、时长。
- `buyin_live_screen_halfhour_snapshot`：累计观看人数、观看-成交转化率。
- `buyin_live_traffic_channel_halfhour_snapshot`：短视频、直播推荐、其他流量构成。

取数规则：店铺名称 + 当天开播日期 + 直播场次 ID。每个场次取最近一次半小时快照；成交峰谷由相邻快照的成交金额增量计算。

店铺映射：

- 官旗：WIS官方旗舰店
- 品牌精选：WIS官方旗舰店甄选
- 优选：WIS官方旗舰店优选

## 目录说明

- `app/`：前端页面与服务端接口。
- `app/api/dashboard/`：MCP 场次级数据查询接口。
- `app/api/_lib/mcp.ts`：服务端 MCP 调用封装。
- `.openai/hosting.json`：站点部署配置。
- `public/`：静态资源。
- `dist/`：最近一次构建产物。

## 运行所需环境变量

在部署环境中配置：

`FANDOW_DATA_MCP_TOKEN`

压缩包不包含任何真实密钥或访问令牌。
