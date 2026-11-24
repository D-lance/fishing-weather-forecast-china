// 生成社交分享图 web/assets/og.png（1200×630）与 manifest / JSON-LD 用的 logo（web/assets/logo-512.png、logo-192.png）。
// 一次性工具，产物随 web/ 维护；build.mjs 只负责把 web/assets/ 拷进 site/。
// 用法：node tools/make-og.mjs
// 光栅化用 @resvg/resvg-js：本目录没装就借 bnbbang 那份（Windows 本机路径）。字体走系统字体（微软雅黑 / Segoe UI）。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'web', 'assets');

let Resvg;
for (const p of ['@resvg/resvg-js', 'D:/CLAUDE/bnbbang/server/node_modules/@resvg/resvg-js']) {
  try { ({ Resvg } = require(p)); break; } catch {}
}
if (!Resvg) throw new Error('缺 @resvg/resvg-js：npm i @resvg/resvg-js 或保证 D:/CLAUDE/bnbbang/server/node_modules 在');

const render = (svg, width) => Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: true, defaultFontFamily: 'Microsoft YaHei' } }).render().asPng());

// 与 web/index.html 的 CSS 变量一致：浅暖灰底 + 湖水青
const C = { bg: '#f7f6f3', ink: '#1c1917', muted: '#78716c', dim: '#a8a29e', line: '#e7e5e4', brand: '#0f766e', soft: '#e6f4f1', lv: ['#15803d', '#4d7c0f', '#b45309', '#c2410c', '#b91c1c'] };
const SANS = "'Microsoft YaHei','Microsoft YaHei UI','Segoe UI',sans-serif";

// 右侧示意：5 天分数柱（示意图，不是真实预报）
const demo = [{ d: '周三', s: 86 }, { d: '周四', s: 72 }, { d: '周五', s: 58 }, { d: '周六', s: 91 }, { d: '周日', s: 67 }];
const lvl = (s) => (s >= 80 ? 0 : s >= 65 ? 1 : s >= 50 ? 2 : s >= 35 ? 3 : 4);
const bars = demo.map((x, i) => {
  const bx = 736 + i * 70, h = x.s * 2.1, by = 392 - h;
  return `<rect x="${bx}" y="${by}" width="48" height="${h}" rx="6" fill="${C.lv[lvl(x.s)]}"/>
<text x="${bx + 24}" y="${by - 8}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="17" fill="${C.ink}">${x.s}</text>
<text x="${bx + 24}" y="418" text-anchor="middle" font-family="${SANS}" font-size="15" fill="${C.muted}">${x.d}</text>`;
}).join('\n');

const FISH = (x, y, s, fill, eye) => `<g transform="translate(${x},${y}) scale(${s})"><path d="M5 16c4-6.5 12-6.5 16.5 0C17 22.5 9 22.5 5 16z" fill="${fill}"/><path d="M21 16l6-5v10z" fill="${fill}"/><circle cx="10" cy="15" r="1.4" fill="${eye}"/></g>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs>
  <radialGradient id="a" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${C.brand}" stop-opacity=".14"/><stop offset="1" stop-color="${C.brand}" stop-opacity="0"/></radialGradient>
  <filter id="sh" x="-10%" y="-10%" width="120%" height="130%"><feGaussianBlur stdDeviation="14"/></filter>
</defs>
<rect width="1200" height="630" fill="${C.bg}"/>
<ellipse cx="160" cy="20" rx="620" ry="320" fill="url(#a)"/>
<path d="M0 560 C 200 530, 400 590, 600 560 S 1000 530, 1200 560 L1200 630 L0 630 Z" fill="${C.soft}"/>
<rect x="96" y="70" width="56" height="56" rx="14" fill="${C.brand}"/>
${FISH(96, 70, 1.75, '#fff', C.brand)}
<text x="170" y="112" font-family="${SANS}" font-size="22" letter-spacing="3" fill="${C.brand}">FISH.SATLOOT.COM</text>
<text x="94" y="228" font-family="${SANS}" font-weight="700" font-size="92" fill="${C.ink}">今日鱼情</text>
<text x="96" y="296" font-family="${SANS}" font-size="32" fill="${C.ink}">未来 5 天出钓评分 · 最佳时段</text>
<text x="96" y="350" font-family="${SANS}" font-size="26" fill="${C.muted}">按气温、气压、风、云雨、日月与水域打分</text>
<text x="96" y="390" font-family="${SANS}" font-size="26" fill="${C.muted}">附钓位、水层、饵料建议和雷暴大风提示</text>
<rect x="96" y="428" width="300" height="50" rx="25" fill="${C.soft}" stroke="#b7e0d8"/>
<text x="246" y="461" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="21" fill="${C.brand}">免费 · 免注册 · 手机好用</text>
<rect x="704" y="128" width="420" height="330" rx="22" fill="#1c1917" opacity=".12" filter="url(#sh)"/>
<rect x="700" y="118" width="420" height="330" rx="22" fill="#ffffff" stroke="${C.line}"/>
<text x="736" y="160" font-family="${SANS}" font-weight="700" font-size="21" fill="${C.ink}">5 天出钓评分（示意）</text>
<line x1="736" y1="392" x2="1086" y2="392" stroke="${C.line}"/>
${bars}
<text x="600" y="604" text-anchor="middle" font-family="${SANS}" font-size="17" fill="${C.muted}">经验模型，未经鱼获校准 · 出钓请遵守当地禁渔期</text>
</svg>`;

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${C.brand}"/>${FISH(0, 0, 1, '#fff', C.brand)}</svg>`;

fs.mkdirSync(OUT, { recursive: true });
const og = render(svg, 1200);
fs.writeFileSync(path.join(OUT, 'og.png'), og);
for (const s of [512, 192]) fs.writeFileSync(path.join(OUT, `logo-${s}.png`), render(LOGO, s));
console.log(`web/assets/og.png ${(og.length / 1024).toFixed(0)} KB, logo-512.png, logo-192.png`);
