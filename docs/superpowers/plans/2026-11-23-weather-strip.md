# 日期天气带（鹰潭）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在顶部设置卡右侧加一条“鹰潭天气”，点不同日期时显示该日天气现象、高低温、风、降水概率和湿度。

**Architecture:** 新增纯函数 `web/weather.js` 从现有 `S.fc` 汇总某日白天天气；`app.js` 只负责把汇总结果渲染到 `#pick` 里的 `#d-weather`。不新增接口、不改评分，日期切换沿用 `renderDetail`。

**Tech Stack:** 原生 ES modules、现有 Open-Meteo forecast、Node 18+ 测试脚本；无 npm 依赖。

**Spec:** `docs/superpowers/specs/2026-11-23-weather-strip-design.md`

## Global Constraints

- 位置固定在顶部设置卡 `#pick` 的 `.opts` 右侧；不放日期详情/7 天卡片。
- 只使用现有 `S.fc` 的 `hourly`/`daily`；不新增 fetch、不改 Open-Meteo 参数。
- 不改 v0.5/v0.6 评分、鱼种、排行逻辑。
- 白天窗口：`06:00 ≤ h < 18:00`；没有白天小时退回当天全部可用小时。
- 天气现象取白天最高严重度；缺单项显示 `—`，整日无数据隐藏天气带。
- 动态文案放 `TXT`；不要在 `app.js` 硬编码中文。
- 375px 不横向滚动；中文验收为主。英文页不在本次验收范围（用户不用），但保留最小动态键，构建仍必须通过。
- 不新增 npm 依赖、不新增后端。
- 未经用户明确同意，不 `git commit` / `git push`；每个任务只跑测试并报告。
- 完成标准：`node tools/test-weather.mjs`、`node tools/test-engine.mjs`、`node tools/test-rank.mjs`、`node tools/test-coord.mjs`、`node tools/build.mjs` 全绿；英文页无中文残留、无未用词典键。

## Review Focus

- 白天有雨/雷但早晨晴时，天气现象是否显示雨/雷，而不是晴。
- 最高/最低温、最大风/风向/风级、最大降水概率、平均湿度是否来自正确的小时。
- 降水概率或湿度为 null 时是否显示 `—`，而不是整条消失。
- 没有 06–18 点小时时是否退回当天全部小时，而不是 `null`。
- 切换日期是否只更新天气带、不新增网络请求、不改主钓/排行。
- 375px 天气带是否换行且不横向滚动；中文验收为主，英文页只保证构建通过。
- `#d-meta` 是否不再重复气温，只保留水温/降水量/日出日落/月相。

---

### Task 1: 日天气汇总纯函数

**Files:**
- Create: `web/weather.js`
- Create: `tools/test-weather.mjs`

**Interfaces:**
- Consumes: `fc` = `S.fc`（Open-Meteo forecast 原始响应，含 `hourly`/`daily`）；`date` = `YYYY-MM-DD`。
- Produces: `summarizeDay(fc, date) -> { code, kind, tempMax, tempMin, windSpeed, windDir, windLevel, rainProb, humidity } | null`
  - `kind`：`clear|mainlyClear|partlyCloudy|overcast|fog|drizzle|rain|heavyRain|snow|thunder|unknown`
  - `windDir`：0–7，对应北/东北/东/东南/南/西南/西/西北
  - `windLevel`：0–12 蒲福风级
  - `rainProb`/`humidity`：百分比数值；缺数据为 `null`

- [ ] **Step 1: Write the failing test**

Create `tools/test-weather.mjs`：

```js
import assert from 'node:assert/strict';
import { summarizeDay } from '../web/weather.js';

const date = '2026-11-23';
const time = Array.from({ length: 13 }, (_, i) => `${date}T${String(6 + i).padStart(2, '0')}:00`);
const fc = {
  daily: { time: [date], temperature_2m_max: [18], temperature_2m_min: [12] },
  hourly: {
    time,
    weather_code: time.map((_, i) => (i === 9 ? 95 : 0)),          // 15:00 雷雨
    temperature_2m: time.map((_, i) => 12 + (i / 12) * 6),
    wind_speed_10m: time.map((_, i) => (i === 8 ? 7 : 2)),         // 14:00 最大风
    wind_direction_10m: time.map((_, i) => (i === 8 ? 90 : 0)),    // 东风
    precipitation_probability: time.map((_, i) => (i === 10 ? 40 : 10)),
    relative_humidity_2m: time.map(() => 70),
  },
};
const w = summarizeDay(fc, date);
assert.equal(w.kind, 'thunder');
assert.equal(w.tempMax, 18);
assert.equal(w.tempMin, 12);
assert.equal(w.windSpeed, 7);
assert.equal(w.windDir, 2);
assert.equal(w.windLevel, 4);
assert.equal(w.rainProb, 40);
assert.equal(w.humidity, 70);

// 没有白天小时时退回当天全部小时
const night = {
  daily: { time: [date], temperature_2m_max: [16], temperature_2m_min: [10] },
  hourly: {
    time: [`${date}T20:00`], weather_code: [0], temperature_2m: [14],
    wind_speed_10m: [3], wind_direction_10m: [180], precipitation_probability: [0], relative_humidity_2m: [80],
  },
};
assert.equal(summarizeDay(night, date).kind, 'clear');

// daily 缺失时用小时温度兜底
const noDaily = { hourly: { time: [`${date}T12:00`], temperature_2m: [14] } };
const n = summarizeDay(noDaily, date);
assert.equal(n.tempMax, 14);
assert.equal(n.tempMin, 14);

// 缺字段返回 null，不是整条消失
const missing = { hourly: { time: [`${date}T12:00`] } };
const m = summarizeDay(missing, date);
assert.equal(m.kind, 'unknown');
assert.equal(m.tempMax, null);
assert.equal(m.rainProb, null);
assert.equal(m.humidity, null);
assert.equal(summarizeDay(fc, '2026-11-24'), null);

console.log('test-weather: 通过');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tools/test-weather.mjs`
Expected: FAIL，`ERR_MODULE_NOT_FOUND`，因为 `web/weather.js` 还不存在。

- [ ] **Step 3: Implement `web/weather.js`**

实现 `summarizeDay(fc, date)`：
- 取 `fc.hourly.time` 中以 `date` 开头的索引；优先 `06–17` 点，空则用全部索引。
- 天气代码按严重度映射（thunder > heavyRain > rain > snow > drizzle > fog > overcast > partlyCloudy > mainlyClear > clear > unknown），取最高；无代码为 `unknown`。
- 温度优先 `fc.daily.temperature_2m_max/min`，缺失时用选中小时的最大/最小 `temperature_2m`。
- 风：选中小时 `wind_speed_10m` 最大值，取该索引的风向；`windDir = Math.round(deg / 45) % 8`；m/s 转蒲福风级（<0.3=0, <1.6=1, <3.4=2, <5.5=3, <8=4, <10.8=5, <13.9=6, <17.2=7, <20.8=8, <24.5=9, <28.5=10, <32.7=11，否则 12）。
- 降水概率取选中小时非空最大值；湿度取非空平均并 `Math.round`；缺为 `null`。
- 无该日期任何 hourly/daily 数据返回 `null`；有 hourly 但 daily 缺失仍返回对象。
- 不碰 DOM，不 import 浏览器 API。

- [ ] **Step 4: Run test to verify it passes**

Run: `node tools/test-weather.mjs`
Expected: `test-weather: 通过`

- [ ] **Step 5: Do not commit; report**

---

### Task 2: 顶部设置卡天气带

**Files:**
- Modify: `web/index.html`
- Modify: `web/app.js`
- Modify: `tools/test-engine.mjs`（app 源断言）

**Interfaces:**
- Consumes: `summarizeDay` from `web/weather.js`；`entry.date`、`S.fc`。
- Produces:
  - DOM `#d-weather`（`#pick` 的 `.opts` 第二列，静态 label“天气”）。
  - `renderWeather(entry)`，在 `renderDetail` 中调用。
  - `TXT.weather`/`TXT.dirs`/`TXT.wxPlace`/`TXT.tempRange`/`TXT.wind`/`TXT.rainProb`/`TXT.humidity`（中英）。
  - `TXT.meta` 去掉气温，保留水温/降水量/日出日落/月相。

- [ ] **Step 1: Add the app source assertion first**

在 `tools/test-engine.mjs` 的 app 测试里加：

```js
assert(/summarizeDay/.test(app) && /\$\('d-weather'\)/.test(app), '缺少日期天气带');
assert(/renderWeather/.test(app), '缺少天气渲染');
assert(/TXT\.wxPlace/.test(app), '缺少天气地点文案');
```

Run: `node tools/test-engine.mjs`
Expected: FAIL，当前 app 没有天气带。

- [ ] **Step 2: Update HTML/CSS**

`web/index.html`：
- 在 `#pick` 的 `.opts` 里加第二个 `div`：`<label>天气</label><div class="wx-strip" id="d-weather" hidden></div>`；从 `#detail` 移除天气带。
- `.opts` 改成两列 `minmax(220px, 360px) minmax(0, 1fr)`；`@media (max-width:520px)` 仍是一列。
- 增加 `.wx-strip`（`margin-top:0; border:1px solid var(--line); background:var(--line-soft); border-radius:10px; padding:8px 10px`）、`.wx-main`（flex wrap，baseline）、`.wx-place`（13px muted 600）、`.wx-icon`（18px）、`.wx-kind`（15px 600）、`.wx-temp`（16px 700，`margin-left:auto`）、`.wx-sub`（flex wrap，`margin-top:4px`，13px，颜色 `--body`）。
- `@media (max-width:520px)`：`.wx-temp { margin-left:0; width:100%; }`，保证换行不横向滚动。
- `i18n/en.json` 加静态键 `"天气": "Weather"`（label 用）。

- [ ] **Step 3: Add TXT strings**

在 `app.js` 的 `TXT.zh` / `TXT.en` 添加：
- `wxPlace`: `鹰潭` / `Yingtan`
- `weather`: `{ clear:'晴', mainlyClear:'晴间多云', partlyCloudy:'多云', overcast:'阴', fog:'雾', drizzle:'毛毛雨', rain:'雨', heavyRain:'大雨', snow:'雪', thunder:'雷雨', unknown:'—' }`
- `dirs`: `['北','东北','东','东南','南','西南','西','西北']` / `['N','NE','E','SE','S','SW','W','NW']`
- `tempRange(lo, hi)`: `${lo}–${hi}℃` / `${lo}–${hi}°C`
- `wind(dir, level)`: `${dir}风 ${level}级` / `${dir} wind, force ${level}`
- `rainProb(p)`: `降水 ${p}%` / `${p}% rain`
- `humidity(h)`: `湿度 ${h}%` / `${h}% humidity`

把 `TXT.meta` 的 `气温 ${fmt(d.air_min)}–${fmt(d.air_max)}℃ · ` 从 zh/en 两处删除，保留水温、降水量、日出日落、月相。

- [ ] **Step 4: Render the strip**

在 `app.js`：
- `import { summarizeDay } from './weather.js';`
- 加 `WX_ICONS`：`clear:'☀️', mainlyClear:'🌤️', partlyCloudy:'⛅', overcast:'☁️', fog:'🌫️', drizzle:'🌦️', rain:'🌧️', heavyRain:'🌧️', snow:'❄️', thunder:'⛈️', unknown:'•'`。
- `renderWeather(entry)`：
  - `w = summarizeDay(S.fc, entry.date)`；`el.hidden = !w`；无数据清空返回。
  - 主行：`TXT.wxPlace` + `dateLabel(entry.date, S.sel)`（今天/明天/周X + 日期）、图标、`TXT.weather[w.kind]`、温度（`w.tempMin == null || w.tempMax == null ? '—' : TXT.tempRange(fmt(w.tempMin), fmt(w.tempMax))`）。
  - 副行：风（`w.windDir == null || w.windLevel == null ? '—' : TXT.wind(TXT.dirs[w.windDir], w.windLevel)`）、降水概率（`w.rainProb == null ? '—' : TXT.rainProb(Math.round(w.rainProb))`）、湿度（`w.humidity == null ? '—' : TXT.humidity(Math.round(w.humidity))`），用 `TXT.sep` 连接。
  - 全部经 `esc`；温度/概率/湿度整数化。
- `renderDetail` 在 `renderBest(entry)` 前调用 `renderWeather(entry)`。
- 切换日期只走 `renderDetail`，不新增 fetch。

- [ ] **Step 5: Run tests/build**

Run:
```bash
node tools/test-weather.mjs
node tools/test-engine.mjs
node tools/test-rank.mjs
node tools/build.mjs
```
Expected: 全绿；英文页无中文残留、无未用词典键。

- [ ] **Step 6: Browser verification**

`node serve-dev.mjs` 打开 `http://127.0.0.1:8791/`：
- 顶部设置卡右侧出现“天气”，有“鹰潭 · 今天/明天/周X”、天气现象、高低温、风、降水概率、湿度。
- 点不同日期，顶部天气带跟着变；Network 不新增请求。
- `#pick` 右侧不再空；`#d-meta` 不再重复气温。
- 375px 一行一列、天气带换行且不横向滚动；英文页不在本次验收范围（用户不用），构建仍通过。
- Console 无 error/warning；`#d-weather` 无数据时隐藏。

- [ ] **Step 7: Do not commit; report**

---

### Task 3: 文档与最终验证

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/impl-notes.md`
- Modify: `.claude/rules/API_WebPage_TestCase.md`
- Modify: `web/llms.txt`（如提到天气）

**Interfaces:**
- Consumes: Task 1–2 的 `summarizeDay`、`#d-weather`、测试命令。
- Produces: 文档与命令一致；无“天气带不存在”的旧描述。

- [ ] **Step 1: Update README/CLAUDE**

- README 功能加“日期天气带：鹰潭天气现象/高低温/风/降水概率/湿度；切日期联动”。
- 目录加 `web/weather.js`；构建命令加 `node tools/test-weather.mjs`。
- CLAUDE 架构表加 `web/weather.js`；测试命令/验证要求加 test-weather。

- [ ] **Step 2: Update impl-notes**

加“日期天气带”：
- `summarizeDay` 从 `S.fc` 取白天 06–18；天气现象按最高严重度；风取最大风速；降水概率取最大；湿度取平均。
- 缺字段显示 `—`；整日无数据隐藏；不改评分、不新增请求。
- `#d-weather` 在 `#pick` 的 `.opts` 第二列；`TXT.meta` 不再重复气温。

- [ ] **Step 3: Update acceptance cases**

在 `.claude/rules/API_WebPage_TestCase.md` 4.3 加：
- `TC-WX-UI-N-001` 日期天气带：切日期更新天气现象/高低温/风/降水概率/湿度，不发新请求。
- `TC-WX-UI-A-001` 缺降水概率/湿度：显示 `—`，不隐藏整条。
- `TC-WX-UI-A-002` 无白天小时：退回当天全部小时。
- 英文不加验收用例；用户不用英文，只保留构建通过。

- [ ] **Step 4: Final verification**

Run:
```bash
node tools/test-weather.mjs
node tools/test-engine.mjs
node tools/test-rank.mjs
node tools/test-coord.mjs
node tools/build.mjs
```
Expected: 全部通过；构建输出英文页无中文残留、无未用词典键。
Browser: repeat Task 2 Step 6 checklist.

- [ ] **Step 5: Do not commit; report and wait**

按用户规则不 commit/push；给出 diff、测试/构建、浏览器结果。
