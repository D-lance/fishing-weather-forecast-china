# API 与页面通用测试用例（钓鱼天气预报项目）

> 用途：网页 / 引擎 / 外部数据接口的通用验收用例骨架。
> 来源：shensuo-trainning 项目的 `API_WebPage_TestCase.md` v1.1，已删掉 Java / Vue / uni-app / 数据库专用章节，只保留适合本项目的部分。
> 本项目没有后端、数据库、登录、多租户、软删除；请勿套用这些概念。

## 一、编号、优先级与占位符

### 1.1 编号

| 元素 | 规则 | 示例 |
|---|---|---|
| 模块标识 | 用模块缩写替换 `<MOD>` | 首页 `HOME`、搜索 `SRCH`、地图 `MAP`、评分 `SCORE`、详情 `DETAIL`、双语 `I18N`、分享 `SHARE`、数据 `DATA` |
| 正/异常 | `N` = 正常，`A` = 异常/边界 | `TC-SCORE-N-001` |
| 页面 | `UI-N/A` | `TC-MAP-UI-A-003` |
| 红线 | `R` | `TC-SCORE-R-001` |

### 1.2 优先级

- **P0**：安全封顶、分数正确性、主流程阻塞、英文页大面积中文
- **P1**：核心功能和高频操作
- **P2**：重要边界和体验
- **P3**：兼容性、无障碍、健壮性

### 1.3 占位符

| 占位符 | 含义 | 示例 |
|---|---|---|
| `<水体>` | 湖 / 河 / 水库 / 海湾名 | 太湖、千岛湖、汉江、象山港 |
| `<坐标>` | WGS-84 `lat,lon` | `31.20,120.20` |
| `<鱼种>` | `engine.js` 的 species key | `crucian`、`bass`、`seabass` |
| `<日期>` | 本地日期 `YYYY-MM-DD` | `2026-11-23` |
| `<接口>` | `engine.js` 中的 URL 构造函数 | `forecastUrl()`、`marineUrl()` |
| `<语言>` | `zh` / `en` | `en` |

## 二、外部数据接口用例

> 只用 GET；没有 Token、分页、CRUD、软删除。成功标准是 HTTP 200 + 预期 JSON 结构。

### 2.1 天气（`forecastUrl`）

| 编号 | 用例 | 优先级 | 操作 | 预期 |
|---|---|---|---|---|
| TC-DATA-N-001 | 正常坐标返回 15 天数据 | P0 | 请求 `forecastUrl(31.2,120.2)` | 200；`hourly.time` 长度 = 15×24；`daily.time` 长度 = 15；含 `utc_offset_seconds/timezone` |
| TC-DATA-N-002 | 关键字段齐全 | P0 | 检查响应 | `hourly` 含 temperature_2m / pressure_msl / surface_pressure / cloud_cover / precipitation / weather_code / wind_speed_10m / wind_direction_10m / wind_gusts_10m；`daily` 含 sunrise / sunset / temperature_2m_max / temperature_2m_min / precipitation_sum |
| TC-DATA-N-003 | 请求 8 个预报日 | P0 | 检查 URL | `past_days=7&forecast_days=8`；热季最后一天需要次日 00–02 点 |
| TC-DATA-A-001 | 经纬度边界 | P1 | lat=90/-90，lon=180/-180 | 不崩溃；返回合理错误或空数据；`app.js` 侧有范围校验 |
| TC-DATA-A-002 | 海上坐标 | P1 | 取一个海湾坐标 | forecast 正常；marine 由 `marineUrl` 另行验证 |
| TC-DATA-A-003 | 超时/断网 | P0 | 断网或拦截请求 | `app.js` 显示天气错误块，loading 消失，不能永久“正在取天气…” |
| TC-DATA-A-004 | 返回 200 但缺 hourly/daily | P1 | 用代理返回错误 JSON | `computeForecast` 抛错被捕获；显示错误块；无旧详情残留 |

### 2.2 海况（`marineUrl`）

| 编号 | 用例 | 优先级 | 操作 | 预期 |
|---|---|---|---|---|
| TC-DATA-N-004 | 海边返回海况 | P0 | 请求 `marineUrl(29.9,121.8)` | 200；含 wave_height / wave_period / sea_surface_temperature / sea_level_height_msl / ocean_current_velocity |
| TC-DATA-N-005 | 请求 8 个预报日 | P0 | 检查 URL | `forecast_days=8`，保证最后一天次日潮位可用 |
| TC-DATA-N-009 | 河道径流 | P1 | 请求 `floodUrl(31.2,120.2)` | 200；含 `daily.time` / `daily.river_discharge`；内陆/海边可能为 null |
| TC-DATA-A-005 | 内陆全 null | P1 | 请求内陆坐标 | 三列全 null；`marineAvailable()` 为 false；按淡水处理，不报错 |
| TC-DATA-A-006 | 海况请求失败 | P1 | 拦截 marine 请求 | forecast 仍可用；marine 为 null；评分退回淡水/无潮；有明确提示或无 5xx |

### 2.3 地名与水域

| 编号 | 用例 | 优先级 | 操作 | 预期 |
|---|---|---|---|---|
| TC-DATA-N-006 | Nominatim 搜水体 | P0 | 搜「太湖」「千岛湖」「汉江」 | 返回候选；水体排在前面；有 name/display_name/lat/lon |
| TC-DATA-N-007 | Nominatim 无结果时兜底 | P1 | 搜一个 Nominatim 无结果的词 | 自动改查 Open-Meteo geocoding；不白屏 |
| TC-DATA-N-008 | Overpass 水域判定 | P1 | 请求 `overpassQuery()` | 返回 elements；`classifyWater()` 能判出 lake/reservoir/river/pond/sea/unknown |
| TC-DATA-A-007 | Nominatim/Overpass 失败 | P1 | 断网/拦截 | 状态栏给出明确错误；不把网络失败误报成“没找到” |
| TC-DATA-A-008 | Nominatim 频率 | P2 | 连续快速搜索 | 遵守 ≤1 次/秒；按钮有冷却；不会并发打爆 |

## 三、引擎用例（`computeForecast`）

| 编号 | 用例 | 优先级 | 操作 | 预期 |
|---|---|---|---|---|
| TC-SCORE-N-001 | 7 天输出 | P0 | 合成 15 天响应 + `now` | `days.length=7`；首日=今天；末日=今天+6 |
| TC-SCORE-N-002 | 分数范围 | P0 | 遍历所有分项/日分/小时分 | 0–100 的有限数；无 NaN；`level_index` 与分数档位一致 |
| TC-SCORE-N-003 | 参与小时 | P0 | 非热季 / 热季 | 非热季 19 小时（04–22）；热季 23 小时（04–23 + 次日 00–02） |
| TC-SCORE-N-004 | 最佳时段 | P0 | 遍历每天 | 最多 3 段；每段分 ≥35；start/end 为 `HH:MM` |
| TC-SCORE-N-005 | 八项分与理由 | P0 | 取当天最高小时 | `sub` 8 个 key 齐全且为 0–100 整数；`reasons` 8 条非空 |
| TC-SCORE-R-001 | 热季最后一天 | P0 | 15 天响应 + `now`，热季 | 末日 23 小时，包含次日 00/01/02；不能是 20 小时 |
| TC-SCORE-R-002 | 安全封顶 | P0 | 雷暴 / 7 级阵风 / 2.5m 浪 / 强降水 | 小时分被压到 10/20/15/35；日分封顶 45/60；安全提示存在 |
| TC-SCORE-R-003 | 水温闸门 | P0 | 水温远离鱼种适宜区 | `gate=0.5+0.5·S_temp/100`；`sub.temp` 不受闸门影响；鲫鱼冰钓 `gate≥0.7` |
| TC-SCORE-R-004 | 英文输出 | P1 | `lang='en'` | reasons/advice/safety/level_text 全英文；无中文残留 |
| TC-SCORE-R-005 | 海拔气压 | P0 | elevation 2000 + surface_pressure 795 | pressure 不被误判为低压；理由显示 795 |
| TC-SCORE-R-006 | 径流趋势 | P0 | 河道路由，q 上涨/下降 >15% | geo 分 +5/−10；理由含“流量在涨/在退” |
| TC-SCORE-R-007 | 潮差/流速/浪周期 | P1 | 海钓，marine 含三项 | 月相/潮理由含潮差、流速、浪周期；缺项不写 |
| TC-SCORE-R-008 | 低氧 flag | P0 | 池塘 + 30℃ + 无风 + 低压 + 夜间 | oxygen flag、封顶 45、安全提示存在 |
| TC-SCORE-R-009 | 季节建议 | P1 | 4 月/7 月黑鱼/1 月 | advice 含春季/护崽/冬季；分数不变 |
| TC-SCORE-R-010 | 城市平均溶氧 | P0 | `oxygen` 2.5/4/6 mg/L | 2.5 封顶+oxygen；4 触发 oxygenWarn；6 不触发；只作用于第一显示日 |

> 引擎回归优先用 `node tools/test-engine.mjs`；有 Python fixtures 时再跑 `node tools/check-fixtures.mjs`。

## 四、页面用例

### 4.1 加载 / 空态 / 错误态

| 编号 | 用例 | 优先级 | 操作 | 预期 |
|---|---|---|---|---|
| TC-HOME-UI-N-001 | 首次打开 | P0 | 打开站点 | 显示“先选一个钓点”；无 JS 报错 |
| TC-HOME-UI-N-002 | 加载态 | P1 | 选点后观察 | 显示“正在取天气…”；成功后消失 |
| TC-HOME-UI-A-001 | 天气失败 | P0 | 断网/拦截 forecast | 独立错误块出现；loading 消失；不显示“先选一个钓点” |
| TC-HOME-UI-A-002 | 地图 CDN 失败 | P0 | 拦截 cdnjs | 10 秒内给出地图错误；选点流程不永久卡死；长河有降级路径 |
| TC-HOME-UI-A-003 | 空 days | P1 | 合成 W 全 null 的响应 | 显示“没有可用天气数据”；不残留上一个钓点的详情 |

### 4.2 搜索 / 定位 / 地图

| 编号 | 用例 | 优先级 | 操作 | 预期 |
|---|---|---|---|---|
| TC-SRCH-UI-N-001 | 搜水体 | P0 | 搜「太湖」并点结果 | 显示钓点、7 天卡片、地图高亮 |
| TC-SRCH-UI-A-001 | 搜不到 | P1 | 搜乱码 | “没找到，换个说法”；不白屏 |
| TC-SRCH-UI-A-002 | 搜索服务失败 | P0 | 拦截 Nominatim + geocoding | 显示“搜索暂时用不了”，不是“没找到” |
| TC-SRCH-UI-A-003 | 按钮冷却竞态 | P2 | 第一次搜索后 1 秒内再搜 | 新请求进行中按钮不被旧定时器启用 |
| TC-MAP-UI-N-001 | 地图点选 | P0 | 点水面 | 出预报；附近水体列表出现 |
| TC-MAP-UI-N-002 | 长河点选 | P0 | 搜「汉江」并点长河结果 | 提示点选河段；点了之后按最近河段算 |
| TC-MAP-UI-A-001 | 切换钓点清旧 nearby | P0 | 地图点选后点“最近”/地名结果 | 旧 nearby 列表/高亮/在途请求不残留 |
| TC-MAP-UI-A-002 | 并发打开地图 | P1 | CDN 慢时连点地图/水体结果 | 不出现 Leaflet “already initialized”；地图不被误隐藏 |
| TC-MAP-UI-N-003 | 底图切换 | P1 | 高德 ↔ OSM | 中心不跳；覆盖物不偏移；attribution 语言正确 |

### 4.3 评分卡片 / 详情 / 曲线

| 编号 | 用例 | 优先级 | 操作 | 预期 |
|---|---|---|---|---|
| TC-SCORE-UI-N-001 | 7 天卡片 | P0 | 选一个钓点 | 7 张卡；分数/等级/水温/首个时段；封顶有标记 |
| TC-SCORE-UI-N-002 | 当天详情 | P0 | 点某天 | 大分数、等级、等级说明、水温/气温/降水/日出日落/月出月落 |
| TC-SCORE-UI-N-003 | 八项分 | P0 | 看详情 | 8 行：名称、权重、分数、进度条、理由；顺序为水温/气压/温变/风/天空/时段/月相潮/水域 |
| TC-SCORE-UI-N-004 | 曲线 | P1 | 看 Canvas | 细灰=小时分；粗青=平滑分；绿块=最佳时段；红块=危险；橙虚线=日出日落 |
| TC-SCORE-UI-A-001 | 热季跨午夜时段 | P0 | 热季 01:00–03:00 窗口 | 绿色时段画在次日位置，不能漏画 |
| TC-SCORE-UI-A-002 | 危险红区 | P2 | 连续雷暴 | 合并成一段，不因叠加变深；图例透明度一致 |

### 4.4 双语 / 分享 / 移动端

| 编号 | 用例 | 优先级 | 操作 | 预期 |
|---|---|---|---|---|
| TC-I18N-UI-N-001 | 切换英文 | P0 | 选中钓点后点 EN | 保留 `?lat&lon&sp...`；英文页无中文残留 |
| TC-I18N-UI-N-002 | 英文地图 attribution | P1 | /en/ 打开地图 | 不出现“© 高德地图” |
| TC-I18N-UI-N-003 | 英文 PWA manifest | P2 | /en/ 添加到主屏 | 名称为英文，`lang=en` |
| TC-SHARE-UI-N-001 | 复制分享链接 | P1 | 点“复制分享链接” | 链接含当前 lat/lon/sp/w；App 内调起系统分享 |
| TC-HOME-UI-N-003 | 移动端布局 | P2 | 375px 宽 | 7 天卡片 3 列；无横向滚动；地图可用 |

## 五、每条用例必须记录

| 列 | 取值 |
|---|---|
| 执行方式 | 浏览器 / Node 引擎测试 / 外部 API 探针 / 代码审查 |
| 执行结果 | ✅ 通过（注明方式）/ ❌ 不通过（当场修到通过）/ ⚠️ 不可演示（注明原因） |

无法演示的用例，用代码审查 + 合成数据确认口径并写备注；禁止留空或编造结果。

## 六、测试数据

- 优先用 `tools/test-engine.mjs` 的合成 Open-Meteo 响应；不要提交真实个人位置或鱼获数据。
- 浏览器用例用已知水体：太湖、千岛湖、汉江、象山港。
- 外部接口测试注意频率：Nominatim ≤1 次/秒；Overpass 镜像失败再切换；不要压测公共接口。

## 七、本项目不适用（不要照搬）

- 登录 / Token / 角色权限
- 多租户 / 数据范围 / 软删除
- 分页 `page/limit`、CRUD、数据库断言
- 批量导入 / N+1 / 事务
- Java Controller / Vue 页面 / uni-app 页面
