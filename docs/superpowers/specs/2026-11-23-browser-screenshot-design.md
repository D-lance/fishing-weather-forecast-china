# 浏览器截屏按钮 — 设计

> **2026-11-23 后续变更（用户确认）：** 改为“整页长图”方案——本地 `html2canvas` 以宽 1080 渲染整个页面，不再使用 `getDisplayMedia`，不弹屏幕选择器；分享卡方案也作废。下文原生屏幕捕获内容仅作历史记录。

日期：2026-11-23
状态：待确认

## 1. 意图

在结果区的“复制分享链接”旁边加一个“截屏”按钮。点它后，用户在当前浏览器里选择当前标签页/窗口，页面把当前屏幕抓成一张 PNG 下载，方便直接发给钓友。

## 2. 已确认

- **只做浏览器**；不改 Android WebView，不加原生接口。
- 采用 **方案 1：浏览器原生 `getDisplayMedia`**，不引入 `html2canvas` 等库。
- 截取的是**当前可见屏幕**（当前标签页/窗口/屏幕，由浏览器选择器决定），不是整页拼接。
- 输出 PNG 下载；不上传任何图片，不做后端。

## 3. 方案对比

- **1 原生屏幕捕获（选）**：零依赖，截到的就是当前屏幕，Canvas 曲线也能截；每次多一步浏览器选择器。
- **2 html2canvas**：一键、无选择框，但要引入约 200KB 本地库，DOM 复杂时可能和真实屏幕有细微差异。
- **3 固定分享卡片**：最稳定、最适合分享，但不是“当前屏幕”，还要另做一套卡片布局。

2/3 不选。

## 4. 交互

- 按钮位置：结果区 `.place` 里、“复制分享链接”旁边；只有结果加载后可见。
- 文案：`截屏`；英文 `Screenshot`（最小键，英文不做验收）。
- 点击：
  1. 状态栏提示“请选择当前标签页…”。
  2. 浏览器弹出原生选择器；用户选当前标签页/窗口。
  3. 抓一帧，生成 PNG，下载为 `fish-YYYYMMDD-HHMM.png`。
  4. 状态栏“截图已保存”。
- 用户取消选择：状态栏“已取消截屏”，不报错。
- 浏览器不支持 `getDisplayMedia`：状态栏“当前浏览器不支持截屏”。
- 其他失败：状态栏“截屏失败，请重试”，不把异常抛到 Console。

## 5. 实现要点

- 在 `web/app.js` 加 `captureScreen()`，不新增模块。
- 调用：
  ```js
  navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'browser' },
    audio: false,
    preferCurrentTab: true,
  })
  ```
  `displaySurface/preferCurrentTab` 只是提示，最终由浏览器选择器决定。
- 用临时 `<video>` 接 `MediaStream`，等首帧后画到 `<canvas>`，`canvas.toBlob(..., 'image/png')`。
- `finally` 里停止所有 track，清空 `video.srcObject`，避免摄像头/录屏指示常亮。
- 下载用临时 `<a download>` + `URL.createObjectURL(blob)`，随后 revoke。
- 不改 Open-Meteo 请求、不改评分、不新增网络请求。
- 按钮加在 `web/index.html`，`i18n/en.json` 加静态 `"截屏": "Screenshot"`；动态提示放 `TXT`。

## 6. 边界

- 用户选整个屏幕/别的窗口时，图片会包含该内容；这是浏览器选择器的行为，按钮文案可提示“选当前标签页”。
- 浏览器不支持（部分移动 Safari/WebView）→ 明确提示，不崩溃。
- `getDisplayMedia` 拒绝/取消 → 中性提示，不报错。
- `toBlob` 返回 null / 下载被拦截 → 失败提示，可重试。
- 375px：按钮和分享链接在同一行换行，不横向滚动。
- 截屏时按钮和状态栏本身也在画面里；这是“当前屏幕”的一部分，不额外处理。
- 不改 Android，不改 `web/engine.js`/`web/weather.js`。

## 7. 验收

- 源码断言：`getDisplayMedia`、`captureScreen`、`#shot-link`、提示文案存在。
- 浏览器：点“截屏”→ 出现选择器 → 选当前标签页 → 下载 PNG；图片包含当前可见页面和曲线。
- 取消选择：状态“已取消截屏”，Console 无 error。
- 模拟不支持：临时移除 `navigator.mediaDevices.getDisplayMedia` → 提示“当前浏览器不支持截屏”。
- 375px 不横向滚动；Network 不新增请求。
- 现有 `test-engine` / `test-rank` / `test-weather` / `test-coord` / `build` 保持全绿。

## 8. 实施边界

- 修改 `web/app.js`、`web/index.html`、`i18n/en.json`、`tools/test-engine.mjs`、文档/验收用例。
- 不改 `web/engine.js`、`web/weather.js`、Android。
- 不新增 npm 依赖、不新增后端。
