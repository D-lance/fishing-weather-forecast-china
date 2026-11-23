---
description: 为某个功能按 .claude/rules/API_WebPage_TestCase.md 模板生成验收用例并逐条执行（用户选择项，需要时才用）
allowed-tools: Bash, Read, Edit, Write
---

# 按模板补验收用例

功能名：`$ARGUMENTS`（命令后跟的文本，如 `/acceptance 地图选点`；空则向用户询问要验证哪个功能）

为「$ARGUMENTS」按 `.claude/rules/API_WebPage_TestCase.md`（本项目版）+ `docs/测试用例/_起草规范.md` 生成模块级验收用例，并逐条执行记录结果。

> 这是**选择项**：用户在需要模板化验收时输入本命令；不需要时功能验证走常规自闭环（Node 测试 + 浏览器 Console/Network + 构建）。

## 第零步：已有用例文档则走「复核」，否则「生成+执行」

- 检查 `docs/测试用例/$ARGUMENTS-验收用例.md` 是否存在：
  - **已存在** → 打开文档，逐条重新执行（Node/浏览器/API），更新 ✅/❌/⚠️，不改用例结构；有回归当场修。
  - **不存在** → 走第一步~第四步生成后执行。

## 第一步：理解功能范围

按功能读相关文件，列出真实入口：

- 页面/交互：`web/index.html`、`web/app.js`
- 评分/数据：`web/engine.js`、`docs/model.md`
- 坐标/地图：`web/coord.js`
- 构建/双语：`tools/build.mjs`、`i18n/en.json`
- 外部接口：`engine.js` 的 `forecastUrl` / `marineUrl` / `geocodeUrl` / `overpassQuery`

整理：页面元素、engine 导出、URL 构造函数、正常流程、异常/边界。不要臆造接口或 DOM id。

## 第二步：套用模板生成用例文档

严格按 `API_WebPage_TestCase.md` 的章节 + `_起草规范.md`：

1. **复制模板结构** → 新建 `docs/测试用例/$ARGUMENTS-验收用例.md`
2. **模块标识**：编号前缀换成 `TC-<模块缩写>-<N/A>-<序号>`（如 `MAP`、`SCORE`、`I18N`）
3. **删减**：去掉本功能不涉及的分类；不要保留登录/Token/多租户/软删除/数据库/CRUD 章节
4. **红线专项**：安全封顶 / 热季最后一天 / 分数范围 / 英文无中文 / 地图不卡死（按功能取舍，至少覆盖相关项）
5. **每条用例**：编号 / 用例名 / 优先级 / 预置条件 / 操作步骤 / 预期结果 / 执行方式 / 执行结果（默认空）

## 第三步：逐条执行并记录

按 **P0 → P1 → P2 → P3** 顺序执行：

- **Node 引擎测试**：`node tools/test-engine.mjs`
- **坐标自测**：`node tools/test-coord.mjs`
- **构建/双语**：`node tools/build.mjs`（必须无中文残留、无未用词典键）
- **浏览器**：`node serve-dev.mjs` → `http://127.0.0.1:8791`；用 Playwright/Chrome 操作：
  - Console 无 error/warning
  - Network 无 5xx
  - 无无限 loading
  - 空态/错误态/断网/地图 CDN 失败都有明确提示
- **外部 API 探针**：curl 或浏览器 Network 检查 Open-Meteo / Nominatim / Overpass；注意频率（Nominatim ≤1 次/秒）
- **代码审查**：无法演示的分支（如极端天气、冰钓）用合成响应 + `computeForecast` 验证

每条标记：
- `✅` 通过（注明：浏览器 / Node / API / 代码审查）
- `❌` 不通过 → 当场修到通过
- `⚠️` 不可演示（注明原因：无数据 / 需特定水体 / 外部接口限制）

## 第四步：收尾

- 汇总：通过 X 条 / 不通过 Y 条 / 不可演示 Z 条
- 更新 `docs/测试用例/$ARGUMENTS-验收用例.md` 的执行结果列
- 如行为/公式有变化，同步 `docs/model.md` / `README.md`
- 向用户汇报；**未经用户要求不要 git commit**
