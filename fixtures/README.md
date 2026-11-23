# fixtures

`tools/check-fixtures.mjs` 默认读这个目录，用来做 JS ↔ Python 基准对分。

## 文件对

每个样例是一对：

```
<名>.json            # { input, forecast, marine }
<名>.expected.json   # Python 基准脚本生成
```

- `forecast`：Open-Meteo `/v1/forecast` 原始响应（`past_days=7&forecast_days=8`，共 15 天）
- `marine`：Open-Meteo `/v1/marine` 原始响应，可为 `null`
- `input`：`{ species, water, name, now }`，可选；`now` 缺省时 `check-fixtures.mjs` 用 `expected.days[0].date` 作为锚点
- v0.4 可选：`forecast.hourly.surface_pressure`、`marine.hourly.wave_period/ocean_current_velocity/ocean_current_direction`、`flood = { daily: { time, river_discharge } }`。缺这些字段时引擎保持 v0.3 行为。
- `flood` 是新的顶层字段；Python 基准同步前，带 flood/marine 新字段的 expected 需要 Python 端先实现 v0.4。
- 日期格式：`YYYY-MM-DDTHH:00`
- `expected` 由 Python 端生成；JS 端只负责对齐（分差 ≤ 1，水温差 ≤ 0.15℃）

## 运行

```bash
node tools/check-fixtures.mjs
node tools/check-fixtures.mjs ./some-other-fixtures -v
```

没有成对样例时脚本退出码为 2，这是预期行为；不依赖 Python 的合成回归用：

```bash
node tools/test-engine.mjs
```

## 可选：鱼种表

`tools/build.mjs` 如果发现 `fixtures/species.json`（或 `FISH_SPECIES_JSON` 指向的文件），会用它替换 `engine.js` 内置鱼种表。格式宽松接受：

```json
[
  { "key": "crucian", "name": "鲫鱼", "tmin": 5, "opt_lo": 15, "opt_hi": 25, "tmax": 30 }
]
```

也接受 `{ "species": [...] }` 或 `{ "key": { ... } }`，以及 `range: [tmin, opt_lo, opt_hi, tmax]`。

## 数据安全

只放冻结的天气响应或脱敏/合成数据；不要放真实个人位置、鱼获记录、账号、密钥或签名文件。
