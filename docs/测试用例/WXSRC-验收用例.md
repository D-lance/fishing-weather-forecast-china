# 天气源（CMA 主源 + best_match 回退）验收用例

> 覆盖：`forecastUrl` / `mergeForecast` / `summarizeDay` / 页面 5 天卡片 · 用例规范：`API_WebPage_TestCase.md`
> 优先级：P0 阻塞 / P1 核心 / P2 重要 / P3 健壮

## 一、接口与入口清单

| 类型 | 入口 | 说明 |
|---|---|---|
| URL 构造函数 | `web/engine.js` `forecastUrl(lat, lon, opts)` | 主源 `models=cma_grapes_global`；回退 `models=best_match`；`forecast_days=6`，第 6 天只给热季最后一天补次日 00–02 |
| 纯函数 | `web/weather.js` `mergeForecast(primary, fallback)` | 主源非空值优先，缺失字段/小时/天用回退源补齐 |
| 纯函数 | `web/weather.js` `summarizeDay(fc, date)` | 今天优先 `fc.current`；未来天用白天主导天气，降水类取最严重 |
| 页面 | `#pick #d-weather` | 今日显示“现在”，未来天显示“白天”；地点标明信江 |
| 页面 | `#days` | 按实际可用数据渲染 5 天，不强行补第 6/7 天 |

## 二、正常流程

| 编号 | 用例名 | 优先级 | 预置条件 | 操作步骤 | 预期结果 | 执行方式 | 执行结果 |
|---|---|---|---|---|---|---|---|
| TC-DATA-N-101 | CMA 主源 URL | P0 | 无 | 调用 `forecastUrl(28.26,117.03)` | URL 含 `models=cma_grapes_global`、`forecast_days=6`、`current=temperature_2m,...` | Node 源码断言 | ✅ 通过 |
| TC-DATA-N-102 | best_match 回退 URL | P0 | 无 | 调用 `forecastUrl(28.26,117.03,{model:'best_match'})` | URL 含 `models=best_match`，其余参数一致 | Node 源码断言 | ✅ 通过 |
| TC-DATA-N-103 | CMA 天气码优先 | P0 | 主源有天气码；回退有不同温度 | 调用 `mergeForecast(primary,fallback)` | 天气码/云量取主源；温度、`precipitation_probability` 取回退 | Node 单测 | ✅ 通过 |
| TC-DATA-N-104 | 缺失小时/天补齐 | P0 | 主源缺少部分小时和一天 | 合并后检查 `hourly.time` / `daily.time` | 缺失值由回退源按时间/日期补齐；非空主源值不被覆盖 | Node 单测 | ✅ 通过 |
| TC-DATA-N-105 | 5 天输出 | P0 | 合成 7 past + 6 forecast | `computeForecast({..., days:5})` | `days.length=5`；首日=今天；末日=今天+4 | Node 引擎测试 | ✅ 通过 |
| TC-DATA-N-106 | 温度优先 best_match | P0 | 主源温度 12.3/6.0；回退 15.5/7.6 | 调用 `mergeForecast(primary,fallback)` | `hourly.temperature_2m` / 日高低温取回退；`current.temperature_2m` 仍取主源 | Node 单测 | ✅ 通过 |
| TC-DATA-N-107 | 中国天气网快照解析 | P0 | 抓鹰潭页面 | `node tools/fetch-weather-cn.mjs --out web/data/weather-cn.json` | JSON `days.length>=5`；11/25 `text=多云`、`high=16`、`low=8`；`current.temp/text` 有值 | Node 脚本 + 单测 | ✅ 通过 |
| TC-DATA-N-108 | 展示口径 | P0 | 快照 12 小时内 | 打开 11/25 详情 | 天气带显示“白天 多云 8–16℃”，来源行“天气/温度：中国天气网” | 浏览器 | ✅ 通过 |
| TC-WX-UI-N-101 | 今日实况 | P0 | 合并响应含 `current` | 打开页面，看今日天气带 | 显示“现在 + 当前天气 + 当前温度”，不是白天最差天气 | 浏览器 | ✅ 通过 |
| TC-WX-UI-N-102 | 未来天主导天气 | P1 | 某天只有 1 小时阴、其余晴 | 看该天天气带 | 显示晴/多云，不因单个小时显示阴；有降水/雷暴时仍显示降水天气 | Node 单测 + 浏览器 | ✅ 通过（Node 单测） |
| TC-WX-UI-N-103 | 5 张日期卡 | P0 | 合并响应覆盖 5 天 | 打开页面 | 只显示 5 张日期卡；无第 6/7 天空卡 | 浏览器 | ✅ 通过 |
| TC-WX-UI-N-104 | 地点标注 | P2 | 默认点 | 看天气带 | 显示“鹰潭 · 信江”，不再只写“鹰潭” | 浏览器 | ✅ 通过 |
| TC-WX-UI-N-105 | 明日温度 | P0 | 11/25 | 点明天，看天气带 | 显示约 `7.6–15.5℃`，接近中国天气网 `8–16℃`，不再是 CMA 的 `6–12.3℃` | 浏览器 | ✅ 通过 |

## 三、异常与边界

| 编号 | 用例名 | 优先级 | 预置条件 | 操作步骤 | 预期结果 | 执行方式 | 执行结果 |
|---|---|---|---|---|---|---|---|
| TC-DATA-A-101 | CMA 请求失败 | P0 | 拦截 CMA 请求 | 打开页面 | 自动用 best_match 出预报；页面不空白、不无限 loading | 浏览器 Network 拦截 | ⚠️ 代码审查：`mergeForecast(null, fallback)` 走回退，未做浏览器拦截 |
| TC-DATA-A-102 | 两源都失败 | P0 | 拦截两个 forecast 请求 | 打开页面 | 显示天气错误块；loading 消失；无旧详情残留 | 浏览器 Network 拦截 | ⚠️ 代码审查：两源为 null 时 `mergeForecast` 返回 null，`choosePlace` 抛错并显示错误块；未做浏览器拦截 |
| TC-DATA-A-103 | 主源缺降水概率 | P1 | 主源 `precipitation_probability` 全 null | 合并后看天气带 | 降水概率取回退值，不显示 `—`（回退有值时） | Node 单测 | ✅ 通过 |
| TC-DATA-A-104 | 主源缺阵风 | P0 | 主源末端 `wind_gusts_10m` 为 null | 合并后看安全封顶 | 阵风由回退补齐；7 级阵风封顶仍触发 | Node 引擎测试 | ✅ 通过 |
| TC-DATA-A-105 | 无白天小时 | P2 | 只有 20:00 小时 | 调用 `summarizeDay` | 退回当天全部小时，天气带仍显示 | Node 单测 | ✅ 通过 |
| TC-DATA-A-106 | 中国天气网快照缺失/过期 | P1 | 删除或改旧 `/data/weather-cn.json` | 打开页面 | 天气带回退 Open-Meteo；来源行显示 Open-Meteo；不空白、不报错 | 浏览器 + 代码审查 | ⚠️ 代码审查：`cnFresh()` 12h/`!r.ok` 走回退，未做浏览器删除演示 |

## 四、红线专项

| 编号 | 用例名 | 优先级 | 操作 | 预期 | 执行方式 | 执行结果 |
|---|---|---|---|---|---|---|
| TC-DATA-R-101 | 安全封顶不丢 | P0 | 合并数据含雷暴/7 级阵风/强降水 | 小时/日封顶仍为 10/20/15/35、45/60；安全提示存在 | Node 引擎测试 | ✅ 通过 |
| TC-DATA-R-102 | 分数范围 | P0 | 合并数据跑 4 鱼种 | 所有分项/日分/小时分 0–100，无 NaN | Node 引擎测试 | ✅ 通过 |
| TC-DATA-R-103 | 热季最后一天 | P0 | 5 天输出 + 热季 | 最后一天 23 小时（04–23 + 次日 00–02） | Node 引擎测试 | ✅ 通过 |

## 五、统计

| 分类 | 数量 | P0 | P1 | P2/P3 |
|---|---|---|---|---|
| 接口/纯函数 | 7 | 6 | 1 | 0 |
| 页面 | 6 | 4 | 1 | 1 |
| 异常 | 6 | 2 | 2 | 2 |
| 红线 | 3 | 3 | 0 | 0 |
