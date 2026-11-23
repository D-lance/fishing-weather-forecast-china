# 浏览器截屏按钮 Implementation Plan

> **2026-11-23 后续变更（用户确认）：** 实现已改为本地 `html2canvas` 渲染宽 1080 的整页长图，不再使用 `getDisplayMedia`；分享卡方案也作废。下文原生屏幕捕获计划仅作历史记录。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在结果区加“截屏”按钮，用浏览器原生屏幕捕获把当前可见标签页存成 PNG 下载。

**Architecture:** `app.js` 调 `navigator.mediaDevices.getDisplayMedia()`，用临时 `<video>` 接流、`<canvas>` 抓帧、`toBlob` 下载；`finally` 停止 track。只改网页，不碰 Android、不引库。

**Tech Stack:** 原生 ES modules、Media Capture API、Canvas、Node 测试脚本；无 npm 依赖。

**Spec:** `docs/superpowers/specs/2026-11-23-browser-screenshot-design.md`

## Global Constraints

- 只做浏览器；不改 Android WebView、不改 `web/engine.js`/`web/weather.js` 评分。
- 不引入 `html2canvas`/npm 依赖、不新增后端/网络请求。
- 使用 `navigator.mediaDevices.getDisplayMedia`；截取当前可见标签页/窗口/屏幕，不做整页拼接。
- 用户取消 → 中性提示；不支持 → 明确提示；其他失败 → 可重试提示；不把异常打到 Console。
- 必须 `finally` 停止所有 track，避免录屏指示常亮。
- 按钮放在结果区 `.place` 的“复制分享链接”旁，只有结果加载后可见。
- 375px 不横向滚动；英文只保留最小键，不做验收。
- 未经用户明确同意，不 `git commit` / `git push`。
- 完成标准：`test-engine`、`test-rank`、`test-weather`、`test-coord`、`build` 全绿。

## Review Focus

- 用户取消选择时是否只提示“已取消截屏”，Console 无 error/warning。
- 浏览器没有 `getDisplayMedia` 时是否提示不支持，而不是崩溃。
- 截屏成功后是否下载 PNG 且文件名合理；`toBlob` 返回 null 时是否失败提示。
- 抓帧前是否等到首帧，避免全黑图；`finally` 是否停止所有 track。
- 截屏路径是否不发新请求、不改评分/主钓/天气。
- 375px 下“截屏/复制分享链接”是否换行且不横向滚动。
- 真实浏览器选择器是否至少手动验证一次；自动化用假流覆盖下载/取消/不支持分支。

---

### Task 1: 截屏按钮与捕获流程

**Files:**
- Modify: `web/index.html`
- Modify: `web/app.js`
- Modify: `i18n/en.json`
- Modify: `tools/test-engine.mjs`（app 源断言）

**Interfaces:**
- Consumes: 浏览器 `navigator.mediaDevices.getDisplayMedia`；现有 `setStatus`。
- Produces:
  - DOM `#shot-link`（`.place` 内、`#share-link` 旁）。
  - `captureScreen()` async；`shotFilename()`；`downloadBlob(blob, name)`。
  - `TXT.shotPick/shotSaved/shotCanceled/shotUnsupported/shotFail`（中英）。
  - 静态按钮文案 `截屏` + `i18n/en.json` 的 `"截屏": "Screenshot"`。

- [ ] **Step 1: Add the app source assertion first**

在 `tools/test-engine.mjs` 的 app 测试里加：

```js
assert(/getDisplayMedia/.test(app) && /captureScreen/.test(app), '缺少浏览器截屏');
assert(/\$\('shot-link'\)/.test(app), '缺少截屏按钮事件');
assert(/shotSaved/.test(app) && /shotCanceled/.test(app), '缺少截屏状态文案');
```

Run: `node tools/test-engine.mjs`
Expected: FAIL，当前 app 没有截屏。

- [ ] **Step 2: Add the button and static translation**

`web/index.html` 的 `.place` 里、`#share-link` 后加：

```html
<a class="share" id="shot-link" href="#">截屏</a>
```

`i18n/en.json` 加：

```json
"截屏": "Screenshot",
```

- [ ] **Step 3: Add TXT strings**

在 `app.js` 的 `TXT.zh` / `TXT.en` 加：
- `shotPick`: `请选择当前标签页…` / `Choose the current tab…`
- `shotSaved`: `截图已保存` / `Screenshot saved`
- `shotCanceled`: `已取消截屏` / `Screenshot cancelled`
- `shotUnsupported`: `当前浏览器不支持截屏` / `Screen capture is not supported in this browser`
- `shotFail`: `截屏失败，请重试` / `Screenshot failed; try again`

- [ ] **Step 4: Implement capture**

在 `app.js` 加：
- `shotFilename()`：`fish-YYYYMMDD-HHMM.png`。
- `downloadBlob(blob, name)`：临时 `<a download>`，`URL.createObjectURL`，click 后 revoke。
- `captureScreen()`：
  1. `const md = navigator.mediaDevices;` 没有 `getDisplayMedia` → `setStatus(TXT.shotUnsupported, true)` 返回。
  2. `setStatus(TXT.shotPick)`；`await md.getDisplayMedia({ video: { displaySurface: 'browser' }, audio: false, preferCurrentTab: true })`。
  3. 建临时 `video`，`muted=true`、`playsInline=true`，`srcObject=stream`，append 到 body（`display:none`），等 `loadedmetadata`/`canplay` 和 `play()`；再用 `requestVideoFrameCallback`（没有则双 `requestAnimationFrame`/短延时）等首帧，确认 `videoWidth > 0`。
  4. canvas 宽高 = video 尺寸；`drawImage(video,0,0)`；`await new Promise(resolve => canvas.toBlob(resolve,'image/png'))`。
  5. blob 为空 → `shotFail`；否则下载并 `shotSaved`。
  6. `catch`：`NotAllowedError` → `shotCanceled`；`NotSupportedError` → `shotUnsupported`；其他 → `shotFail`。不要 `console.error`。
  7. `finally`：停止所有 track、清空 `video.srcObject`、移除 video。
- 启动时 `$('shot-link').addEventListener('click', (ev) => { ev.preventDefault(); captureScreen(); });`

- [ ] **Step 5: Run tests/build**

Run:
```bash
node tools/test-engine.mjs
node tools/test-rank.mjs
node tools/test-weather.mjs
node tools/build.mjs
```
Expected: 全绿；英文页无中文残留、无未用词典键。

- [ ] **Step 6: Browser verification**

`node serve-dev.mjs` 打开 `http://127.0.0.1:8791/`：

1. **真实选择器**：点“截屏” → 浏览器弹出选择器 → 选当前标签页 → 下载 `fish-*.png`；打开图片能看到当前页面和曲线。
2. **取消**：再点“截屏” → 关掉选择器 → 状态“已取消截屏”，Console 无 error。
3. **不支持**：Console 执行 `Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: undefined, configurable: true })` 后点按钮 → “当前浏览器不支持截屏”。
4. **自动化替代**（可选）：用 `Object.defineProperty` 注入一个返回 `canvas.captureStream()` 的假 `getDisplayMedia`，点按钮，验证下载事件和文件名。
5. 375px：截屏/复制分享链接换行，不横向滚动；Network 不新增请求。

- [ ] **Step 7: Do not commit; report**

---

### Task 2: 文档与最终验证

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/impl-notes.md`
- Modify: `.claude/rules/API_WebPage_TestCase.md`
- Modify: `web/llms.txt`

**Interfaces:**
- Consumes: Task 1 的 `captureScreen`、`#shot-link`、测试命令。
- Produces: 文档/验收与按钮一致；无旧描述。

- [ ] **Step 1: Update README/CLAUDE**

- README 功能加“截屏：浏览器原生屏幕捕获，选当前标签页下载 PNG；不上传”。
- CLAUDE 在鹰潭模式/页面说明里加截屏入口；验证要求加截屏手测。
- 不改测试命令（无新测试文件）。

- [ ] **Step 2: Update impl-notes**

加“浏览器截屏”：
- `captureScreen()` 用 `getDisplayMedia` + video/canvas/toBlob；`finally` 停止 track。
- 取消/不支持/失败状态；不新增请求/不改评分。
- 只做浏览器，不改 Android。

- [ ] **Step 3: Update acceptance cases**

在 `.claude/rules/API_WebPage_TestCase.md` 4.4 加：
- `TC-SHOT-UI-N-001` 截屏：点按钮 → 选当前标签页 → 下载 PNG，图片含当前屏幕。
- `TC-SHOT-UI-A-001` 取消截屏：状态“已取消截屏”，Console 无 error。
- `TC-SHOT-UI-A-002` 不支持：移除 `getDisplayMedia` → 明确提示。
- `TC-SHOT-UI-N-002` 375px：按钮换行、不横向滚动。

- [ ] **Step 4: Final verification**

Run:
```bash
node tools/test-engine.mjs
node tools/test-rank.mjs
node tools/test-weather.mjs
node tools/test-coord.mjs
node tools/build.mjs
```
Expected: 全部通过；构建输出英文页无中文残留、无未用词典键。
Browser: repeat Task 1 Step 6 checklist.

- [ ] **Step 5: Do not commit; report and wait**

按用户规则不 commit/push；给出 diff、测试/构建、浏览器结果。
