# CLAUDE.md

## Project Overview

今日鱼情 / fishing-weather-forecast-china：纯静态钓鱼天气预报站 + Android WebView 壳。
没有后端、没有数据库、没有账号体系；浏览器直接请求公开数据源，`web/engine.js` 在本地算分。

- 线上：<https://fish.satloot.com>（英文 <https://fish.satloot.com/en/>）
- 安卓：`android/` 原生 WebView 壳，构建时把 `site/` 打进 APK
- 评分口径：`docs/model.md`（v0.4，网站与 Python 技能共用；改公式先改这里）

## Build, Test & Verify

```bash
# 网页构建：生成 site/（中文 / 和英文 /en/）
node tools/build.mjs

# 本地预览：http://127.0.0.1:8791
node serve-dev.mjs

# 引擎回归 / 坐标自测
node tools/test-engine.mjs
node tools/test-coord.mjs

# 与 Python 基准对分（默认读仓库 fixtures/，也可传外部目录；见 fixtures/README.md）
node tools/check-fixtures.mjs [fixtures目录]

# 安卓 APK：构建前会自动跑 node tools/build.mjs
cd android && ./gradlew assembleRelease
```

### 验证要求

- `node tools/test-engine.mjs`、`node tools/test-coord.mjs`、`node tools/build.mjs` 必须全绿。
- `node tools/build.mjs` 必须输出“英文页可见文本无中文残留”，且没有未用词典键。
- 浏览器自闭环：打开受影响页面 → Console 无 error/warning → Network 无 5xx → 无无限 loading → 空态/错误态/断网/地图 CDN 失败都有明确提示。
- 地图相关改动至少验证：搜索水体、地图点选、长河点选、附近水体、底图切换、Leaflet 加载失败。
- 英文相关改动至少验证：`/en/` 页面动态文案、地图 attribution、语言切换保留当前钓点 URL 参数。

## Architecture

```
web/index.html      中文页面（唯一源；构建时生成英文页）
web/app.js          界面、搜索、地图、状态、渲染
web/engine.js       鱼情评分纯函数（不碰 DOM；Node 与浏览器共用）
web/coord.js        WGS-84 / GCJ-02 换算、几何吸附
web/llms.txt        站点说明
i18n/en.json        英文词典（构建时整句替换）
tools/build.mjs     构建 site/
tools/test-engine.mjs 引擎回归（合成 Open-Meteo 响应）
tools/test-coord.mjs  坐标换算自测
serve-dev.mjs       本地静态预览
android/            安卓 WebView 壳
docs/model.md       评分模型唯一口径
```

### 数据流

1. 用户在搜索框 / GPS / Leaflet 地图选点。
2. `app.js` 请求 Open-Meteo forecast + marine、Nominatim、Overpass。
3. `engine.computeForecast()` 计算 7 天出钓指数、最佳时段、八项分、建议和安全提示。
4. `app.js` 渲染 7 天卡片、当天详情、Canvas 小时曲线、地图高亮。

### 数据源（全部免 key）

| 用途 | 接口 |
|---|---|
| 天气（含 `surface_pressure`） | `https://api.open-meteo.com/v1/forecast` |
| 海况 / 潮位 / 海流 / 浪周期 | `https://marine-api.open-meteo.com/v1/marine` |
| 河道径流趋势 | `https://flood-api.open-meteo.com/v1/flood` |
| 地名 | Nominatim 优先，Open-Meteo geocoding 兜底 |
| 水域类型 / 附近水体 | Overpass（`OVERPASS_MIRRORS` 依次尝试） |
| 地图 | Leaflet（cdnjs）+ 高德 / OpenStreetMap 瓦片 |

外部接口约定以 `web/engine.js` 的 `forecastUrl` / `marineUrl` / `geocodeUrl` / `overpassQuery` 为准，不要凭空写路径。

## Conventions

- **模型口径**：`docs/model.md` 是唯一口径；改公式先改文档，再改 `web/engine.js`，并保持 JS 与 Python 基准误差 ≤ 1 分（有 fixtures 时）。
- **v0.4 扩展**：`surface_pressure` 海拔修正、Flood API 径流趋势、海钓潮差/流速/浪周期、低氧 flag、季节/产卵建议；没有新数据时保持 v0.3 行为（季节建议除外）。
- **热季最后一天**：`forecastUrl` / `marineUrl` 请求 `forecast_days=8`，网页用 `localToday()` 把“今天”传给 `computeForecast`，保证热季最后一天也有次日 00–02 点；不要只改成 8 天却让 `firstDi = nd - 7` 把首日变成明天。
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
