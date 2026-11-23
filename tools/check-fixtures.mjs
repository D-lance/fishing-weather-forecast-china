// JS 引擎 ↔ Python 基准对齐检查。
// 读 fixtures 目录（默认仓库根 fixtures/）里每一对 <名>.json（{input, forecast, marine}）
// 与 <名>.expected.json（Python 端 fishcast.py 生成，是基准），用 web/engine.js 重算，逐项比：
//   日分、8 个分项、最佳时段分、每小时 h / hs —— 差 ≤ 1 算过；水温差 ≤ 0.15 °C 算过；
//   day_cap、等级、等级说明、安全提示、建议逐字相等。
// 用法：node tools/check-fixtures.mjs [fixtures目录] [-v]
// 退出码：0 全过；1 有超差；2 目录不存在或没有样例。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeForecast } from '../web/engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const verbose = args.includes('-v');
const DIR = args.find((a) => !a.startsWith('-')) || path.join(ROOT, 'fixtures');
const TOL = 1;
const TOL_W = 0.15;

if (!fs.existsSync(DIR)) { console.log(`fixture 目录不存在：${DIR}`); process.exit(2); }
const names = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && !f.endsWith('.expected.json')).map((f) => f.slice(0, -5))
  .filter((n) => fs.existsSync(path.join(DIR, n + '.expected.json')));
if (!names.length) { console.log(`${DIR} 里没有成对的 <名>.json + <名>.expected.json`); process.exit(2); }

let bad = 0;
for (const n of names) {
  const fx = JSON.parse(fs.readFileSync(path.join(DIR, n + '.json'), 'utf8'));
  const exp = JSON.parse(fs.readFileSync(path.join(DIR, n + '.expected.json'), 'utf8'));
  const inp = fx.input || {};
  // 15 天响应（7 past + 8 forecast）必须从 expected 首日锚定；否则 firstDi = nd - 7 会从明天开始。
  const anchor = inp.now || exp.days?.[0]?.date;
  const got = computeForecast({
    forecast: fx.forecast, marine: fx.marine || null,
    species: inp.species || inp.sp || exp.species, water: inp.water || inp.w || exp.place?.water,
    waterSource: inp.water ? 'user' : undefined, name: inp.name || '', now: anchor,
  });
  const gd = new Map(got.days.map((d) => [d.date, d]));
  const stat = { n: 0, max: 0, over: [] };
  const cmp = (what, a, b, tol = TOL) => {
    stat.n++;
    if (a == null || b == null) { if (a !== b) stat.over.push(`${what}: 期望 ${b} 实得 ${a}`); return; }
    const d = Math.abs(a - b);
    if (tol === TOL) stat.max = Math.max(stat.max, d);
    if (d > tol + 1e-9) stat.over.push(`${what}: 期望 ${b} 实得 ${a}（差 ${d.toFixed(2)}）`);
  };
  for (const e of exp.days) {
    const g = gd.get(e.date);
    if (!g) { stat.over.push(`${e.date}: JS 端没有这一天`); continue; }
    cmp(`${e.date} 日分`, g.score, e.score);
    cmp(`${e.date} 水温`, g.water_temp, e.water_temp, TOL_W);
    if (e.gate != null) cmp(`${e.date} 水温闸门`, g.gate, e.gate, 0.011);
    if ('day_cap' in e && (e.day_cap ?? null) !== (g.day_cap ?? null)) stat.over.push(`${e.date} 日分封顶: 期望 ${e.day_cap} 实得 ${g.day_cap}`);
    // 文案逐字比（中文口径）：等级、等级说明、安全提示、建议
    for (const k of ['level', 'level_text']) if (e[k] != null && e[k] !== g[k]) stat.over.push(`${e.date} ${k}: 期望「${e[k]}」实得「${g[k]}」`);
    for (const k of ['safety', 'advice']) if (e[k] && JSON.stringify(e[k]) !== JSON.stringify(g[k])) stat.over.push(`${e.date} ${k}: 期望 ${JSON.stringify(e[k])} 实得 ${JSON.stringify(g[k])}`);
    if (e.ice != null && !!g.ice !== !!e.ice) stat.over.push(`${e.date} 结冰: 期望 ${e.ice} 实得 ${g.ice}`);
    if (g.season !== e.season) stat.over.push(`${e.date} 季节档: 期望 ${e.season} 实得 ${g.season}`);
    for (const k of Object.keys(e.sub || {})) cmp(`${e.date} 分项 ${k}`, g.sub[k], e.sub[k]);
    (e.windows || []).forEach((w, i) => cmp(`${e.date} 时段#${i + 1} 分`, g.windows[i]?.score, w.score));
    if ((e.windows || []).length !== g.windows.length) stat.over.push(`${e.date} 时段数: 期望 ${(e.windows || []).length} 实得 ${g.windows.length}`);
    const gh = new Map(g.hours.map((h) => [h.t, h]));
    for (const h of e.hours || []) {
      const x = gh.get(h.t);
      if (!x) { stat.over.push(`${h.t}: JS 端没有这一小时`); continue; }
      cmp(`${h.t} h`, x.h, h.h);
      cmp(`${h.t} hs`, x.hs, h.hs);
    }
    if (verbose) console.log(`  ${e.date} 分 ${e.score}/${g.score} 水温 ${e.water_temp}/${g.water_temp} 时段 ${(e.windows || []).map((w) => w.start).join(',')} / ${g.windows.map((w) => w.start).join(',')}`);
  }
  const ok = !stat.over.length;
  if (!ok) bad++;
  console.log(`${ok ? '通过' : '超差'}  ${n}：比对 ${stat.n} 项，最大分差 ${stat.max.toFixed(2)}${ok ? '' : `，${stat.over.length} 项超差`}`);
  for (const s of stat.over.slice(0, verbose ? 200 : 12)) console.log('    - ' + s);
  if (!verbose && stat.over.length > 12) console.log(`    …另 ${stat.over.length - 12} 项（-v 看全部）`);
}
console.log(bad ? `\n${bad}/${names.length} 份样例超差` : `\n全部 ${names.length} 份样例对齐（分差 ≤ ${TOL}）`);
process.exit(bad ? 1 : 0);
