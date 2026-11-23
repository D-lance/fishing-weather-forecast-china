# Core Rules（钓鱼天气预报项目）

## Investigation & Accuracy

- 不猜测没读过的代码；先读 `docs/model.md`、`README.md`、`web/engine.js`、`web/app.js`。
- 不编造 API、路径、字段或行为；外部接口以 `web/engine.js` 的 `forecastUrl` / `marineUrl` / `geocodeUrl` / `overpassQuery` 为准。
- 不确定就明说，并给出验证方法（Node 测试 / 浏览器 / Network 面板 / curl）。
- 改评分行为前先确认 `docs/model.md` 的当前口径，不要凭经验改权重。

## Spec & Plan Must Include Test Cases

- 每个功能或修复的 spec / plan 必须包含验收用例：**操作步骤 + 预期结果 + 验证方式**，覆盖正常流程和边界情况。
- 计划必须注明验证方式：Node 引擎测试 / 浏览器操作 / 外部 API 探针 / 代码审查。
- 没有验收用例的 spec / plan 不合格，先补用例再写代码。
- 用例文档放 `docs/测试用例/<功能>-验收用例.md`，按 `docs/测试用例/_起草规范.md` 写。

## Change & Branch Discipline

- 默认在用户指定的分支 / 工作区改；直接改 `main` 需要用户明确同意。
- 未经用户要求不要 `git commit` / `git push`。
- 改动保持最小范围；不顺手重构无关代码，不删除看起来没用的历史逻辑（先确认）。
- 修复 bug 先写能复现的失败测试，再改实现；UI 无 DOM 测试框架时，至少用源码断言 + 浏览器验证。

## Scope Discipline

- 只做被要求的，不多不少；遵循“只 / 仅 / 就是”等限定词。
- 歧义时默认先研究和给建议，不直接编辑。
- 发现额外问题先记录，不擅自扩大改动；用户确认后再做。

## Verification & Safety

- 功能完成后必须自闭环，以下全部通过才算完成：
  - `node tools/test-engine.mjs`
  - `node tools/test-coord.mjs`
  - `node tools/build.mjs`（英文页无中文残留、无未用词典键）
  - 浏览器打开受影响页面：Console 无 error/warning，Network 无 5xx，无无限 loading，空态/错误态/断网/地图 CDN 失败都有明确提示。
- 安全底线不得为了分数好看而移除：雷暴 / 7 级阵风 / 2.5m 浪 / 强降水的硬封顶、水温闸门、结冰提示。
- 破坏性操作（删文件 / 分支、force push、hard reset、`--no-verify`）先问。
- 不提交真实个人位置、鱼获数据、签名文件、`.env` 或任何密钥。

## Documentation Resilience

- 行为或公式变化：先改 `docs/model.md`，再改 `web/engine.js`，并同步 `README.md` 相关说明。
- 构建 / 测试命令变化：同步 `README.md` 和 `CLAUDE.md`。
- 新增验收用例：放 `docs/测试用例/`，不要塞进代码注释。
