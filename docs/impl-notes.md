# 实现备注（model.md 之外的细节）

> `docs/model.md` 写公式口径；本文件记录 `web/engine.js` 里为了处理缺数据、时间边界和展示字段而做的具体选择。改这些行为时同步本文件。

## 1. 缺数据默认值

| 字段 / 场景 | 实现 | 位置 |
|---|---|---|
| `pressure_msl` 缺失 | `S_pressure = 70`，理由「气压数据暂缺，按一般情况算」 | `engine.js` `sPressure` |
| `wind_speed_10m` 缺失 | `S_wind = 70`，理由「风速数据暂缺，按一般情况算」 | `engine.js` `sWind` |
| `cloud_cover` 缺失 | 按 50% 云量（多云） | `engine.js` `sSky` |
| `wind_speed_10m` 缺失且用于 `S_geo` | 按 3.0 m/s（不触发池塘缺氧扣分） | `engine.js` 主循环 `sGeo` 调用 |
| `d24` 缺失但 `d3 ≤ −1.0` | 仍给 +5「短时降压」；文档只写 `d24 > −6`，缺数据时按不阻塞处理 | `engine.js` `sPressure` |
| `marine` 请求失败 / 全 null | 按淡水处理；不回潮汐；水温退回淡水公式 | `engine.js` `marineAvailable` / `computeForecast` |
| `daily` 某天缺 `W` | 跳过该天；网页端若 7 天不足，按实际天数渲染 | `engine.js` 主循环 |
| `sunrise/sunset` 缺失 | `S_time` 跳过晨昏/夜间分支，按中午/白天规则 | `engine.js` `sTime` |

## 2. 时间与小时

- Open-Meteo `timezone=auto` 返回的 `YYYY-MM-DDTHH:MM` 被当作“本地分钟数”（伪 UTC）解析；需要真实时刻（月亮）时再减 `utc_offset_seconds`。
- 午间是半开区间 `[11:00, 15:00)`。
- 参与小时：非热季 `04:00–22:00`（19 个）；热季 `04:00–23:00` + `d+1 00:00–02:00`（23 个）。
- 网页端 `forecast_days=8`，`localToday(fc)` 从今天起取 7 天；第 8 天只给最后一天补 `d+1 00–02`。不要把 8 天直接显示成 8 张卡，也不要用 `firstDi = nd - 7`（会把首日变成明天）。

## 3. 日月

- 月上/下中天：从当地 0 点起每 10 分钟采样月亮高度（144 点），取最大/最小值第一个采样时刻。
- 月出/月落：suncalc `getMoonTimes`，起点是当地 0 点对应的真实 UTC 毫秒。
- 月亮事件取该小时所在日历日的前一天、当天、后一天合集；跨午夜算。
- 潮汐极值去毛刺：相邻极值落差 < 0.10 m 成对删除，重新扫描直到没有。

## 4. 输出与展示

- `score`、`sub`、窗口分取整；`h`、`hs`、`water_temp` 保留 1 位小数。
- `d.sub` / `d.reasons` 取当天 `Hs` 最高（并列取最早）那一小时。
- 额外输出给界面的字段：`level_index`、`cap_kinds`、`alerts`、`ice`、`air_mean/max/min`、`precip`、`sunrise/sunset`、`moonrise/moonset/transit`、`best_hour`、`gate`、`tides`、`hours[].flags`。
- 海钓但海况全空时：仍按 `sea` 记水域，水温退回淡水公式、不算潮；界面会显示「没有潮位数据」。若要在理由里明确写“淡水公式估算”，需同时改 Python 基准文案，暂未改。

## 5. 已知边界 / 待办

- 高海拔水域目前用 `pressure_msl`（海平面气压），不是站点气压；阈值 1000–1030 对高海拔会失真。若改用 `surface_pressure`，需要按海拔调整阈值。
- `utc_offset_seconds` 按整段响应取一个值；有夏令时的地区跨 DST 时，月亮事件可能差 1 小时。中国无夏令时，当前不受影响。
- `model.md` §8 的顶层 `candidates` 字段网页端未实现；网页在搜索结果列表里展示候选。
- `fixtures/` 默认只放说明；有成对样例时 `tools/check-fixtures.mjs` 会从 expected 首日推导 `now`（15 天响应，7 past + 8 forecast）。无样例时退出码 2。

## 6. v0.4 新数据源与缺省

- `surface_pressure`：有非空值就用站点气压，并按 `pNorm` 平移 1000/1030/1005 阈值；没有就退回 `pressure_msl`、`shift=0`（v0.3 行为）。
- `flood`：Flood API 缺失/失败/该日为 null → `discharge_trend='unknown'`，`S_geo` 不加趋势修正；只作用于 river/reservoir。
- `marine` 新字段：`wave_period` / `ocean_current_velocity` 为 null → 对应潮汐分量跳过；`tide_range` 为 null → 不加潮差分量；潮汐极值找不到时 `S_moon` 仍只算月相。
- 低氧 flag：`pond/lake + hot + wind<2 + P<pNorm−5 + 夜间` → 小时封顶 45 + `oxygen` 提示；`ice` + 小水体 → `oxygenIce` 提示，不封顶。没有实测溶氧，不输出 mg/L。
- 季节建议：总是追加一条 `advice`，不影响分数；Python 基准文案需同步。
- Flood API 的 `past_days` 兼容性在目标网络需实测；不支持时 `floodP` 会 catch 成 null，评分退回 v0.3，不影响主流程。
- v0.5 旧模型：`WATER_WEIGHTS` 仍保留；`computeForecast({ model:'0.5' })` 用于详情“旧模型”对比，不参与线上主分。
- v0.6 影子：`computeForecast({ model:'0.6' })` 用 `SHADOW_WEIGHTS`、气压拆分、水温趋势、solunar 降权；代码和测试保留，网页不再展示。
- v0.7 线上：`computeForecast` 默认 v0.7；四目标鱼用 `SPECIES_WEIGHTS`，时段活动/水域偏好/季节/溶氧修正见 `docs/model.md` §13；v0.7 权重按鱼种切换，水域类型仍影响 `S_geo`/低氧。
- 城市平均溶解氧：`tools/fetch-oxygen.mjs` 请求国家发布系统（`AreaID=360000`，POST `Publish.ashx`），按 `cities` 映射平均，输出 `web/data/oxygen.json`；构建复制到 `site/data`。
- 国家接口 CORS 只允许 `https://szzdjc.cnemc.cn`，浏览器不能从本站直连；用 CI/定时任务抓，页面同源读 `/data/oxygen.json`。建议 30–60 分钟一次。
- App 用 Nominatim reverse 的 `city/county` 归一化（鹰潭/贵溪/余江/月湖），只有 `cities[city].do` 存在才传 `oxygen`；只覆盖第一个显示日，其他天仍用代理。

## 7. 多鱼种主钓排行

- `web/app.js` 的 `TARGET_SPECIES` 固定为 `crucian/bream/culter/mandarin`；页面没有鱼种勾选，4 种始终参与排序。
- `recompute()` 每种鱼各算一次 `computeForecast`（v0.7）和一次 `model:'0.5'` 旧模型对比，分别存到 `S.outs[key]`；旧模型挂在各自输出的 `shadow`，详情显示“旧模型 0.5”。v0.6 影子代码保留但不再展示。
- `web/rank.js` 的 `rankDay(outputs, date)` 按 `score` 降序，同分按 `TARGET_SPECIES` 的输入顺序；`bestByDate` 给每天 `top + ranking`。`S.days` 会丢掉 4 种全缺的日期。
- `mergeAlerts` 合并所有鱼种的 `alerts`，按 `date + line` 去重；同一场雷暴/大风不会因为 4 个鱼种显示 4 遍。
- 封顶/低氧标记由 `rank.js` 的 `dayFlagKeys(day)` 统一给出：有 `day_cap` 时返回 `cap`（用 `cap_kinds` 显示“雷暴/大风/浪封顶”），并保留 `rain/oxygen/oxygenWarn`；没有 `day_cap` 时返回逐项告警。7 天卡片、主钓卡和排行行都用同一套标记。
- 7 天卡片用当天 `top` 的分数、等级、时段和封顶；详情 `dhead`/`#d-best` 跟随 `S.focus`：看第一名时标“主钓”，点排行看其他鱼时标“查看”，分数/等级/时段/建议都切到该鱼种；排行第一名的“主钓”徽标不变。点排行只改 `S.focus`，不重算天气；点日期会把 `S.focus` 重置为该日 top。
- 主钓/排行文案是“按鱼种鱼情排序”；主钓卡显示 `水温 X℃，<鱼种>适温 lo–hi℃；鱼种权重见下方`，最佳时段下显示 `best_why.time`/`best_why.wind`（为什么是这段），详情 `#d-meta` 显示 `水温闸门 ×0.XX`。v0.7 鱼种分差来自鱼种权重、时段活动、水域偏好、季节和溶氧；其余天气项共用。
- `rank.js` 的 `allOptimal(entry)` 只在选中鱼种水温分都为 100 **且日分相同**时返回 true：7 天卡片显示“都适温”，主钓卡改成“N 种都适温，按你常钓的鱼和饵准备”，排行不再标“主钓”，详情不显示“（主钓）”。
- `S.out` 始终等于 `S.outs[S.focus]`，`renderPlace`/`drawChart` 仍可用；`drawChart` 用日期找当前查看鱼种的 day，避免缺天时下标错位。
- URL 不再写 `sp`；旧 `sp=` 忽略，仍显示 4 种排序。单个鱼种计算失败会跳过；4 种全失败才显示天气错误。

## 8. 日期天气带

- `web/weather.js` 的 `summarizeDay(fc, date)` 从现有 `S.fc` 汇总：白天 06–18 点，没有白天小时退回当天全部小时；天气现象取最高严重度；风取白天最大风速及对应风向；降水概率取最大；湿度取非空平均。
- `app.js` 的 `renderWeather(entry)` 填充 `#pick` 的 `.opts` 第二列 `#d-weather`；主行是“鹰潭 · 今天/明天/周X 日期 + 图标 + 天气 + 高低温”，副行是风/降水概率/湿度。切日期走 `renderDetail`，不发新请求。
- 缺单项显示 `—`；整日无数据隐藏天气带。`#d-meta` 不再重复气温，保留水温、降水量、日出日落、月相。
- 天气带只做展示，不参与评分；英文页保留最小动态键，避免缺字段。

## 9. 整页长图（浏览器）

- 本地 `web/vendor/html2canvas.min.js`（1.4.1，MIT）负责把整个页面渲染成图片；`renderFullPage()` 以 `windowWidth:1080`、全页高度抓取 `document.body`，输出宽 1080 的整页长图。不再使用 `getDisplayMedia`，不弹屏幕选择器。
- 抓取时在 clone 里把顶部 sticky 栏改为 static，隐藏状态栏/截图按钮，移除关闭的说明 dialog；避免固定元素重复/状态文案入图。
- 手机（`pointer: coarse`）且浏览器支持文件分享时调 `navigator.share({files})`，可直选微信；桌面或分享不可用时下载 `fish-*.png`。
- 用户取消系统分享 → “已取消分享”；生成/下载失败 → “生成整页截图失败，请重试”；不把异常打到 Console。
- 只做浏览器；不改 Android、不发新请求、不改评分。整页长图宽度 1080，微信可查看但预览会是一条长图。
