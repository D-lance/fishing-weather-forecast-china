# CLAUDE.md

## Project Overview

今日鱼情 / fishing-weather-forecast-china：纯静态钓鱼天气预报站 + Android WebView 壳。
没有后端、没有数据库、没有账号体系；浏览器直接请求公开数据源，`web/engine.js` 在本地算分。

- 线上：<https://fish.satloot.com>（英文 <https://fish.satloot.com/en/>）
- 安卓：`android/` 原生 WebView 壳，构建时把 `site/` 打进 APK
- 评分口径：`docs/model.md`（v0.7，网站与 Python 技能共用；v0.5 旧模型只做详情对比；改公式先改这里）

## Build, Test & Verify

```bash
# 网页构建：生成 site/（中文 / 和英文 /en/）
node tools/build.mjs

# 本地预览：http://127.0.0.1:8791
node serve-dev.mjs

# 更新鹰潭城市平均溶解氧（国家发布系统；建议 30–60 分钟一次）
node tools/fetch-oxygen.mjs --out web/data/oxygen.json

# 更新中国天气网展示快照（页面天气/温度口径；建议 30–60 分钟一次）
node tools/fetch-weather-cn.mjs --out web/data/weather-cn.json

# 引擎回归 / 排行纯函数 / 天气汇总 / 中国天气网解析 / 坐标自测
node tools/test-engine.mjs
node tools/test-rank.mjs
node tools/test-weather.mjs
node tools/test-cn-weather.mjs
node tools/test-coord.mjs

# 与 Python 基准对分（默认读仓库 fixtures/，也可传外部目录；见 fixtures/README.md）
node tools/check-fixtures.mjs [fixtures目录]

# 安卓 APK：构建前会自动跑 node tools/build.mjs
cd android && ./gradlew assembleRelease
```

### 验证要求

- `node tools/test-engine.mjs`、`node tools/test-rank.mjs`、`node tools/test-weather.mjs`、`node tools/test-cn-weather.mjs`、`node tools/test-coord.mjs`、`node tools/build.mjs` 必须全绿。
- `node tools/build.mjs` 必须输出“英文页可见文本无中文残留”，且没有未用词典键。
- 浏览器自闭环：打开受影响页面 → Console 无 error/warning → Network 无 5xx → 无无限 loading → 空态/错误态/断网/地图 CDN 失败都有明确提示。
- 地图相关改动至少验证：搜索水体、地图点选、长河点选、附近水体、底图切换、Leaflet 加载失败。
- 英文相关改动至少验证：`/en/` 页面动态文案、地图 attribution、语言切换保留当前钓点 URL 参数。
- 整页截图相关改动至少验证：点“截屏”生成宽 1080 的整页长图；手机系统分享/桌面下载；取消分享提示；375px 按钮换行。

## Architecture

```
web/index.html      中文页面（唯一源；构建时生成英文页）
web/app.js          界面、状态、渲染
web/engine.js       鱼情评分纯函数（不碰 DOM；Node 与浏览器共用）
web/rank.js         多鱼种排行纯函数（rankDay / bestByDate / mergeAlerts）
web/weather.js      多模型合并 + 日期天气汇总纯函数（mergeForecast / summarizeDay）
web/cnweather.js    中国天气网页面解析纯函数（parseWeatherPage / cnKind）
web/coord.js        WGS-84 / GCJ-02 换算、几何吸附
web/llms.txt        站点说明
i18n/en.json        英文词典（构建时整句替换）
tools/build.mjs     构建 site/
tools/test-engine.mjs 引擎回归（合成 Open-Meteo 响应）
tools/test-rank.mjs   多鱼种排行纯函数自测
tools/test-weather.mjs 日期天气汇总纯函数自测
tools/test-cn-weather.mjs 中国天气网页面解析自测
tools/fetch-weather-cn.mjs 抓中国天气网 → web/data/weather-cn.json
tools/test-coord.mjs  坐标换算自测
serve-dev.mjs       本地静态预览
android/            安卓 WebView 壳
docs/model.md       评分模型唯一口径
```

### 数据流

1. 固定默认钓点：信江（鹰潭段），无地图选点。
2. `app.js` 请求 Open-Meteo forecast + marine、Nominatim、Overpass，并读取 `/data/weather-cn.json` 做中国天气网口径展示。
3. `engine.computeForecast()` 计算 5 天出钓指数、最佳时段、八项分、建议和安全提示。
4. `app.js` 渲染 5 天卡片、当天详情、Canvas 小时曲线、地图高亮。

### 数据源（全部免 key）

| 用途 | 接口 |
|---|---|
| 天气（含 `surface_pressure` / `current`） | `https://api.open-meteo.com/v1/forecast`，CMA `models=cma_grapes_global` 主源 + `best_match` 回退；温度字段优先 `best_match` |
| 天气展示（中国天气网口径） | `http://www.weather.com.cn/weather/101241101.shtml`，由 `tools/fetch-weather-cn.mjs` 定时抓成 `web/data/weather-cn.json`；页面只读本地 JSON |
| 海况 / 潮位 / 海流 / 浪周期 | `https://marine-api.open-meteo.com/v1/marine` |
| 河道径流趋势 | `https://flood-api.open-meteo.com/v1/flood` |
| 鹰潭城市平均溶解氧 | 国家地表水水质自动监测实时数据发布系统（`tools/fetch-oxygen.mjs` 定时抓取） |
| 水域类型（仅自动识别时） | Overpass（`OVERPASS_MIRRORS` 依次尝试） |

外部接口约定以 `web/engine.js` 的 `forecastUrl` / `marineUrl` / `geocodeUrl` / `overpassQuery` 为准，不要凭空写路径。

## Conventions

- **模型口径**：`docs/model.md` 是唯一口径；改公式先改文档，再改 `web/engine.js`，并保持 JS 与 Python 基准误差 ≤ 1 分（有 fixtures 时）。
- **v0.4 扩展**：`surface_pressure` 海拔修正、Flood API 径流趋势、海钓潮差/流速/浪周期、低氧 flag、季节/产卵建议；没有新数据时保持 v0.3 行为（季节建议除外）。
- **v0.5 旧模型**：水域上下文权重；`model:'0.5'` 仍可用，只用于详情“旧模型”对比，不参与线上主分。
- **v0.6 影子**：`computeForecast({ model:'0.6' })` 用 `SHADOW_WEIGHTS`、气压拆分、水温趋势、solunar 降权；保留代码和测试，但网页不再展示。
- **v0.7 线上**：`computeForecast` 默认 v0.7；四目标鱼用 `SPECIES_WEIGHTS` + 时段活动/水域偏好/季节/溶氧修正（见 `docs/model.md` §13）；无鱼获校准，页面标经验模型。
- **城市平均溶解氧**：国家接口 CORS 只允许自身，不能前端直连；`tools/fetch-oxygen.mjs` 定时写 `web/data/oxygen.json`，页面读 `/data/oxygen.json`；实测值只覆盖第一个显示日，其他天用代理。
- **中国天气网展示**：页面天气/温度优先读 `/data/weather-cn.json`（中国天气网口径，12 小时内有效）；缺失或过期回退 Open-Meteo。该 JSON 只影响天气带展示，不参与 v0.7 评分；评分仍用 Open-Meteo（中国天气网没有气压/阵风/逐小时云量）。
- **鹰潭专用模式**：`web/app.js` 的 `YINGTAN_ONLY=true`；无地图、无搜索/GPS；固定默认点 `DEFAULT_POINT`（28.26,117.03，信江鹰潭段）；城市固定 `鹰潭市`，4 种目标鱼 `crucian/bream/culter/mandarin` 固定全选，5 天卡片显示 top，详情给主钓 + 排行；传 `style:'taiwan'`（台钓粉饵/虾建议）。
- **热季最后一天**：`forecastUrl` 请求 `forecast_days=6`（`marineUrl` 仍为 8），网页用 `localToday()` 把“今天”传给 `computeForecast`，只显示 5 天；第 6 天给热季最后一天补次日 00–02 点。不要只改成 6 天却让 `firstDi = nd - 5` 把首日变成明天。
- **安全封顶**：雷暴、7 级阵风、2.5m 浪、强降水的小时/日级封顶不得移除；这是产品安全底线。
- **无后端**：不加数据库/登录/服务端 API；所有请求从浏览器发出。
- **无 npm 依赖**：网页构建只需要 Node 18+；不要引入打包器。
- **文案**：动态文案放在 `app.js` 的 `TXT` 或 `engine.js` 的 `T`；静态中文放 `index.html`，由 `i18n/en.json` 翻译。不要在 app.js 里硬编码中文。
- **隐私**：不提交真实个人位置、鱼获数据、签名文件、`.env` 或任何密钥。
- **改动范围**：只做被要求的；不顺手重构无关代码；未经要求不 commit/push。
- **推送目标**：`mine` = `https://github.com/D-lance/fishing-weather-forecast-china.git`（用户 fork）；`origin` 是原作者 `q3579338` 的上游。默认提交/推送到 `mine/main`，不要推 `origin`，除非用户明确要求。

## Rules & Acceptance

- 核心协作规则：`.claude/rules/core-rules.md`
- API / 页面测试模板：`.claude/rules/API_WebPage_TestCase.md`
- 验收用例起草规范：`docs/测试用例/_起草规范.md`
- 验收命令：`.claude/commands/acceptance.md`

当用户说“按模板补验收用例”或输入 `/acceptance <功能名>` 时，按上述模板生成 `docs/测试用例/<功能>-验收用例.md` 并逐条执行。
