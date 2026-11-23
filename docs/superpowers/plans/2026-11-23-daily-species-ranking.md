# 每日多鱼种主钓建议（固定全选）Implementation Plan

> **2026-11-23 后续变更：** 用户去掉了草鱼、鲤鱼；实际 `TARGET_SPECIES` 为 `['crucian','bream','culter','mandarin']`（4 种）。下文写“6 种/六种”的地方是当时计划，已过时；行为以设计文档和当前代码为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 6 种目标鱼固定全选，按日期给出“主钓 + 备选排行”，点排行可切换查看细节；不再做鱼种勾选。

**Architecture:** 每个鱼种仍调用一次现有 `computeForecast`（v0.5 主分 + v0.6 影子）。新增纯函数 `web/rank.js` 把 6 份输出按日期合并成 `top` 和 `ranking`；`app.js` 只负责状态和渲染。7 天卡片用当天 `top`，详情用 `top` 做主钓、用 `S.focus` 决定下方八项分/曲线/影子。

**Tech Stack:** 原生 ES modules、Canvas、Node 18+ 测试脚本；无 npm 依赖、无后端。

**Spec:** `docs/superpowers/specs/2026-11-23-daily-species-ranking-design.md`

## Global Constraints

- 只开放 6 种：`crucian`、`bream`、`carp`、`grass`、`culter`、`mandarin`；始终全部参与排序，页面不再有鱼种勾选。
- 不恢复地图/搜索/GPS；不引入 Leaflet/CDN。
- 不改评分公式；线上仍是 v0.5。v0.6 影子只跟随当前查看鱼种，不参与主分。
- 安全封顶、低氧提示、水域上下文权重不得移除或降级。
- `sp` 不再写入 URL；旧 `sp=` 链接忽略，统一按 6 种排序。
- 动态文案放 `app.js` 的 `TXT`；静态文案放 `index.html` 并由 `i18n/en.json` 翻译。不要硬编码中文到 `app.js`。
- 不新增 npm 依赖；所有请求仍从浏览器发出。
- 未经用户明确同意，不 `git commit` / `git push`；每个任务结束只跑测试并报告 diff。
- 完成标准：`node tools/test-rank.mjs`、`node tools/test-engine.mjs`、`node tools/test-coord.mjs`、`node tools/build.mjs` 全绿；英文页无中文残留、无未用词典键。

## Review Focus

- 6 份输出都有时，主钓/排行是否稳定；某鱼种缺某天时是否只跳过该鱼种。
- 同分排序是否按 `TARGET_SPECIES` 顺序；前二差 ≤3 是否出现“差距很小”。
- 点日期是否重置 `S.focus` 为该日 top；点排行是否只换查看对象、不换主钓。
- 全量安全提示是否按“日期 + line”去重，不因 6 个鱼种重复 6 遍。
- 某天没有最佳时段、或当天有封顶时，主钓卡/排行是否仍显示“没有好时段”和封顶标记。
- 375px 宽度下 7 天卡片 3 列、排行不横向滚动；无 Leaflet 请求。
- 旧 `sp=` 链接是否不报错；URL 是否不再出现 `sp`；英文页是否无中文残留。
- 这些点必须在对应任务的测试或浏览器步骤里出现，不能只写在文档里。

---

### Task 1: 纯函数排行模块

**Files:**
- Create: `web/rank.js`
- Create: `tools/test-rank.mjs`

**Interfaces:**
- Consumes: `computeForecast` 的输出形状，`outputs: Array<{ key: string, name: string, out: { days: Day[] } }>`；`Day` 至少含 `date/score/level/level_index/windows/day_cap/alerts`。
- Produces:
  - `rankDay(outputs, date) -> RankItem[]`，`RankItem = { key, name, day, score, level, level_index, windows, day_cap }`，按 `score` 降序，同分按 `outputs` 顺序；缺该日的鱼种跳过。
  - `bestByDate(outputs, dates) -> Array<{ date, top: RankItem|null, ranking: RankItem[] }>`。
  - `mergeAlerts(outputs) -> Array<{ date, key, line }>`，按 `date` 升序；同一天同一条 `line` 只保留一次（不同鱼种不重复）。

- [ ] **Step 1: Write the failing test**

Create `tools/test-rank.mjs`：

```js
import assert from 'node:assert/strict';
import { rankDay, bestByDate, mergeAlerts } from '../web/rank.js';

const day = (date, score, extra = {}) => ({
  date,
  score,
  level: score >= 80 ? '极佳' : '好',
  level_index: score >= 80 ? 0 : 1,
  windows: extra.windows || [{ start: '05:00', end: '07:00', score }],
  alerts: extra.alerts || [],
  day_cap: extra.day_cap ?? null,
});
const output = (key, name, days) => ({ key, name, out: { days } });

const a = output('a', 'A', [day('2026-11-23', 70)]);
const b = output('b', 'B', [day('2026-11-23', 80)]);
const c = output('c', 'C', [day('2026-11-23', 80)]);
const d = output('d', 'D', [day('2026-11-24', 90)]);

// 分数降序；同分按输入顺序（b 在 c 前）
assert.deepEqual(rankDay([a, b, c], '2026-11-23').map((x) => x.key), ['b', 'c', 'a']);
assert.equal(rankDay([a, b, c], '2026-11-23')[0].score, 80);

// 缺某天的鱼种跳过；单鱼种也能排
assert.deepEqual(rankDay([a, d], '2026-11-23').map((x) => x.key), ['a']);
assert.deepEqual(rankDay([a], '2026-11-23').map((x) => x.key), ['a']);

// 每天 top + ranking；没有数据的日期 top 为 null
const merged = bestByDate([a, b], ['2026-11-23', '2026-11-24']);
assert.equal(merged[0].top.key, 'b');
assert.deepEqual(merged[0].ranking.map((x) => x.key), ['b', 'a']);
assert.equal(merged[1].top, null);
assert.deepEqual(merged[1].ranking, []);

// 同一天同一条安全提示只保留一次；不同日期保留
const x = output('x', 'X', [day('2026-11-23', 70, { alerts: [{ key: 'thunder', line: '09:00 雷暴' }] })]);
const y = output('y', 'Y', [day('2026-11-23', 80, { alerts: [{ key: 'thunder', line: '09:00 雷暴' }] })]);
const z = output('z', 'Z', [day('2026-11-23', 80, { alerts: [{ key: 'gale', line: '10:00 大风' }] })]);
const w = output('w', 'W', [day('2026-11-24', 60, { alerts: [{ key: 'rain', line: '08:00 强降水' }] })]);
assert.deepEqual(mergeAlerts([w, x, y, z]).map((a) => `${a.date}|${a.line}`), [
  '2026-11-23|09:00 雷暴',
  '2026-11-23|10:00 大风',
  '2026-11-24|08:00 强降水',
]);

console.log('test-rank: 通过');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tools/test-rank.mjs`
Expected: FAIL，`ERR_MODULE_NOT_FOUND`，因为 `web/rank.js` 还不存在。

- [ ] **Step 3: Implement `web/rank.js`**

实现三个具名导出。`rankDay` 先建立 `key -> 输入下标` 的 Map，按 `score` 降序、同分按该下标升序；`bestByDate` 对每个日期调用一次 `rankDay`；`mergeAlerts` 用 `Set` 以 `${date}|${line}` 去重，最后按 `date` 升序。不要碰 DOM，不要 `import` 浏览器 API。

- [ ] **Step 4: Run test to verify it passes**

Run: `node tools/test-rank.mjs`
Expected: `test-rank: 通过`

- [ ] **Step 5: Do not commit; report the two new files**

按用户规则不 commit/push。报告测试输出，等下一任务。

---

### Task 2: 台钓虾饵建议覆盖所有路亚鱼种

**Files:**
- Modify: `web/engine.js:979`
- Modify: `tools/test-engine.mjs`（“鳊鱼鱼种和台钓粉饵/虾建议”附近）
- Modify: `docs/model.md:196`

**Interfaces:**
- Consumes: `computeForecast({ style: 'taiwan', species })`；`SPECIES.find(...).lure` 已经存在。
- Produces: `style='taiwan'` 时，`sp.lure === true` 的鱼种使用 `taiwanPredator` 建议；其余使用 `taiwanBait`。分数完全不变。

- [ ] **Step 1: Add the failing test**

在 `tools/test-engine.mjs` 的台钓测试里加一条 `bass`（引擎支持、UI 不开放）断言：

```js
const bass = engine.computeForecast({ forecast: makeWeather({ base: 22 }), species: 'bass', water: 'river', now: '2026-11-23', days: 7, style: 'taiwan' });
assert(bass.days[0].advice.some((a) => a.includes('虾')), bass.days[0].advice.join(' | '));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tools/test-engine.mjs`
Expected: FAIL，bass 的 advice 里没有“虾”。

- [ ] **Step 3: Change the condition**

把 `web/engine.js:979` 的

```js
if (o.style === 'taiwan') advice.push((sp.key === 'culter' || sp.key === 'mandarin') ? L.taiwanPredator[band] : L.taiwanBait[band]);
```

改成：

```js
if (o.style === 'taiwan') advice.push(sp.lure ? L.taiwanPredator[band] : L.taiwanBait[band]);
```

同步 `docs/model.md:196`：把“翘嘴/鳜鱼给虾肉/虾饵优先”改成“路亚鱼种（culter/bass/snakehead/mandarin/seabass）给虾肉/虾饵优先，粉饵辅助；非路亚鱼种给台钓粉饵”。

- [ ] **Step 4: Run test to verify it passes**

Run: `node tools/test-engine.mjs`
Expected: 全部通过（原有 bream/culter 断言仍通过）。

- [ ] **Step 5: Do not commit; report**

---

### Task 3: 页面改为固定 6 种 + 每日主钓/排行

**Files:**
- Modify: `web/index.html`
- Modify: `web/app.js`
- Modify: `i18n/en.json`
- Modify: `tools/test-engine.mjs`（末尾 “app.js 鹰潭专用模式” 测试）

**Interfaces:**
- Consumes: `bestByDate`, `mergeAlerts` from `web/rank.js`；`SPECIES` from `web/engine.js`。
- Produces:
  - 常量 `TARGET_SPECIES = ['crucian','bream','carp','grass','culter','mandarin']`。
  - 状态 `S.focus`（查看鱼种）、`S.outs`（key→输出）、`S.days`（`bestByDate` 结果）、`S.alerts`（`mergeAlerts` 结果）、`S.rankOpen`（排行是否展开）。
  - `S.out` 始终指向 `S.outs[S.focus]`，供现有 `renderPlace`/`drawChart`/`renderDetail` 使用。
  - DOM：`#d-best`（主钓卡）、`#d-rank`（备选排行）、`#d-focus`（查看鱼种行）。

- [ ] **Step 1: Update the app source assertions first**

把 `tools/test-engine.mjs` 的 “app.js 鹰潭专用模式：默认点、边界、台钓、四种鱼” 改成 “六种鱼、固定排序、主钓排行”，保留现有默认点/边界/台钓断言；`S.out` 仍指向当前 focus，所以 `S.out.shadow` 和 `S.out.weights || WEIGHTS` 断言继续保留。把鱼种断言换成：

```js
assert(/const TARGET_SPECIES = \['crucian', 'bream', 'carp', 'grass', 'culter', 'mandarin'\]/.test(app), '六种目标鱼列表不对');
assert(!/S\.sp\b/.test(app), '不应再有单鱼种状态 S.sp');
assert(!/sp-row/.test(app), '不应再有鱼种勾选控件');
assert(!/q\.set\('sp'/.test(app), 'URL 不应再写 sp');
assert(/import \{ bestByDate, mergeAlerts \} from '\.\/rank\.js'/.test(app), '未引入排行模块');
assert(/S\.outs/.test(app) && /S\.days/.test(app) && /S\.alerts/.test(app), '缺少多鱼种合并状态');
assert(/\$\('d-best'\)/.test(app) && /\$\('d-rank'\)/.test(app) && /\$\('d-focus'\)/.test(app), '缺少主钓/排行/查看元素');
assert(/S\.focus/.test(app), '缺少查看鱼种状态');
```

Run: `node tools/test-engine.mjs`
Expected: FAIL，当前 app 仍是四种鱼、单 `S.sp`、无 rank 引入。

- [ ] **Step 2: Update HTML and CSS**

`web/index.html`：

1. 把提示改成与 `i18n/en.json` 对应的新键：
   `当前按信江（鹰潭段）出预报；6 种目标鱼固定参与排序，可切换水域类型。`
2. 删除 `#sp-row` 的整个 `div`（含“目标鱼种” label）；`.opts` 只保留水域类型，CSS 改成单列窄栏（如 `grid-template-columns: minmax(220px, 360px);`），删除 `.species-row` 规则。
3. 在 `#detail` 的 `.dhead` 之后、`#d-meta` 之前插入：

```html
<div class="best-pick" id="d-best" hidden></div>
<div class="rank-list" id="d-rank" hidden></div>
<div class="focus-line" id="d-focus"></div>
```

4. 增加 CSS：`.best-pick`（浅品牌色底、圆角、内边距）、`.best-head`（横向 baseline 换行）、`.best-sp`、`.best-win`、`.best-tips`、`.best-gap`、`.rank-list`、`.rank-head`、`.rank-row`（`grid-template-columns: minmax(0,1fr) auto auto auto`，`height:auto`，左对齐，行间 6px）、`.rank-row[aria-pressed="true"]` 品牌色边框、`.top-badge`、`.rank-score`、`.rank-lv`、`.rank-win`、`.rank-more`、`.focus-line`、`.day .sp`。
5. 在 `@media (max-width:520px)` 里让 `.rank-row` 变成三列并把 `.rank-win` 放到第二行（`grid-column:1 / -1`），保证排行不横向滚动。

- [ ] **Step 3: Update the English dictionary**

`i18n/en.json`：
- 删除 `"目标鱼种": "Target species",`。
- 删除旧提示键 `"当前按信江（鹰潭段）出预报；可在下方切换鱼种/水域类型。"`，加入新键：
  `"当前按信江（鹰潭段）出预报；6 种目标鱼固定参与排序，可切换水域类型。"`
- 值建议：`"Currently scoring the Xin River (Yingtan stretch); all six target species are ranked; switch water type if needed."`

Run: `node tools/build.mjs`
Expected: 此时可能因 HTML 未同步/键未用而报错；修到无“未用词典键”。

- [ ] **Step 4: Update app imports, constants, state, URL, init**

`web/app.js`：
- `import { bestByDate, mergeAlerts } from './rank.js';`
- 删除 `DEFAULT_SPECIES` import（不再用），保留 `SPECIES`、`WATER_TYPES`、`WEIGHTS`。
- 用 `const TARGET_SPECIES = ['crucian', 'bream', 'carp', 'grass', 'culter', 'mandarin'];` 替换 `YINGTAN_SPECIES`。
- `S` 删除 `sp`；新增 `focus: null, outs: null, days: null, alerts: [], rankOpen: false`。
- 删除 `renderSpecies`。
- `initSelects` 只保留水域下拉；删除 `#sp-row` 相关代码。
- `syncUrl` 删除 `q.set('sp', S.sp)`。
- `readUrl` 删除 `sp` 读取和 `renderSpecies()`；保留 `lat/lon/w/wt/n`。

- [ ] **Step 5: Rewrite `recompute` to compute all six**

保持现有 `opts` 的天气/海况/洪水/溶氧/水域/台钓 style；对 `TARGET_SPECIES` 循环：

1. `computeForecast({ ...opts, species: key })`。
2. 再算 `model:'0.6'` 影子，挂到该输出的 `shadow`（沿用现有 `S.out.shadow` 形状）。
3. 跳过单鱼种异常；全部失败才走现有错误块。
4. `S.outs = { [key]: out }`。
5. `const dates = outputs[0].out.days.map((d) => d.date)`。
6. `S.days = bestByDate(outputs, dates).filter((x) => x.ranking.length)`。
7. `S.alerts = mergeAlerts(outputs)`。
8. `S.days` 为空 → `TXT.noDays` 错误块；否则修正 `S.sel`，如果 `S.focus` 不在该日 `ranking` 里就设为 `top.key`，再 `S.out = S.outs[S.focus]`。
9. 保留 loading/error/result 的显隐和 `renderPlace/renderAlerts/renderDays/renderDetail` 调用。

- [ ] **Step 6: Update renderers**

`updateTitle`：改用 `S.days[S.sel].top.score`。

`renderAlerts`：遍历 `S.alerts`，用 `S.days` 的日期下标拿 `dateLabel`，按日期分组显示；不再遍历 `S.out.days`。

`renderDays`：遍历 `S.days`，用 `entry.top` 的 `score/level/level_index/windows/day_cap` 和 `entry.top.day` 的 `water_temp/alerts/cap_kinds`；在分数下方加 `<div class="sp">${esc(top.name)}</div>`。点击时：`S.sel = i`、`S.focus = entry.top.key`、`S.rankOpen = false`、`S.out = S.outs[S.focus]`，再 `renderDetail()`。

`renderDetail`：
- `entry = S.days[S.sel]`，`top = entry.top`，`out = S.outs[S.focus]`；`d = out.days.find(x => x.date === entry.date) || top.day`。
- `dhead` 的分数/等级/等级说明用 `top`（主钓固定第一名）。
- `#d-best`：`主钓：<name>`、`top.score`、`top.level`、最佳窗口（`top.windows[0]` 或 `TXT.noWin`）、`top.day.advice.slice(0, 3)` 作为水层/钓位/饵料；`entry.ranking[1]` 存在且 `top.score - ranking[1].score <= 3` 时加 `TXT.closeGap`。
- `#d-rank`：`ranking` 默认前 3，`S.rankOpen` 时全部；每行按钮含名字、分数、等级、首个时段，top 行加 `TXT.topBadge`，`aria-pressed` 表示 `S.focus`；多于 3 条时加展开/收起按钮；`ranking.length < 2` 时整块隐藏（只有主钓，没有“其他可选”）。
- 排行点击：只改 `S.focus`、`S.out = S.outs[S.focus]`，再 `renderDetail()`；主钓卡不变。
- `#d-focus`：`TXT.focusLabel(name, S.focus === top.key)`。
- `#d-meta`：只保留 `TXT.meta(d)`（不再拼鱼种）。
- `#d-shadow` 用 `S.out.shadow`（`S.out` 就是 focus），权重用 `S.out.weights || WEIGHTS`；`#d-wins`、`#d-subs`、`#d-advice`、`#d-safety`、`#d-ice` 全部用 `out`/`d`（当前查看鱼种）。
- `drawChart`：用 `S.days[S.sel].date` 找到 `S.out.days` 里的同一天，避免某鱼种缺天时下标错位。

- [ ] **Step 7: Add TXT strings and remove unused**

在 `TXT.zh` / `TXT.en` 增加：
- `bestLabel`: `主钓` / `Top pick`
- `bestWindow`: `最佳` / `Best`
- `rankLabel`: `其他可选` / `Other options`
- `focusLabel(n, isTop)`: `查看：${n}${isTop ? '（主钓）' : ''}` / `Viewing: ${n}${isTop ? ' (top pick)' : ''}`
- `topBadge`: `主钓` / `Top`
- `expand(n)`: `展开全部 ${n} 种` / `Show all ${n}`
- `collapse`: `收起` / `Show less`
- `closeGap`: `差距很小，可以都准备` / `Very close — prepare for both`

删除不再使用的 `speciesMeta`。所有动态文案只走 `TXT`。

- [ ] **Step 8: Run tests/build**

Run:
```bash
node tools/test-rank.mjs
node tools/test-engine.mjs
node tools/build.mjs
```
Expected: 全绿；构建输出“英文页可见文本无中文残留”，且没有未用词典键。

- [ ] **Step 9: Browser verification**

Run: `node serve-dev.mjs`，打开 `http://127.0.0.1:8791`：
- 页面无 `#sp-row`；7 天卡片 7 张，每张有鱼种名。
- 点某天：`#d-best` 有“主钓：X”、窗口、水层/饵料；`#d-rank` 默认 3 行；点“展开全部 6 种”变 6 行。
- 点非第一名：`#d-focus` 变化，八项分/曲线/建议/影子切换；`#d-best` 的主钓名字不变。
- 切日期：`S.focus` 重置为该日 top。
- 前二差 ≤3 的天出现“差距很小，可以都准备”（可临时用控制台构造或找自然满足的日期；找不到就记录不可演示）。
- 375px 宽：7 天卡片 3 列，排行不横向滚动。
- Console 无 error/warning；Network 无 5xx；无 `cdnjs`/Leaflet 请求。
- URL 不再有 `sp`；手动打开 `?sp=crucian` 仍是 6 种排序、不报错。

- [ ] **Step 10: Do not commit; report**

报告改动文件、测试输出、浏览器结果和任何未演示项。

---

### Task 4: 文档与验收用例

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/impl-notes.md`
- Modify: `.claude/rules/API_WebPage_TestCase.md`
- Modify: `web/llms.txt`（如果仍写“鱼种与钓法选择”）

**Interfaces:**
- Consumes: Task 1–3 的行为和命令。
- Produces: 文档与测试命令一致；无过时的“四种鱼/勾选鱼种”描述。

- [ ] **Step 1: Update README/CLAUDE**

- README 顶部/功能/目录/构建命令：
  - 鱼种改为“鲫鱼、鳊鱼、鲤鱼、草鱼、翘嘴、鳜鱼；固定全选，每天给主钓 + 备选排行”。
  - 删除“可在下方切换鱼种”。
  - 目录加 `web/rank.js`；命令加 `node tools/test-rank.mjs`。
- CLAUDE：
  - 架构表加 `web/rank.js`；构建/测试命令加 `node tools/test-rank.mjs`。
  - 鹰潭专用模式段落把四种鱼改为六种、固定排序、无勾选。
  - 验证要求加 test-rank。

- [ ] **Step 2: Update impl-notes**

加一节“多鱼种主钓排行”：
- `TARGET_SPECIES` 六种固定；`S.outs`/`S.days`/`S.alerts`；`S.out` 是 focus。
- `rankDay` 同分按 `TARGET_SPECIES` 顺序；`mergeAlerts` 按 `日期 + line` 去重。
- 7 天卡片用 top；详情主钓固定 top，查看可切换。
- 旧 `sp` 忽略；影子跟随 focus。

- [ ] **Step 3: Update acceptance cases**

在 `.claude/rules/API_WebPage_TestCase.md` 的 4.3：
- 把 “鱼种列表” 用例改成“6 种目标鱼固定参与排序，无勾选控件”。
- 新增：
  - 主钓 + 排行（7 天卡片 top、详情主钓、默认前 3、展开 6 种）。
  - 查看切换（点排行非第一名，八项分/曲线/影子切换，主钓不变）。
  - 前二差 ≤3 提示。
  - 旧 `sp=` 忽略。
- 4.4 的分享链接用例改成“链接含 lat/lon/w/wt/n，不含 sp”。

- [ ] **Step 4: Final verification**

Run:
```bash
node tools/test-rank.mjs
node tools/test-engine.mjs
node tools/test-coord.mjs
node tools/build.mjs
```
Expected: 全部通过；构建输出英文页无中文残留、无未用词典键。

Optional if fixtures exist: `node tools/check-fixtures.mjs`.
Browser: repeat Task 3 Step 9 checklist once after doc/build changes.

- [ ] **Step 5: Do not commit; report and wait**

按用户规则不 commit/push。给出 `git diff --stat`、测试/构建结果、浏览器验证结果，等用户确认后再决定是否提交。
