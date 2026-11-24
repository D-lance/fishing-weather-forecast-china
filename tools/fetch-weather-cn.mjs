// 中国天气网（鹰潭）→ web/data/weather-cn.json
// 用法：
//   node tools/fetch-weather-cn.mjs --out web/data/weather-cn.json
//   node tools/fetch-weather-cn.mjs
//
// 中国天气网页面没有 CORS，浏览器不能直连；这个脚本在本地/CI/定时任务里跑，
// 页面只读静态 /data/weather-cn.json。建议 30–60 分钟抓一次，尊重公共站点。
import fs from 'node:fs';
import path from 'node:path';
import { buildWeatherCn, CN_PAGE, CN_CURRENT } from '../web/cnweather.js';

const HEADERS = {
  'User-Agent': 'fishing-weather-forecast-china/0.1 (+https://fish.satloot.com)',
  'Referer': 'http://www.weather.com.cn/',
};

async function fetchText(url, timeout = 20000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

const html = await fetchText(CN_PAGE);
const currentText = await fetchText(CN_CURRENT).catch(() => '');
const out = buildWeatherCn({ html, currentText });
if (!Array.isArray(out.days) || out.days.length < 5) {
  throw new Error(`中国天气网只解析到 ${out.days?.length || 0} 天，拒绝写入`);
}

const outIdx = process.argv.indexOf('--out');
if (outIdx >= 0 && process.argv[outIdx + 1]) {
  const file = path.resolve(process.argv[outIdx + 1]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  console.error(`written ${file} (${out.days.length} days)`);
} else {
  console.log(JSON.stringify(out, null, 2));
}
