// fish.satloot.com 双语构建（照 trx-site/tools/build.mjs）：web/index.html（中文，唯一源）+ web/app.js + web/engine.js → site/
//   site/index.html      中文：原样 + canonical/hreflang + 首访语言跳转脚本
//   site/en/index.html   英文：按 i18n/en.json 逐段整句翻译，<html lang="en">，meta 全英文，相对地址改根绝对
//   site/engine.js       评分引擎；若 fixtures/species.json（或 FISH_SPECIES_JSON）存在，用它替换内置鱼种表
//   site/app.js          import './engine.js' 改成带内容哈希的地址（动态文案在 app.js 里按 <html lang> 自选）
//   site/sitemap.xml / robots.txt / manifest.json
// 用法：node tools/build.mjs
// 翻译口径与 satloot-tool / bnbbang prerender-en 一致：只翻「trim 后与词典 key 逐字相等」的文本节点；
//   属性只翻 placeholder / title / aria-label / alt 与 <meta> content；script/style/pre/code 里不翻；data-nolang 祖先下不翻；漏翻回落中文并在末尾列出。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'site');
const ORIGIN = 'https://fish.satloot.com';
const LS_KEY = 'satloot.lang';
const OG_IMAGE = `${ORIGIN}/assets/og.png`;      // 1200×630，tools/make-og.mjs 生成，源文件在 web/assets/
const LOGO_512 = `${ORIGIN}/assets/logo-512.png`;
const THEME = '#f7f6f3';
// 鱼种表：fixtures/species.json（或 FISH_SPECIES_JSON）存在就以它为准（构建时拷进 engine.js），否则用 engine.js 内置的 model.md §5
const SPECIES_JSON = process.env.FISH_SPECIES_JSON || path.join(ROOT, 'fixtures', 'species.json');

const SRC = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');
const DICT = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n', 'en.json'), 'utf8'));

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const SKIP_TAGS = { script: 1, style: 1, code: 1, pre: 1, textarea: 1 };
const VOID_TAGS = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1 };
const CJK = /[一-龥　-〿＀-￯]/;

function translate(html, dict) {
  const used = new Set();
  const misses = [];
  const t = (s) => { if (Object.prototype.hasOwnProperty.call(dict, s)) { used.add(s); return dict[s]; } return s; };
  const tokens = html.split(/(<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->|<[^>]+>)/i);
  const stack = [];
  let hits = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) continue;
    if (/^<(?:!--|script\b|style\b)/i.test(tok)) continue;
    if (tok[0] === '<') {
      const m = tok.match(/^<\/?([a-zA-Z][a-zA-Z0-9-]*)/);
      if (!m) continue;
      const name = m[1].toLowerCase();
      if (tok[1] === '/') {
        for (let k = stack.length - 1; k >= 0; k--) if (stack[k].name === name) { stack.length = k; break; }
        continue;
      }
      let tag = tok;
      const attrs = name === 'meta' ? ATTRS.concat('content') : ATTRS;
      for (const a of attrs) {
        const re = new RegExp('(\\s' + a + '=")([^"]*)(")');
        tag = tag.replace(re, (mm, p1, v, p3) => {
          const s = v.trim();
          if (!s) return mm;
          const en = t(s);
          if (en === s) { if (CJK.test(s)) misses.push(`${a}="${s}"`); return mm; }
          hits++;
          return p1 + v.replace(s, () => en) + p3;
        });
      }
      tokens[i] = tag;
      const selfClose = /\/>$/.test(tok) || VOID_TAGS[name];
      if (!selfClose) stack.push({ name, nolang: /\sdata-nolang(?:=|\s|>|$)/.test(tok) });
      continue;
    }
    if (stack.some((s) => SKIP_TAGS[s.name] || s.nolang)) continue;
    const s = tok.trim();
    if (!s) continue;
    const en = t(s);
    if (en === s) { if (CJK.test(s)) misses.push(s); continue; }
    tokens[i] = tok.replace(s, () => en);
    hits++;
  }
  const unused = Object.keys(dict).filter((k) => !used.has(k));
  return { html: tokens.join(''), hits, misses, unused };
}

function absolutize(html) {
  const isRel = (u) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#|$)/i.test(u);
  return html.replace(/\b(src|href|poster|action)="([^"]*)"/g, (m, k, v) => (isRel(v) ? `${k}="/${v}"` : m));
}
function stripComments(html) {
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (blk) => blk.replace(/^[ \t]*\/\/[^\n]*\n/gm, ''));
  html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (blk) => blk.replace(/\/\*[\s\S]*?\*\/[ \t]*\n?/g, '').replace(/\n[ \t]*\n[ \t]*\n/g, '\n\n'));
  return html;
}
function headLinks(lang) {
  const url = lang === 'en' ? `${ORIGIN}/en/` : `${ORIGIN}/`;
  return [
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:locale" content="${lang === 'en' ? 'en_US' : 'zh_CN'}">`,
    `<meta property="og:locale:alternate" content="${lang === 'en' ? 'zh_CN' : 'en_US'}">`,
    `<link rel="canonical" href="${url}">`,
    `<link rel="alternate" hreflang="zh-CN" href="${ORIGIN}/">`,
    `<link rel="alternate" hreflang="en" href="${ORIGIN}/en/">`,
    `<link rel="alternate" hreflang="x-default" href="${ORIGIN}/">`,
  ].map((l) => '  ' + l).join('\n') + '\n';
}

const unesc = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const text = (s) => unesc(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
/** 「怎么算的」一节（#notes 里每个 .note 的 h3 + li）→ FAQPage 问答；从该语言页面自身抽，保证与可见文本一致 */
function faq(html) {
  const sec = (html.match(/<section id="notes"[\s\S]*?<\/section>/) || [''])[0];
  const items = [];
  for (const m of sec.matchAll(/<div class="card note">\s*<h3>([^<]*)<\/h3>\s*<ul>([\s\S]*?)<\/ul>/g)) {
    const q = text(m[1]);
    const a = [...m[2].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => text(x[1])).join(' ');
    if (q && a) items.push({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } });
  }
  return items;
}
/** JSON-LD（@graph：Organization + WebSite + WebPage + WebApplication + FAQPage），标题/描述取自该语言页面自身 */
function jsonld(html, lang) {
  const en = lang === 'en';
  const url = en ? `${ORIGIN}/en/` : `${ORIGIN}/`;
  const inLanguage = en ? 'en' : 'zh-CN';
  const title = unesc((html.match(/<title>([^<]*)<\/title>/) || [, ''])[1]);
  const desc = unesc((html.match(/<meta name="description" content="([^"]*)"/) || [, ''])[1]);
  // 站名取 og:site_name（h1 是堆了搜索关键词的长标题，不适合当站名）
  const appName = unesc((html.match(/<meta property="og:site_name" content="([^"]*)"/) || [, title.split(' - ')[0]])[1]);
  const graph = [
    { '@type': 'Organization', '@id': `${ORIGIN}/#org`, name: 'satloot', url: 'https://satloot.com/', logo: { '@type': 'ImageObject', url: LOGO_512, width: 512, height: 512 }, sameAs: ['https://x.com/eth61675', 'https://github.com/q3579338'] },
    { '@type': 'WebSite', '@id': `${ORIGIN}/#website`, name: appName, url: `${ORIGIN}/`, inLanguage, publisher: { '@id': `${ORIGIN}/#org` } },
    { '@type': 'WebPage', '@id': url, url, name: title, description: desc, inLanguage, isPartOf: { '@id': `${ORIGIN}/#website` }, primaryImageOfPage: { '@type': 'ImageObject', url: OG_IMAGE, width: 1200, height: 630 } },
    { '@type': 'WebApplication', '@id': `${ORIGIN}/#app`, name: appName, url, description: desc, image: OG_IMAGE, inLanguage,
      applicationCategory: 'WeatherApplication', operatingSystem: 'Any', browserRequirements: 'Requires JavaScript', isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, publisher: { '@id': `${ORIGIN}/#org` } },
  ];
  const qa = faq(html);
  if (qa.length) graph.push({ '@type': 'FAQPage', '@id': `${url}#faq`, url: `${url}#notes`, inLanguage, mainEntity: qa });
  const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
  return mustReplace(html, '</head>', `  <script type="application/ld+json">${json}</script>\n</head>`, '</head>');
}
// 首访语言跳转：只在 / 上跑；记过选择就不跳；浏览器语言不以 zh 开头才跳 /en/
const REDIRECT = `  <script>(function(){try{if(!/^https?:$/.test(location.protocol))return;if(localStorage.getItem(${JSON.stringify(LS_KEY)}))return;var n=navigator.language||(navigator.languages||[])[0]||'';if(n&&!/^zh/i.test(n))location.replace('/en/'+location.search+location.hash)}catch(e){}})();</script>\n`;
// 语言切换点击记忆
const LANG_SCRIPT = `  <script>document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('.lang-switch');if(!a)return;try{localStorage.setItem(${JSON.stringify(LS_KEY)},a.getAttribute('lang'))}catch(x){}var h=a.getAttribute('href');if(h&&(location.search||location.hash)){var u=h+location.search+location.hash;if(e.button===0&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey){e.preventDefault();location.href=u}else{a.href=u}}});</script>\n`;

function mustReplace(html, from, to, what) {
  if (!html.includes(from)) throw new Error(`build: 源里找不到 ${what}：${from}`);
  return html.replace(from, () => to);
}

let zh = SRC;
zh = mustReplace(zh, '  <link rel="icon"', headLinks('zh') + '  <link rel="icon"', 'favicon 行');
zh = mustReplace(zh, '  <meta charset="UTF-8">\n', '  <meta charset="UTF-8">\n' + REDIRECT, 'charset 行');
// engine.js / app.js 带内容哈希查询串：Cloudflare / 浏览器缓存住也没关系，改了脚本发布后立刻生效
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
let ENGINE = fs.readFileSync(path.join(ROOT, 'web', 'engine.js'), 'utf8');
let speciesNote = '鱼种表：engine.js 内置（model.md §5）';
if (fs.existsSync(SPECIES_JSON)) {
  // 格式由 Python 端定，这里宽松接受：数组 / {species:[...]} / {key:{...}}；字段 tmin,opt_lo,opt_hi,tmax 或 range:[4 个数]
  const raw = JSON.parse(fs.readFileSync(SPECIES_JSON, 'utf8'));
  const list = Array.isArray(raw) ? raw : Array.isArray(raw.species) ? raw.species : Object.entries(raw).map(([key, v]) => ({ key, ...v }));
  const norm = list.map((x) => {
    const rg = x.range || x.temp || [];
    const o = { key: x.key || x.id, name: x.name || x.name_zh || x.zh, tmin: x.tmin ?? rg[0], opt_lo: x.opt_lo ?? rg[1], opt_hi: x.opt_hi ?? rg[2], tmax: x.tmax ?? rg[3] };
    if (x.name_en) o.en = x.name_en;
    if (typeof x.lure === 'boolean') o.lure = x.lure;
    if (!o.key || !o.name || ![o.tmin, o.opt_lo, o.opt_hi, o.tmax].every(Number.isFinite)) throw new Error('build: species.json 条目格式不认识：' + JSON.stringify(x));
    return o;
  });
  const b = ENGINE.indexOf('/*SPECIES_BEGIN*/'), e = ENGINE.indexOf('/*SPECIES_END*/');
  if (b < 0 || e < 0) throw new Error('build: engine.js 缺 SPECIES_BEGIN/END 标记');
  ENGINE = ENGINE.slice(0, b) + '/*SPECIES_BEGIN*/' + JSON.stringify(norm, null, 2) + ENGINE.slice(e);
  speciesNote = `鱼种表：拷自 ${SPECIES_JSON}（${norm.length} 种）`;
}
// app.js 里 import 的每个本地模块（engine.js / coord.js …）都换成带内容哈希的地址
const MODULES = { 'engine.js': ENGINE };
let APP = fs.readFileSync(path.join(ROOT, 'web', 'app.js'), 'utf8');
if (!APP.includes("from './engine.js';")) throw new Error("build: app.js 里找不到 from './engine.js';");
APP = APP.replace(/from '\.\/([\w-]+\.js)';/g, (m, f) => {
  if (!MODULES[f]) MODULES[f] = fs.readFileSync(path.join(ROOT, 'web', f), 'utf8');
  return `from './${f}?v=${hash(MODULES[f])}';`;
});
const APP_SRC = 'app.js?v=' + hash(APP);
zh = mustReplace(zh, '  <script type="module" src="app.js"></script>', LANG_SCRIPT + `  <script type="module" src="${APP_SRC}"></script>`, 'app.js 引用');

const r = translate(SRC, DICT);
let en = r.html;
en = mustReplace(en, '<html lang="zh-CN">', '<html lang="en">', '<html lang>');
en = mustReplace(en, '<link rel="manifest" href="/manifest.json">', '<link rel="manifest" href="/en/manifest.json">', 'manifest 链接');
en = mustReplace(en, '  <link rel="icon"', headLinks('en') + '  <link rel="icon"', 'favicon 行');
en = en.replace(/<a class="lang-switch"[^>]*>[^<]*<\/a>/, '<a class="lang-switch" href="/" hreflang="zh-CN" lang="zh-CN" data-nolang>中文</a>');
if (!en.includes('hreflang="zh-CN" lang="zh-CN"')) throw new Error('build: 源里没有 .lang-switch');
en = mustReplace(en, 'class="brand" href="/"', 'class="brand" href="/en/"', '品牌链接');
en = mustReplace(en, '  <script type="module" src="app.js"></script>', LANG_SCRIPT + `  <script type="module" src="/${APP_SRC}"></script>`, 'app.js 引用');
en = stripComments(en);
en = absolutize(en);
zh = jsonld(zh, 'zh');
en = jsonld(en, 'en');

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'en'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'web', 'llms.txt'), path.join(DIST, 'llms.txt'));
fs.writeFileSync(path.join(DIST, 'index.html'), zh);
fs.writeFileSync(path.join(DIST, 'en', 'index.html'), en);
fs.writeFileSync(path.join(DIST, 'app.js'), APP);
for (const [f, src] of Object.entries(MODULES)) fs.writeFileSync(path.join(DIST, f), src);
// 静态资源（og.png / logo-*.png，由 tools/make-og.mjs 生成）+ manifest
fs.cpSync(path.join(ROOT, 'web', 'assets'), path.join(DIST, 'assets'), { recursive: true });
// IndexNow 密钥文件（32 位十六进制 .txt）必须在站根：搜索引擎只认密钥文件所在目录之下的 URL。源文件放 assets/，构建时再拷一份到根。
for (const f of fs.readdirSync(path.join(ROOT, 'web', 'assets'))) if (/^[0-9a-f]{32}.txt$/.test(f)) fs.copyFileSync(path.join(path.join(ROOT, 'web', 'assets'), f), path.join(DIST, f));
const manifest = (lang) => JSON.stringify({
  name: lang === 'en' ? 'Fishing Weather Forecast' : '今日鱼情',
  short_name: lang === 'en' ? 'Fishing Forecast' : '今日鱼情',
  lang: lang === 'en' ? 'en' : 'zh-CN',
  start_url: lang === 'en' ? '/en/' : '/',
  scope: lang === 'en' ? '/en/' : '/',
  display: 'browser', background_color: THEME, theme_color: THEME,
  icons: [{ src: '/assets/logo-192.png', sizes: '192x192', type: 'image/png' }, { src: '/assets/logo-512.png', sizes: '512x512', type: 'image/png' }],
}, null, 2) + '\n';
fs.writeFileSync(path.join(DIST, 'manifest.json'), manifest('zh'));
fs.writeFileSync(path.join(DIST, 'en', 'manifest.json'), manifest('en'));

const today = new Date().toISOString().slice(0, 10);
const alt = `<xhtml:link rel="alternate" hreflang="zh-CN" href="${ORIGIN}/"/><xhtml:link rel="alternate" hreflang="en" href="${ORIGIN}/en/"/><xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN}/"/>`;
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url><loc>${ORIGIN}/</loc>${alt}<lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>
  <url><loc>${ORIGIN}/en/</loc>${alt}<lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.9</priority></url>
</urlset>
`);
fs.writeFileSync(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`);

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0);
console.log(`built site/index.html (${kb(zh)} KB) + site/en/index.html (${kb(en)} KB) + app.js + engine.js + sitemap.xml + robots.txt`);
console.log(speciesNote);
console.log(`词典 ${Object.keys(DICT).length} 条，命中 ${r.hits} 处`);
if (r.unused.length) console.warn(`词典里没用上的 key（${r.unused.length}）：` + r.unused.map((k) => JSON.stringify(k)).join(', '));
if (r.misses.length) {
  console.warn(`英文页漏翻（${r.misses.length}，已回落中文）：`);
  for (const m of [...new Set(r.misses)]) console.warn('  - ' + m);
  process.exitCode = 2;
} else console.log('英文页可见文本无中文残留');
