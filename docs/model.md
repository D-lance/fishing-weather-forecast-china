# 鱼情模型 v0.4（网站与技能共用的唯一口径）

> 经验模型，未经鱼获数据校准。网站（JS）与技能（Python）必须按本文件实现同一套公式，
> 用 `fixtures/` 里同一份输入 JSON 跑出的分数误差 ≤ 1 分。改公式先改本文件。
> 纯实现细节（缺数据默认值、时刻换算等）见 `impl-notes.md`。

**v0.4 变更（2026-11-23）**：① 气压改用 `surface_pressure`，并按海拔平移绝对阈值（没有该字段时退回 `pressure_msl`，保持 v0.3 行为）；② 新增 Flood API 径流趋势，折进 `S_geo` 的 river/reservoir；③ 海钓潮汐分加入潮差、流速、浪周期；④ 新增低氧风险 flag（不新增权重，只封顶/提示）；⑤ 新增季节/产卵/洄游建议（只进 advice，不进分数）；⑥ 新增鳊鱼鱼种与台钓粉饵/虾建议（`style='taiwan'`）。兼容性：没有新数据时，除季节建议外行为与 v0.3 一致。

**v0.3 变更（2026-09-23）**：①日分改为 `0.6·最好 6 小时均值 + 0.4·全部参与小时均值`（v0.2 只取最好 6 小时，分数扎堆 80–95）；②新增日级危险封顶（雷暴 ≥3 小时或浪 ≥2.5 m ≥3 小时 → ≤45；雷暴 1–2 小时或任一小时阵风 7 级以上 → ≤60），修复「雷暴天还能极佳」；③§4 安全提示表按实际文案更新；④§8 示例窗口改为整点。等级档位不变。

**v0.2 变更（2026-09-23）**：新增 §3.9 水温闸门；地名改为 Nominatim 优先；Overpass 查询补 `landuse=aquaculture`；潮汐极值去毛刺；§2/§3/§6/§7 中原先含糊的口径写死（晨昏窗、午间边界、月亮事件跨日、窗口屏蔽范围、并列取法、取整方式、大风钓位句等）。

## 1. 数据源（全部免 key）

| 用途 | 接口 |
|---|---|
| 地名→坐标 | 先查 `https://nominatim.openstreetmap.org/search?q=<名>&format=jsonv2&accept-language=zh&countrycodes=cn&limit=8`（UA `fishcast/0.1 (WorkBuddy skill; +https://fish.satloot.com; admin@satloot.com)`，加参数 `email=admin@satloot.com`）；无结果或失败再查 `https://geocoding-api.open-meteo.com/v1/search?name=<名>&language=zh&count=8` |
| 坐标→地名 | `https://nominatim.openstreetmap.org/reverse?format=json&accept-language=zh&lat=&lon=&email=admin@satloot.com`（带同一个 UA，失败就不显示地名） |
| 天气 | `https://api.open-meteo.com/v1/forecast` 参数：`latitude,longitude,timezone=auto,past_days=7,forecast_days=8,wind_speed_unit=ms`，`hourly=temperature_2m,relative_humidity_2m,pressure_msl,surface_pressure,cloud_cover,precipitation,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m`，`daily=sunrise,sunset,temperature_2m_max,temperature_2m_min,precipitation_sum`；过去日期用 `https://historical-forecast-api.open-meteo.com/v1/forecast` 同参数，`past_days/forecast_days` 换成 `start_date/end_date`。`forecast_days=8` 是为了热季最后一天能拿到 `d+1 00:00–02:00`；网页端用 `localToday()` 从今天起只显示 7 天 |
| 海况（仅海钓/近海） | `https://marine-api.open-meteo.com/v1/marine` 参数：`latitude,longitude,timezone=auto,past_days=1,forecast_days=8,hourly=wave_height,wave_period,sea_surface_temperature,sea_level_height_msl,ocean_current_velocity,ocean_current_direction`；全是 null = 内陆，按淡水处理 |
| 河道径流 | `https://flood-api.open-meteo.com/v1/flood` 参数：`latitude,longitude,daily=river_discharge,past_days=7,forecast_days=8`；GloFAS 最近网格，湖泊/海边可能为 null。只用于 river/reservoir 的涨落趋势，不直接当水位 |
| 海拔 | forecast 返回的 `elevation` 字段即可 |
| 水域类型 | Overpass，镜像依次试 `overpass-api.de`、`overpass.kumi.systems`、`maps.mail.ru/osm/tools/overpass/api/interpreter`，单个超时 12s，单个镜像不重试（镜像轮换即重试），全失败→`unknown` 并让用户手选 |
| 日月 | 本地算，算法取 suncalc（mourner/suncalc）的 moon position / illumination / times；日出日落直接用 forecast 的 daily `sunrise/sunset` |

**地名候选**：Open-Meteo 地名库对中文基本不可用（实测「舟山」「厦门」「太湖」都给不出正确结果），所以 Nominatim 优先。Nominatim 结果里 `category` 为 railway/highway 的丢掉；同名（去掉末尾「县/市/区」后相同）且相距 < 20 km 的合并为一个。多于 1 个候选时列出来让用户选，默认用第 1 个。

Overpass 查询（半径 1500 m，海岸线 5 km）：
```
[out:json][timeout:15];
(
 nwr(around:1500,LAT,LON)["natural"="water"];
 nwr(around:1500,LAT,LON)["landuse"="reservoir"];
 nwr(around:1500,LAT,LON)["landuse"="aquaculture"];
 way(around:1500,LAT,LON)["waterway"~"^(river|stream|canal)$"];
 way(around:5000,LAT,LON)["natural"="coastline"];
);
out tags center 40;
```
判定优先级：coastline 且 marine 非空 → `sea`；`water=reservoir` 或 `landuse=reservoir` → `reservoir`；`water=lake` → `lake`；`water=pond|fishpond` 或 `landuse=aquaculture` → `pond`；`water=river|canal` 或 waterway → `river`；其余 natural=water → `lake`；什么都没有 → `unknown`。
Overpass 得到 `unknown`（例如地名点落在大湖正中，1500 m 内没有边线）而所选 Nominatim 候选本身是水体时，用其 `type` 映射：reservoir→`reservoir`，lake→`lake`，pond/fishpond→`pond`，river/canal/stream/riverbank→`river`，bay/coastline/strait/sea/beach→`sea`（仅 marine 非空时），来源仍记 `osm`。
用户手选永远覆盖自动判定。用户选了 `sea` 但 marine 全是 null：水域仍记 `sea`，水温退回淡水公式、不算潮，报告注明。

## 2. 派生量

- **本地时间**：一律用接口返回的 timezone 本地时刻。
- **日均气温** `Ta(d)`：当日 24 个 hourly temperature_2m 的均值。
- **估算水温** `W(d)`（淡水）：`W = Σ w_k·Ta(d−k)`，k=0..4，`w=[0.35,0.25,0.18,0.12,0.10]`；`W = max(0.5, W)`。过去数据不够 5 天时用已有天数、权重重新归一。
  - 海水：仅当 water=sea 时用当日 sea_surface_temperature 均值（不套 max(0.5)），缺失则退回淡水公式。
  - **结冰提示**：W ≤ 2 且前 5 天（`d−1 … d−5`，有几天算几天，至少 1 天）daily `temperature_2m_min` 全 < −5 → `ice=true`（提示冰钓，安全第一；除 §3.9 冰钓模式外不改分）。
- **季节档** 由 W 定：`cold` W<12；`mild` 12≤W≤26；`hot` W>26。
- 一个钓鱼日 d 里的所有小时（包括热季跨到次日 00–02 点的夜钓小时）都用 d 的 `W`、季节档、`dT`、`ice`。
- **目标鱼种** 见 §5；默认 `crucian`（鲫鱼）。

## 3. 小时分（0–100），八个分项加权

`H = g · Σ weight_i · S_i / 100`，权重：水温 25、气压 20、温变 15、风 10、天空 10、时段 10、月相/潮 5、水域 5（合计 100）；`g` 是 §3.9 的水温闸门。然后按 §4 硬封顶。
每个分项 clamp 到 [0,100]，每个分项都要产出一句中文理由（写进 `reasons`）。

### S_temp 水温（25）
鱼种区间 `(tmin, opt_lo, opt_hi, tmax)`：
- `opt_lo ≤ W ≤ opt_hi` → 100
- `tmin ≤ W < opt_lo` → `20 + 80·(W−tmin)/(opt_lo−tmin)`
- `opt_hi < W ≤ tmax` → `20 + 80·(tmax−W)/(tmax−opt_hi)`
- `W < tmin` → `max(0, 20 − 5·(tmin−W))`；`W > tmax` → `max(0, 20 − 5·(W−tmax))`

### S_pressure 气压（20）（v0.4 海拔修正见 §10.1）
`P = pressure_msl(t)`，`d3 = P(t)−P(t−3h)`，`d24 = P(t)−P(t−24h)`（hPa）。起点 100：
- `P < 1000` → −min(30, 3·(1000−P))；`P > 1030` → −min(20, 2·(P−1030))
- `d24 ≤ −6` → −25（急降，锋面过境）；`−6 < d24 ≤ −3` → −10
- `d24 ≥ 6` → −25（冷锋后高压，闭口）；`3 ≤ d24 < 6` → −10
- `|d24| < 3` → 理由写「气压平稳」，不加减
- `d3 ≤ −1.0 且 d24 > −6` → +5（降压前短时开口）
- 缺氧：`P < 1005 且 temperature_2m ≥ 30 且 wind_speed_10m < 2` → −20，理由「低压闷热，易缺氧浮头」

### S_trend 温变（15）
`dT = Ta(d) − Ta(d−1)`。起点 80：
- `dT ≤ −6` → −50；`−6 < dT ≤ −3` → −25
- `dT ≥ 3`：cold +20、mild +10、hot −20
- `|dT| < 3` → +10

### S_wind 风（10）
`v = wind_speed_10m`（m/s）：
- `v < 0.5` → cold 70 / mild 60 / hot 50（死水）
- `0.5 ≤ v < 3.4` → 100；`3.4 ≤ v < 5.5` → 85；`5.5 ≤ v < 8.0` → 60；`8.0 ≤ v < 10.8` → 30；`v ≥ 10.8` → 0
- 冷季北风：season=cold 且 风向 ∈ [315,360]∪[0,45] 且 v ≥ 3.4 → −15，理由「北风降温」

### S_sky 天空（10）
`c = cloud_cover`，`p = precipitation`（mm/h），`code = weather_code`。
先判：code 95–99（雷暴）→ 0。雪（code 71–77、85、86）→ 40。
否则按季节：

| | 晴 c<30 | 多云 30≤c<70 | 阴 c≥70 | 小雨 0.1≤p<2.5 | 中雨 2.5≤p<8 | 大雨 p≥8 |
|---|---|---|---|---|---|---|
| hot | 55 | 80 | 100 | 100 | 60 | 20 |
| mild | 80 | 100 | 90 | 85 | 55 | 20 |
| cold | 100 | 85 | 65 | 50 | 50 | 20 |

有降水（p ≥ 0.1）按雨的列，否则按云的列。

### S_time 时段（10）
`sr/ss` = 该小时所在日历日的 daily `sunrise/sunset`。按下列顺序取第一个命中的：
- 晨窗 `[sr−1h, sr+2h]`、昏窗 `[ss−2h, ss+1h]`（闭区间）→ 100
- 午间：当地钟点 `11:00 ≤ t < 15:00` → hot 30 / mild 70 / cold 100
- 夜间：`t > ss+1h` 或 `t < sr−1h` → hot 75 / mild 45 / cold 20
- 其余白天 → 70
- Solunar 加分：月上中天或下中天 `|t−中天| ≤ 1h`（major）+15；否则月出或月落 `|t−事件| ≤ 30min`（minor）+8；加完封顶 100。
  - 月亮事件取该小时所在日历日的**前一天、当天、后一天**三天的合集（跨午夜的事件也算）。
  - 每天的事件从当地 0 点起算 24 小时：月出月落用 suncalc `getMoonTimes` 算法（起点即当地 0 点）；中天是从当地 0 点起每 10 分钟采样月亮高度（共 144 点），取最大/最小值的**第一个**采样时刻为上/下中天。

### S_moon 月相/潮（5）（v0.4 潮差/流速/浪周期见 §10.3）
月龄 `a = phase·29.53`（suncalc illumination.phase，取该小时时刻），`d = min(a, |a−14.77|, 29.53−a)`：`d ≤ 2` → 100，`d ≤ 4` → 75，否则 55。
海钓（water=sea、该小时有 sea_level_height_msl、且找到了极值）：再算潮分 T 并取 `S_moon = 0.5·月相分 + 0.5·T`，否则只用月相分：
- 极值：在 marine 整个 hourly 序列上，`v[k−1] < v[k] ≥ v[k+1]` 为高潮，`v[k−1] > v[k] ≤ v[k+1]` 为低潮，时刻取整点、不插值。
- **去毛刺**：Open-Meteo 潮位常有 1–2 cm 抖动（如 0.04→0.05→0.03），会凭空多出一对高低潮。从头扫描极值表，相邻两个极值落差 < 0.10 m 就把这两个一起删掉，重新扫描直到没有。
- 距最近极值 ≤ 30 min（平潮）→ 60；否则取时刻 ≤ t 的最近一个极值，`30min < t−极值 ≤ 2.5h`（初涨/初落，水流起来）→ 100；其余 → 75。

### S_geo 水域（5）（v0.4 径流趋势见 §10.2）
`rain48 = 过去 48h precipitation 总和`（该小时及之前共 48 个小时值）：
- `river` 且 rain48 > 30 → 30（涨水浑浊，理由提示找回水湾）；`river` 其他 → 80
- `reservoir`：hot 80，其他 75
- `lake` → 75
- `pond`：hot 且 v < 2 → 50（小水体闷热缺氧），否则 80
- `sea`：wave_height ≥ 1.5 → 20，否则 80
- `unknown` → 70

### 3.9 水温闸门（乘在加权和上）
水温离谱时，其余七项再好也钓不到鱼，所以用水温分给整小时打折：
- `g = 0.5 + 0.5·S_temp/100`（S_temp=0 时减半，100 时不变）。
- 例外：`ice=true` 且鱼种是 `crucian`（鲫鱼）时，`g = max(g, 0.7)`（冰钓鲫鱼是正经玩法），水温理由末尾加「冰钓鲫鱼照样能钓，打折少一些」。
- `S_temp < 60` 时水温理由末尾加「水温太低/太高，鱼不爱动，整体打折」（W < opt_lo 说低，否则说高）。
- `H = g · Σ weight_i·S_i/100`，闸门在 §4 硬封顶**之前**。`sub.temp` 仍是原 S_temp，不受闸门影响。

## 4. 硬封顶与安全提示

按小时判（作用在过完闸门的 H 上，之后才做 §6 的平滑），命中则 `H = min(H, 上限)` 并加一条 `safety`：
| 条件 | 上限 | 提示 |
|---|---|---|
| weather_code 95–99 | 10 | 雷暴，远离水边、收起碳素竿 |
| wind_gusts_10m ≥ 13.9 或 v ≥ 10.8 | 20 | 阵风 7 级以上，别去开阔水面和堤坝 |
| sea 且 wave_height ≥ 2.5 | 15 | 浪高 2.5 米以上，别上礁石 |
| p ≥ 8 | 35 | 强降水，河道注意涨水 |
| v0.4：淡水 pond/lake + 热季 + 风<2 + P<pNorm−5 + 夜间 | 45 | 高温、低压、无风，浅水容易缺氧浮头；找活水、增氧机或深水 |
| v0.4：ice 且 pond/lake | 不封顶 | 冰下可能缺氧，注意鱼浮头；冰钓先测冰厚 |
| temperature_2m ≥ 35 | 不封顶 | 气温 35℃ 以上，防中暑，多带水、找树荫 |
| ice=true | 不封顶 | 可能结冰：冰钓安全第一，冰厚不到 10 厘米不上冰 |

`safety` 按类型汇总成一天一条：连续命中的小时合成一段「09:00–11:00」，不连续的用顿号分开「09:00、18:00」，后接提示；只统计 §6 的参与小时；结冰整天一条。

## 5. 鱼种表

| key | 名称 | tmin | opt_lo | opt_hi | tmax |
|---|---|---|---|---|---|
| crucian | 鲫鱼 | 5 | 15 | 25 | 30 |
| bream | 鳊鱼 | 8 | 18 | 28 | 32 |
| carp | 鲤鱼 | 10 | 18 | 28 | 32 |
| grass | 草鱼 | 15 | 20 | 30 | 33 |
| silver | 鲢鳙 | 16 | 22 | 30 | 34 |
| tilapia | 罗非 | 18 | 24 | 32 | 36 |
| culter | 翘嘴/鲌鱼 | 8 | 15 | 28 | 32 |
| bass | 鲈鱼（大口黑鲈） | 10 | 18 | 28 | 32 |
| snakehead | 黑鱼 | 12 | 20 | 30 | 34 |
| mandarin | 鳜鱼 | 10 | 18 | 28 | 30 |
| catfish | 黄颡鱼 | 10 | 18 | 28 | 32 |
| seabass | 海鲈 | 8 | 14 | 24 | 28 |
| seabream | 黑鲷 | 10 | 15 | 25 | 30 |

## 6. 日分与最佳时段

- 参与计算的小时：d 日本地 04:00–22:00（19 个整点）；season=hot 时再加 d 日 23:00 与 d+1 日 00:00、01:00、02:00（夜钓）。
  - 网页端请求 `forecast_days=8`，并用 `localToday()` 从今天起取 7 天；多出的第 8 天只用于给最后一天提供 d+1 00–02 小时，不会显示成第 8 张卡。
- 先对小时分做 3 小时居中滑动平均 `Hs`；只在这串参与小时内部做，两端用 2 个值平均。
- **日分** = `round(0.6·A6 + 0.4·Aall)`：`A6` = 当日 `Hs` 最高 6 个值的均值（不足 6 个就全部；「挑对时间去能有多好」），`Aall` = 全部参与小时 `Hs` 的均值（「这一天整体怎么样」）。
- **危险封顶**（在参与小时里数，数的是 §4 的小时级命中）：
  - 雷暴（weather_code 95–99）≥ 3 小时，或 sea 且浪高 ≥ 2.5 m ≥ 3 小时 → 日分 ≤ 45；
  - 否则雷暴 1–2 小时，或任一小时阵风 7 级以上（wind_gusts_10m ≥ 13.9 或 v ≥ 10.8）→ 日分 ≤ 60；
  - 封顶后再定等级；等级说明后加一句「今天有{雷暴/大风/大浪，按实际命中用「和」连接}，只建议在安全时段短钓，或者改天」。输出 `day_cap`（45/60/null）。
  - 最佳时段仍按小时 `Hs` 挑，不受日分封顶影响。
- **最佳时段**：在当日 `Hs` 上贪心取最高点 c（并列取最早），窗口 `[c−1h, c+1h]`；然后屏蔽 `|t−c| ≤ 2h` 的小时（窗口再各外扩 1h）后再取，最多 3 段，`Hs < 35` 就停。按挑选顺序（分数从高到低）输出，窗口分 = 取整后的 `Hs`。窗口可以伸出参与小时（如 03:00–05:00）。
- 等级：≥80 极佳；65–79 好；50–64 一般；35–49 偏差；<35 不建议。
- **取整**：一律「.5 进一」（同 JS `Math.round`，Python 不能用内置 round）。`score`、`sub`、窗口分取整；`h`、`hs`、`water_temp` 保留 1 位小数。

## 7. 建议（规则生成，不许凭空编）

建议用当日 W、季节，以及 `Hs` 最高那一小时（`best_hour`）的风速风向。
- **水层**：W<10 深水底层、午后向阳；10≤W<18 中下层、向阳浅滩、午后最好；18≤W≤26 早晚浅滩、中午深水；W>26 早晚与夜里浅水，白天深水/树荫/进水口。
- **钓位**：风向 `dir`（风从哪来）。v<0.5 不给钓位句。season=cold 且北风（[315,360]∪[0,45]）→「背风向阳：北岸」。否则 1–3 级风（0.5≤v<5.5）→ 迎风岸 = 下风岸，方位 = dir+180°（8 方位），写成「风从北来，钓南岸（下风岸），风把食物和氧气吹过去」；v≥5.5 →「风力 4 级以上，选背风、站位平稳的岸，安全第一」。
- **饵料味型**：W<12 腥香、小颗粒、蚯蚓红虫；12≤W≤22 腥香谷香都可；W>22 清淡、果酸、谷物。路亚鱼种（culter/bass/snakehead/mandarin/seabass）改为给饵型：W<12 慢沉/底部慢拖；12–22 米诺、软饵；>22 早晚水面系、白天深层。
- **水域**：reservoir 找回水湾、岬角、老河道；river 找回水湾、缓流、桥墩下游；lake 找草边、进出水口；pond 找增氧机、进水口、深水区；sea 按潮水说：列出当天（去毛刺后的）高低潮整点时刻，加一句「平潮前后半小时口差，涨落潮开始后 0.5–2.5 小时水流起来最好」，没有潮位数据就说「以当地潮汐表为准」；unknown 不给。
- 所有建议都是模板句，由上面条件拼出来。
- v0.4：按月份追加一条季节/产卵/洄游建议；海钓的月相/潮理由追加潮差、流速、浪周期（见 §10.3/§10.5）。
- `style='taiwan'` 时：鲫鱼/鳊鱼给台钓粉饵建议（腥香/谷香/清淡，可加虾粉/虾肉）；翘嘴/鳜鱼给虾肉/虾饵优先，粉饵辅助；不传 `style` 时仍按通用饵料/路亚建议。
- **文案规矩**：reasons / advice / safety / 报告正文是给钓友看的，不出现接口名、字段名、公式符号；气压写「百帕」，风速同时给级数；每个等级配一句人话解释（见 `scripts/model.py` 的 `LEVEL_TEXT`）。

## 8. 输出结构（两端一致）

```json
{
  "place": {"name": "", "lat": 0, "lon": 0, "elevation": 0, "water": "reservoir", "water_source": "osm|user|default"},
  "species": "crucian",
  "model_version": "0.3",
  "days": [
    {"date": "2026-09-23", "score": 72, "level": "好", "level_text": "值得去，留意扣分最多的那一项", "day_cap": null,
     "water_temp": 21.4, "season": "mild",
     "discharge_trend": "stable", "river_discharge": 12.3, "tide_range": null, "oxygen_risk": false,
     "windows": [{"start": "05:00", "end": "07:00", "score": 84}],
     "sub": {"temp": 100, "pressure": 90, "trend": 90, "wind": 100, "sky": 100, "time": 100, "moon": 55, "geo": 75},
     "reasons": ["..."], "advice": ["..."], "safety": ["..."],
     "hours": [{"t": "2026-09-23T05:00", "h": 81.2, "hs": 80.0}]}
  ]
}
```
`sub` 取当日 `Hs` 最高（并列取最早）那一小时的分项，`reasons` 同样取那一小时。地名有多个匹配时顶层另给 `candidates`。

## 9. 回归样例

`fixtures/` 放 2–3 份冻结的 Open-Meteo 原始响应（一份淡水、一份海边、一份冬天北方），配对 `*.expected.json`。两端各自有测试脚本读 fixture 算分并和 expected 比。**Python 端是基准**，expected 由 Python 生成，JS 端对齐。

本仓库的 `fixtures/` 默认只放说明（见 `fixtures/README.md`）；成对样例可以放本地或 CI。`tools/check-fixtures.mjs` 默认读仓库内 `fixtures/`，没有成对样例时退出码 2。不依赖 Python 的合成回归用 `node tools/test-engine.mjs`。

---

## 10. v0.4 扩展（2026-11-23）

> 以下覆盖 §3 的默认行为。没有新数据时，除季节建议外保持 v0.3 行为；季节建议总是追加一条 advice，不影响分数。

### 10.1 海拔 / 站点气压

- 若 forecast 的 `hourly.surface_pressure` 有非空值：`P = surface_pressure`；否则 `P = pressure_msl`，并保持 v0.3 阈值。
- `pNorm = 1013.25 · (1 − 2.25577e−5 · h)^5.25588`，`h = elevation`（米）。
- 有 `surface_pressure` 时：`shift = max(0, 1013.25 − pNorm)`；`low = 1000 − shift`、`high = 1030 − shift`、`hypoxia = 1005 − shift`。
- `d3` / `d24` 的 3/6 hPa 阈值不变（天气变化量不随海拔平移）。
- 效果：海平面不变；2000 m 时 `pNorm ≈ 795`、`low ≈ 782`、`high ≈ 812`，正常站点气压 795 不再被当成“低压”。
- 理由文案仍写实际 `P`（例如 795 百帕），便于高海拔用户理解。

### 10.2 河道径流趋势（Flood API）

- `q(d)` = `flood.daily.river_discharge` 中日期 d 的值；`pct = (q(d) − q(d−1)) / max(|q(d−1)|, 0.1)`。
- `pct > 0.15` → `rising`；`pct < −0.15` → `falling`；否则 `stable`；缺数据 → `unknown`。
- 只作用于 `water = river | reservoir`：
  - river：基础 30（`rain48 > 30`，涨水浑浊）或 80；非涨水时 `rising +5`、`falling −10`；clamp 0–100。
  - reservoir：基础 80（hot）/ 75；`rising +3`、`falling −5`；clamp 0–100。
- 理由追加：河道「流量在涨/在退」、水库「入库流量在涨/水位在退」。
- 只看趋势，不把 GloFAS 绝对值当实际水位；最近网格可能不代表目标河道。

### 10.3 潮差 / 流速 / 浪周期（Marine API）

- 基础潮分 `T0` 仍按 §3 的平潮 60 / 初涨初落 100 / 中段 75。
- 日潮差 `range` = 当天 `sea_level_height_msl` 的 max − min；小时流速 `current` = `ocean_current_velocity`（km/h）；浪周期 `period` = `wave_period`（秒）。
- 分量分：
  - `range`：≥2 m 100；1–2 m 80；0.5–1 m 60；<0.5 m 40。
  - `current`：<0.2 km/h 60；0.2–2 km/h 100；2–4 km/h 70；>4 km/h 40。
  - `period`：<3 s 60；3–8 s 80；8–12 s 100；>12 s 70。
- 加权：基础 `T0` 权重 0.4；每个可用的 range/current/period 权重 0.2；按权重和归一化。都没有时 `T = T0`（v0.3）。
- `S_moon = 0.5·月相 + 0.5·T`；只在找到潮汐极值时计算。
- 理由追加「潮差约 X 米，流速约 Y 公里/小时，浪周期约 Z 秒」；缺项不写。海流在开阔洋面可能为 null，按缺项处理。

### 10.4 低氧风险 flag（不新增权重）

- 只在淡水小水体触发：`water = pond | lake`，未结冰，`season = hot`，`wind < 2 m/s`，`P < pNorm − 5`，且当地时刻 `< 08:00` 或 `≥ 20:00`。
- 命中：小时分 `H = min(H, 45)`，`flags` 加 `oxygen`，安全提示加「高温、低压、无风，浅水容易缺氧浮头…」。
- `ice = true` 且 pond/lake：加 `oxygenIce` 提示，不封顶。
- 这是安全封顶/提示，不是第 9 个加权分项；§3 里 `P < hypoxia & 高温 & 无风` 的 −20 仍保留。
- 没有溶氧/叶绿素实测数据，这是风险代理，不输出 mg/L。
- 若调用方传入 `oxygen = { value, unit:'mg/L', count, time, source }`（城市平均实测），则**只对第一个显示日**覆盖代理：
  - `value < 3` → 该日小时封顶 45 + `oxygen` 提示；
  - `3 ≤ value < 5` → `oxygenWarn` 提示，不封顶；
  - `value ≥ 5` → 不触发。
  - 其他天仍用天气代理；城市平均不代表具体钓点。

### 10.5 季节 / 产卵 / 洄游建议（只进 advice）

- 按日期月份追加一条：
  - 3–5 月：春季繁殖期，鲫鱼/鲤鱼靠浅滩草边，少打扰，早晚更好。
  - 6–8 月：夏季高温，早晚/夜间为主，白天深水/树荫/进水口；黑鱼护崽期提示别下竿。
  - 9–11 月：秋季育肥，鱼口好，找浅滩、结构、回水湾，降温前抓紧。
  - 12–2 月：冬季鱼扎深水，钓深、向阳、背风；冰钓先测冰厚。
- 不改任何分数；规则是通用经验，需本地验证。

### 10.6 输出与兼容

- 新增日字段：`discharge_trend`（rising/falling/stable/unknown）、`river_discharge`、`tide_range`、`oxygen_risk`、`oxygen_warn`。
- 顶层 `oxygen`：若传入实测值，回显 `{value,count,time,source,applied_date}`；只作用于 `applied_date`。
- 小时 `flags` 新增 `oxygen` / `oxygenWarn` / `oxygenIce`；安全提示按 §4 的聚合规则输出。
- `model_version = 0.4`。
- Python 基准需实现同一套公式和文案；fixtures 需要包含 `surface_pressure`、Flood API、marine 新字段中的至少一部分，否则退回 v0.3 行为。
- 没有新数据时：气压、水域、潮汐分与 v0.3 一致；季节建议仍会追加。
